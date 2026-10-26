package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestAcademySettingsPermissionsAndSecretIsolation(t *testing.T) {
	t.Setenv("CONFIG_DIR", t.TempDir())
	c := systemSettings{Platform: "academy", Commerce: commerceSettings{FreeVideos: 4, SMTPPassword: "smtp-private", APIKey: "pay-private"}, SFU: []sfuProvider{{Secret: "infrastructure-private"}}, R2: r2Settings{Secret: "r2-private"}}
	if err := saveSettings(c); err != nil {
		t.Fatal(err)
	}
	a := &app{}
	for _, u := range []identity{{Role: "student"}, {Role: "teacher"}, {Role: "admin", Permissions: []string{}}} {
		r := httptest.NewRequest("GET", "/api/academy/settings", nil)
		r = r.WithContext(context.WithValue(r.Context(), authKey{}, u))
		w := httptest.NewRecorder()
		a.academySettings(w, r)
		if w.Code != 403 {
			t.Fatalf("role %s got %d", u.Role, w.Code)
		}
	}
	r := httptest.NewRequest("GET", "/api/academy/settings", nil)
	r = r.WithContext(context.WithValue(r.Context(), authKey{}, identity{Role: "admin", Permissions: []string{"finance"}}))
	w := httptest.NewRecorder()
	a.academySettings(w, r)
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	for _, secret := range []string{"smtp-private", "pay-private", "infrastructure-private", "r2-private", "secret_access_key"} {
		if bytes.Contains(w.Body.Bytes(), []byte(secret)) {
			t.Fatalf("exposed %s", secret)
		}
	}
	var result struct {
		Settings commerceSettings
		Secrets  map[string]bool
	}
	if json.Unmarshal(w.Body.Bytes(), &result) != nil || result.Settings.FreeVideos != 4 || !result.Secrets["smtp_password"] {
		t.Fatal("invalid redacted business configuration")
	}
}
