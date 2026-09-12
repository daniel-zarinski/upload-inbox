// upload-inbox-server: public, write-only upload inbox.
// tus protocol on /files/ (chunked + resumable), React UI on /.
// Finished uploads move to $INBOX_DIR/YYYY-MM-DD/<uploader>/<filename>.
package main

import (
	"embed"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/tus/tusd/v2/pkg/filelocker"
	"github.com/tus/tusd/v2/pkg/filestore"
	"github.com/tus/tusd/v2/pkg/handler"
)

//go:embed all:web/dist
var webFS embed.FS

const maxUploadBytes = 500 << 20 // 500 MB, the stated ceiling

var unsafeChars = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

// sanitize turns attacker-controlled metadata into a single safe path component.
func sanitize(s, fallback string) string {
	s = unsafeChars.ReplaceAllString(strings.TrimSpace(s), "_")
	s = strings.Trim(s, "._") // kills "..", leading dots, stray underscores
	if s == "" {
		return fallback
	}
	return s
}

// destination picks <inbox>/<day>/<uploader>/<filename>, suffixing on collision.
func destination(inbox, uploader, filename string, now time.Time) string {
	dir := filepath.Join(inbox, now.Format("2006-01-02"), sanitize(uploader, "anonymous"))
	name := sanitize(filename, "file")
	out := filepath.Join(dir, name)
	if _, err := os.Stat(out); err == nil {
		out = filepath.Join(dir, now.Format("150405")+"-"+name)
	}
	return out
}

// moveFile renames, or if that fails (e.g. EXDEV across Unraid disks) copies
// with fsync and size check before removing the source. The source outlives
// every failure path.
func moveFile(src, dst string) error {
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	return copyThenRemove(src, dst)
}

func copyThenRemove(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	srcInfo, err := in.Stat()
	if err != nil {
		return err
	}
	tmp := dst + ".part"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o664)
	if err != nil {
		return err
	}
	n, err := io.Copy(out, in)
	if err == nil {
		err = out.Sync()
	}
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err == nil && n != srcInfo.Size() {
		err = fmt.Errorf("short copy: %d of %d bytes", n, srcInfo.Size())
	}
	if err == nil {
		err = os.Rename(tmp, dst)
	}
	if err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Remove(src)
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	inbox := env("INBOX_DIR", "/upload-inbox")
	partial := filepath.Join(inbox, ".tusd-partial")
	if err := os.MkdirAll(partial, 0o775); err != nil {
		log.Fatalf("create %s: %v", partial, err)
	}

	composer := handler.NewStoreComposer()
	filestore.New(partial).UseIn(composer)
	filelocker.New(partial).UseIn(composer)

	h, err := handler.NewHandler(handler.Config{
		BasePath:                "/files/",
		StoreComposer:           composer,
		NotifyCompleteUploads:   true,
		MaxSize:                 maxUploadBytes,
		DisableDownload:         true, // write-only: nobody reads back
		RespectForwardedHeaders: true, // behind Cloudflare Tunnel
	})
	if err != nil {
		log.Fatalf("tusd: %v", err)
	}

	go func() {
		for ev := range h.CompleteUploads {
			src := ev.Upload.Storage[filestore.StorageKeyPath]
			out := destination(inbox, ev.Upload.MetaData["uploader"], ev.Upload.MetaData["filename"], time.Now())
			if err := os.MkdirAll(filepath.Dir(out), 0o775); err != nil {
				log.Printf("KEEPING %s in partial dir, mkdir failed: %v", ev.Upload.ID, err)
				continue
			}
			if err := moveFile(src, out); err != nil {
				log.Printf("KEEPING %s in partial dir, move failed: %v", ev.Upload.ID, err)
				continue
			}
			os.Remove(ev.Upload.Storage[filestore.StorageKeyInfoPath])
			log.Printf("stored %s (%d bytes)", out, ev.Upload.Size)
		}
	}()

	dist, err := fs.Sub(webFS, "web/dist")
	if err != nil {
		log.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.Handle("/files/", http.StripPrefix("/files/", h))
	mux.Handle("/", http.FileServer(http.FS(dist)))

	log.Printf("upload-inbox-server listening on :8080, inbox=%s", inbox)
	log.Fatal(http.ListenAndServe(":8080", mux))
}
