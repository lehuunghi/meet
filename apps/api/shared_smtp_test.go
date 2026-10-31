package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSharedSMTPFallbackDoesNotOverwriteLocalSettings(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CONFIG_DIR", dir)
	path := filepath.Join(dir, "shared-smtp.json")
	if err := os.WriteFile(path, []byte(`{"enabled":true,"smtp_address":"smtp.example.test:465","smtp_from":"mail@example.test","smtp_user":"shared-user","smtp_password":"private-shared"}`), 0600); err != nil {
		t.Fatal(err)
	}
	own := commerceSettings{SMTPAddress: "own.example.test:587", SMTPFrom: "own@example.test", SMTPPassword: "own-private"}
	if got := academySMTP(own); got.SMTPAddress != own.SMTPAddress || got.SMTPPassword != own.SMTPPassword {
		t.Fatal("local SMTP lost")
	}
	empty := commerceSettings{FreeVideos: 4}
	got := academySMTP(empty)
	if got.SMTPPassword != "private-shared" || got.FreeVideos != 4 || empty.SMTPPassword != "" {
		t.Fatal("shared SMTP not isolated")
	}
	if !academySMTPConfigured(empty) {
		t.Fatal("shared SMTP unavailable")
	}
	if err := os.WriteFile(path, []byte(`{"enabled":false}`), 0600); err != nil {
		t.Fatal(err)
	}
	if academySMTPConfigured(empty) {
		t.Fatal("disabled shared SMTP still used")
	}
	if err := os.WriteFile(path, []byte(`{"enabled":true,"smtp_address":"bad:25","smtp_from":"mail@example.test"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if academySMTPConfigured(empty) {
		t.Fatal("invalid SMTP accepted")
	}
}
