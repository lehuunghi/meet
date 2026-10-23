package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

// Dedicated disposable database only: this test migrates and seeds it.
func TestIntegration(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN unset")
	}
	db, e := sql.Open("mysql", dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	if e = migrate(db); e != nil {
		t.Fatal(e)
	}
	t.Setenv("ALLOW_DEMO_SEED", "true")
	t.Setenv("DEMO_PASSWORD", "integration-password-123")
	if e = seed(db); e != nil {
		t.Fatal(e)
	}
	opt, e := redis.ParseURL(os.Getenv("TEST_REDIS_URL"))
	if e != nil {
		t.Fatal(e)
	}
	cache := redis.NewClient(opt)
	defer cache.Close()
	a := &app{db: db, cache: cache, client: &http.Client{Timeout: time.Second}, origin: "https://test.example", secure: true}
	h := a.routes()
	request := func(method, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Origin", a.origin)
		if cookie != nil {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	login := func(school, role string) *http.Cookie {
		t.Helper()
		w := request("POST", "/api/login", `{"school":"`+school+`","email":"`+role+`@example.test","password":"integration-password-123"}`, nil)
		if w.Code != 200 {
			t.Fatalf("login %d %s", w.Code, w.Body.String())
		}
		return w.Result().Cookies()[0]
	}
	teacher := login("demo", "teacher")
	student := login("demo", "student")
	other := login("other", "teacher")
	for _, c := range []*http.Cookie{student, other} {
		w := request("POST", "/api/meetings/demo-meeting/state", `{"status":"live"}`, c)
		if w.Code != 403 && w.Code != 404 {
			t.Fatalf("unauthorized start: %d", w.Code)
		}
	}
	for _, path := range []string{"/attendance", "/tracks", "/recordings"} {
		if w := request("GET", "/api/meetings/demo-meeting"+path, "", other); w.Code != 404 {
			t.Fatalf("cross-school %s: %d", path, w.Code)
		}
	}
	if w := request("POST", "/api/classes", `{"name":"illegal"}`, student); w.Code != 403 {
		t.Fatal("student created class")
	}
	// Reset seed meeting for repeatable runs; production endpoints forbid reopening.
	if _, e = db.Exec("UPDATE meetings SET status='scheduled' WHERE id='demo-meeting'"); e != nil {
		t.Fatal(e)
	}
	if w := request("POST", "/api/meetings/demo-meeting/state", `{"status":"live"}`, teacher); w.Code != 200 {
		t.Fatalf("start: %s", w.Body)
	}
	for _, kind := range []string{"join", "heartbeat", "leave"} {
		if w := request("POST", "/api/meetings/demo-meeting/presence", `{"kind":"`+kind+`"}`, student); w.Code != 200 {
			t.Fatalf("presence: %s", w.Body)
		}
	}
	w := request("GET", "/api/meetings/demo-meeting/attendance", "", student)
	var records []map[string]any
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &records) != nil || len(records) != 1 || records[0]["id"] != "demo-student" {
		t.Fatalf("own attendance: %s", w.Body)
	}
	if w = request("POST", "/api/meetings/demo-meeting/state", `{"status":"ended"}`, teacher); w.Code != 200 {
		t.Fatalf("end: %s", w.Body)
	}
	// Reports are scoped to a subject in a class, including students with no presence.
	for _, q := range []string{
		"INSERT IGNORE INTO users(id,school_id,email,name,password_hash,role) SELECT 'demo-second','school-demo','second@example.test','Second student',password_hash,'student' FROM users WHERE id='demo-teacher'",
		"INSERT IGNORE INTO enrollments VALUES('school-demo','demo-class','demo-second')",
		"INSERT IGNORE INTO users(id,school_id,email,name,password_hash,role) SELECT 'demo-alt-teacher','school-demo','alt@example.test','Other teacher',password_hash,'teacher' FROM users WHERE id='demo-teacher'",
		"INSERT IGNORE INTO courses(id,school_id,class_id,teacher_id,name) VALUES('demo-alt-course','school-demo','demo-class','demo-alt-teacher','English')",
		"INSERT IGNORE INTO meetings(id,school_id,course_id,title,starts_at,status) VALUES('demo-second-lesson','school-demo','demo-math','Lesson 2',UTC_TIMESTAMP(),'ended')",
		"INSERT IGNORE INTO meetings(id,school_id,course_id,title,starts_at,status) VALUES('demo-future-lesson','school-demo','demo-math','Future lesson',UTC_TIMESTAMP(),'scheduled')",
		"UPDATE presence SET seconds=125 WHERE school_id='school-demo' AND meeting_id='demo-meeting' AND user_id='demo-student'",
	} {
		if _, e = db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	for _, test := range []struct {
		path   string
		cookie *http.Cookie
		code   int
	}{
		{"/api/attendance/report?course_id=demo-math", other, 404},
		{"/api/attendance/report?course_id=demo-alt-course", teacher, 404},
		{"/api/attendance/report?course_id=demo-math&class_id=other-class", teacher, 404},
		{"/api/attendance/report?course_id=demo-math&meeting_id=other-meeting", teacher, 404},
		{"/api/attendance/report?course_id=demo-math&page=-1", teacher, 400},
		{"/api/attendance/report", teacher, 400},
	} {
		if got := request("GET", test.path, "", test.cookie); got.Code != test.code {
			t.Fatalf("report %s: got %d want %d: %s", test.path, got.Code, test.code, got.Body)
		}
	}
	w = request("GET", "/api/attendance/report?course_id=demo-math", "", student)
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &records) != nil || len(records) != 1 || records[0]["id"] != "demo-student" || records[0]["seconds"] != "125" || records[0]["session_count"] != float64(2) {
		t.Fatalf("student aggregate report: %s", w.Body)
	}
	w = request("GET", "/api/attendance/report?course_id=demo-math&meeting_id=demo-meeting", "", teacher)
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &records) != nil || len(records) != 2 || records[0]["session_count"] != float64(1) {
		t.Fatalf("teacher meeting report: %s", w.Body)
	}
	administrator := login("demo", "admin")
	if w = request("GET", "/api/attendance/report?course_id=demo-alt-course", "", administrator); w.Code != 200 {
		t.Fatalf("admin report scope: %s", w.Body)
	}
	if w = request("POST", "/api/meetings/demo-meeting/presence", `{"kind":"heartbeat"}`, student); w.Code != 409 {
		t.Fatal("ended meeting credited")
	}
	if w = request("POST", "/api/logout", `{}`, student); w.Code != 200 {
		t.Fatal("logout failed")
	}
	if w = request("GET", "/api/me", "", student); w.Code != 401 {
		t.Fatal("revoked session accepted")
	}
	// Database constraint must reject a cross-tenant enrollment even outside the API.
	if _, e = db.ExecContext(context.Background(), "INSERT INTO enrollments VALUES('school-demo','demo-class','other-student')"); e == nil {
		t.Fatal("cross-school FK accepted")
	}
}
