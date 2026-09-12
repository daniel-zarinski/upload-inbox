package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDestinationStaysInsideDayFolder(t *testing.T) {
	inbox := t.TempDir()
	now := time.Date(2026, 9, 11, 14, 3, 5, 0, time.UTC)
	out := destination(inbox, "../../etc", "../passwd", now)
	day := filepath.Join(inbox, "2026-09-11")
	if !strings.HasPrefix(out, day+string(filepath.Separator)) {
		t.Fatalf("escaped day folder: %s", out)
	}
	rel, _ := filepath.Rel(day, out)
	parts := strings.Split(rel, string(filepath.Separator))
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" || strings.Contains(rel, "..") {
		t.Fatalf("unexpected layout %q", rel)
	}
	if sanitize("", "anonymous") != "anonymous" || sanitize("  .. ", "x") != "x" {
		t.Fatal("fallbacks broken")
	}
	// collision gets a time prefix
	os.MkdirAll(filepath.Dir(out), 0o755)
	os.WriteFile(out, nil, 0o644)
	again := destination(inbox, "../../etc", "../passwd", now)
	if filepath.Base(again) != "140305-"+filepath.Base(out) {
		t.Fatalf("collision not suffixed: %s", again)
	}
}

func TestCopyThenRemove(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	want := []byte(strings.Repeat("upload-bytes ", 10000))
	os.WriteFile(src, want, 0o644)

	dst := filepath.Join(dir, "dst")
	if err := copyThenRemove(src, dst); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(dst)
	if string(got) != string(want) {
		t.Fatal("content mismatch")
	}
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Fatal("source not removed after successful copy")
	}
	if _, err := os.Stat(dst + ".part"); !os.IsNotExist(err) {
		t.Fatal("temp file left behind")
	}

	// failure path: destination dir does not exist -> source must survive
	os.WriteFile(src, want, 0o644)
	if err := copyThenRemove(src, filepath.Join(dir, "missing", "dst")); err == nil {
		t.Fatal("expected error")
	}
	if _, err := os.Stat(src); err != nil {
		t.Fatal("source lost on failed copy")
	}
}
