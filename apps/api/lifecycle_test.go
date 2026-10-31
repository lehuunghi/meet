package main

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestSuspendedSchoolBlocksBeforeAuthentication(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CONFIG_DIR", dir)
	file := filepath.Join(dir, "school-state.json")
	for _, raw := range []string{`{"state":"suspended"}`, `invalid-json`} {
		if err := os.WriteFile(file, []byte(raw), 0600); err != nil {
			t.Fatal(err)
		}
		w := httptest.NewRecorder()
		a := &app{}
		a.routes().ServeHTTP(w, httptest.NewRequest("GET", "/api/me", nil))
		if w.Code != 503 {
			t.Fatalf("suspended request returned %d", w.Code)
		}
	}
	if err := os.WriteFile(file, []byte(`{"state":"active"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if schoolSuspended() {
		t.Fatal("resume did not unlock school")
	}
}
