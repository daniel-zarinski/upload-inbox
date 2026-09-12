package main

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

const tusHdr = "Tus-Resumable"

func tusReq(t *testing.T, method, url string, body []byte, hdr map[string]string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(method, url, bytes.NewReader(body))
	req.Header.Set(tusHdr, "1.0.0")
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	return res
}

func b64(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }

// Full protocol round trip: create, upload in chunks, lose a chunk, resume
// from HEAD offset, finish, and verify where and how the file landed.
func TestUploadEndToEnd(t *testing.T) {
	inbox := t.TempDir()
	done := make(chan string, 1)
	srv, err := newServer(inbox, done)
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(srv)
	defer ts.Close()

	// UI is served
	if res, _ := http.Get(ts.URL + "/"); res.StatusCode != 200 {
		t.Fatalf("ui status %d", res.StatusCode)
	}

	blob := make([]byte, 3_000_000)
	rand.Read(blob)
	chunk := 1_000_000

	res := tusReq(t, "POST", ts.URL+"/files/", nil, map[string]string{
		"Upload-Length":   strconv.Itoa(len(blob)),
		"Upload-Metadata": "filename " + b64("../../evil name.mp4") + ",uploader " + b64("dan/../x"),
	})
	if res.StatusCode != 201 {
		t.Fatalf("create: %d", res.StatusCode)
	}
	loc := res.Header.Get("Location")

	patch := func(off int) int {
		return tusReq(t, "PATCH", loc, blob[off:off+chunk], map[string]string{
			"Upload-Offset": strconv.Itoa(off),
			"Content-Type":  "application/offset+octet-stream",
		}).StatusCode
	}
	if c := patch(0); c != 204 {
		t.Fatalf("patch 0: %d", c)
	}
	// client "loses" the network: re-sends chunk 0 with a stale offset
	if c := patch(0); c != 409 {
		t.Fatalf("stale offset should conflict, got %d", c)
	}
	// resume: ask the server where we are
	head := tusReq(t, "HEAD", loc, nil, nil)
	off, _ := strconv.Atoi(head.Header.Get("Upload-Offset"))
	if off != chunk {
		t.Fatalf("resume offset %d, want %d", off, chunk)
	}
	for off < len(blob) {
		if c := patch(off); c != 204 {
			t.Fatalf("patch %d: %d", off, c)
		}
		off += chunk
	}

	var out string
	select {
	case out = <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("upload never stored")
	}
	if out == "" {
		t.Fatal("store failed")
	}
	day := time.Now().Format("2006-01-02")
	want := filepath.Join(inbox, day, "dan_._x", "evil_name.mp4")
	if out != want {
		t.Fatalf("landed at %s, want %s", out, want)
	}
	got, _ := os.ReadFile(out)
	if !bytes.Equal(got, blob) {
		t.Fatal("stored bytes differ from upload")
	}
	left, _ := os.ReadDir(filepath.Join(inbox, ".tusd-partial"))
	for _, e := range left {
		if !e.IsDir() { // filelocker may leave lock dirs
			t.Fatalf("partial dir not cleaned: %s", e.Name())
		}
	}

	// write-only: finished upload cannot be fetched, and never could be
	if res := tusReq(t, "GET", loc, nil, nil); res.StatusCode == 200 {
		t.Fatal("download must be disabled")
	}
}

func TestRejectsOversizeAndNoDownload(t *testing.T) {
	srv, err := newServer(t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(srv)
	defer ts.Close()

	res := tusReq(t, "POST", ts.URL+"/files/", nil, map[string]string{"Upload-Length": strconv.Itoa(maxUploadBytes + 1)})
	if res.StatusCode != 413 {
		t.Fatalf("oversize: %d", res.StatusCode)
	}
	res = tusReq(t, "POST", ts.URL+"/files/", nil, map[string]string{"Upload-Length": "10"})
	if res.StatusCode != 201 {
		t.Fatalf("create: %d", res.StatusCode)
	}
	if res := tusReq(t, "GET", res.Header.Get("Location"), nil, nil); res.StatusCode == 200 {
		t.Fatal("download of in-progress upload must be disabled")
	}
}
