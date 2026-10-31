package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestManagementBindingAndScope(t *testing.T) {
	t.Setenv("CONFIG_DIR", t.TempDir())
	for _, origin := range []string{"http://admin.example.test", "https://admin.example.test/path", "https://user:password@admin.example.test", "https://admin.example.test?token=bad"} {
		if validControlOrigin(origin) {
			t.Fatalf("unsafe origin accepted: %s", origin)
		}
	}
	raw := `{"control_origin":"https://admin.example.test","control_id":"11111111111111111111111111111111"}`
	if e := os.WriteFile(filepath.Join(os.Getenv("CONFIG_DIR"), "managed.json"), []byte(raw), 0600); e != nil {
		t.Fatal(e)
	}
	if managementURL() != "https://admin.example.test/#academy/11111111111111111111111111111111" {
		t.Fatal("central dashboard binding lost")
	}
	for _, path := range []string{"/api/setup/settings", "/api/academy/control/../setup", "https://evil.test/api/academy/control/people"} {
		if academyManagedPath("POST", path) {
			t.Fatal("unapproved path accepted")
		}
	}
	if !academyManagedPath("GET", "/api/academy/control/people") || !academyManagedPath("POST", "/api/academy/control/teachers") {
		t.Fatal("central academic scope missing")
	}
}
