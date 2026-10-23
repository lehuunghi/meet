package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAttendanceCredit(t *testing.T) {
	now := time.Now()
	for _, v := range []struct {
		name   string
		delta  time.Duration
		online bool
		want   int64
	}{{"heartbeat", 15 * time.Second, true, 15}, {"disconnect", 46 * time.Second, true, 0}, {"offline", 15 * time.Second, false, 0}, {"clock rollback", -time.Second, true, 0}, {"lease boundary", 45 * time.Second, true, 45}, {"duplicate", 0, true, 0}} {
		t.Run(v.name, func(t *testing.T) {
			if got := credit(now.Add(-v.delta), now, v.online); got != v.want {
				t.Fatalf("got %d want %d", got, v.want)
			}
		})
	}
}
func TestImportValidation(t *testing.T) {
	header := []string{"email", "name", "role", "password", "class"}
	valid := []string{"student@example.test", "Học sinh", "student", "long-password-123", "10A1"}
	if rows, e := validateImport([][]string{header, valid}); e != nil || len(rows) != 1 {
		t.Fatalf("valid import rejected: %v", e)
	}
	for _, row := range [][]string{{"bad", "Name", "student", "long-password-123"}, {"a@example.test", "Name", "admin", "long-password-123"}, {"a@example.test", "Name", "teacher", "short"}, {"a@example.test", "Name", "teacher", "long-password-123", "10A1"}} {
		if _, e := validateImport([][]string{header, row}); e == nil {
			t.Fatalf("accepted invalid row %v", row)
		}
	}
	if _, e := validateImport([][]string{header, valid, valid}); e == nil {
		t.Fatal("duplicate accepted")
	}
}
func TestOriginGuard(t *testing.T) {
	a := &app{origin: "https://school.example"}
	for _, origin := range []string{"", "https://evil.example", "null"} {
		r := httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader("{}"))
		r.Header.Set("Origin", origin)
		w := httptest.NewRecorder()
		a.routes().ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatalf("origin %q got %d", origin, w.Code)
		}
	}
}
func TestProtectedRoutesRequireSession(t *testing.T) {
	a := &app{origin: "https://school.example"}
	for _, path := range []string{"/api/me", "/api/users", "/api/meetings", "/api/catalog", "/api/meetings/x/tracks", "/api/meetings/x/attendance", "/api/meetings/x/recordings"} {
		r := httptest.NewRequest("GET", path, nil)
		w := httptest.NewRecorder()
		a.routes().ServeHTTP(w, r)
		if w.Code != 401 {
			t.Fatalf("%s got %d", path, w.Code)
		}
	}
}
