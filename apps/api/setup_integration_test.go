package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	mysql "github.com/go-sql-driver/mysql"
	"github.com/redis/go-redis/v9"
)

type testTransport func(*http.Request) (*http.Response, error)

func (f testTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestSetupAndRetentionIntegration(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN unset")
	}
	base, e := sql.Open("mysql", dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer base.Close()
	name := "meet_setup_" + uid()
	if _, e = base.Exec("CREATE DATABASE " + name); e != nil {
		t.Fatal(e)
	}
	defer base.Exec("DROP DATABASE " + name)
	config, e := mysql.ParseDSN(dsn)
	if e != nil {
		t.Fatal(e)
	}
	config.DBName = name
	db, e := sql.Open("mysql", config.FormatDSN())
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	db.SetMaxOpenConns(20)
	if e = migrate(db); e != nil {
		t.Fatal(e)
	}
	if e = migrate(db); e != nil {
		t.Fatal("migration not restartable:", e)
	}
	t.Setenv("CONFIG_DIR", t.TempDir())
	token := strings.Repeat("a", 64)
	if e = os.WriteFile(configPath("setup-token"), []byte(token), 0600); e != nil {
		t.Fatal(e)
	}
	opt, e := redis.ParseURL(os.Getenv("TEST_REDIS_URL"))
	if e != nil {
		t.Fatal(e)
	}
	cache := redis.NewClient(opt)
	defer cache.Close()
	lifecycle := `<LifecycleConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Rule><ID>keep-other</ID><Status>Enabled</Status><Filter><Prefix>other/</Prefix></Filter><Expiration><Days>90</Days></Expiration></Rule></LifecycleConfiguration>`
	corsBody := ""
	deletes := 0
	client := &http.Client{Timeout: time.Second, Transport: testTransport(func(r *http.Request) (*http.Response, error) {
		body := ""
		status := 200
		header := http.Header{"Content-Type": []string{"application/xml"}}
		if r.URL.Host == "rtc.live.cloudflare.com" {
			body = `{"sessionId":"mock-session"}`
			header.Set("Content-Type", "application/json")
		} else if strings.Contains(r.URL.RawQuery, "lifecycle") {
			if r.Method == "PUT" {
				b, _ := io.ReadAll(r.Body)
				lifecycle = string(b)
			} else {
				body = lifecycle
			}
		} else if strings.Contains(r.URL.RawQuery, "cors") {
			if r.Method == "PUT" {
				b, _ := io.ReadAll(r.Body)
				corsBody = string(b)
			} else {
				status = 404
				body = `<Error><Code>NoSuchCORSConfiguration</Code><Message>none</Message></Error>`
			}
		} else if r.Method == "DELETE" {
			status = 204
			deletes++
		} else {
			return nil, fmt.Errorf("unexpected upstream %s %s", r.Method, r.URL.Path)
		}
		return &http.Response{StatusCode: status, Header: header, Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
	})}
	a := &app{db: db, cache: cache, client: client, origin: "https://setup.example", secure: true}
	h := a.routes()
	request := func(method, path string, body any, cookie *http.Cookie) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		r := httptest.NewRequest(method, path, strings.NewReader(string(raw)))
		r.Header.Set("Origin", a.origin)
		if cookie != nil {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if w := request("GET", "/api/setup/settings", nil, nil); w.Code != 401 {
		t.Fatal("public config access")
	}
	if w := request("POST", "/api/setup/unlock", map[string]string{"token": strings.Repeat("b", 64)}, nil); w.Code != 403 {
		t.Fatal("wrong token accepted")
	}
	w := request("POST", "/api/setup/unlock", map[string]string{"token": token}, nil)
	if w.Code != 200 {
		t.Fatalf("unlock: %s", w.Body)
	}
	cookie := w.Result().Cookies()[0]
	settings := systemSettings{Retention: 30, SFU: []sfuProvider{{ID: "a", Name: "A", AppID: "app-a", Secret: "test-sfu-secret-a", Weight: 2, Enabled: true}, {ID: "b", Name: "B", AppID: "app-b", Secret: "test-sfu-secret-b", Weight: 1, Enabled: true}}}
	initial := firstSchool{Slug: "setup-school", Name: "Test School", Email: "admin@example.test", Password: "test-admin-password-123"}
	w = request("POST", "/api/setup/settings", map[string]any{"settings": settings, "school": initial}, cookie)
	if w.Code != 200 {
		t.Fatalf("initial setup: %s", w.Body)
	}
	b, _ := os.ReadFile(filepath.Join(os.Getenv("CONFIG_DIR"), "settings.json"))
	if strings.Contains(string(b), initial.Password) {
		t.Fatal("admin password persisted in config")
	}
	w = request("GET", "/api/setup/settings", nil, cookie)
	if w.Code != 200 || strings.Contains(w.Body.String(), settings.SFU[0].Secret) {
		t.Fatal("config response leaked SFU secret")
	}
	var school, teacher string
	if e = db.QueryRow("SELECT id FROM schools WHERE slug='setup-school'").Scan(&school); e != nil {
		t.Fatal(e)
	}
	teacher = uid()
	if _, e = db.Exec("INSERT INTO users(id,school_id,email,name,password_hash,role) SELECT ?,school_id,'teacher@example.test','Teacher',password_hash,'teacher' FROM users WHERE school_id=? LIMIT 1", teacher, school); e != nil {
		t.Fatal(e)
	}
	meetingIDs := []string{}
	for i := 0; i < 7; i++ {
		cl, course, meeting := uid(), uid(), uid()
		for _, stmt := range []struct {
			q    string
			args []any
		}{{"INSERT INTO classes(id,school_id,name) VALUES(?,?,?)", []any{cl, school, fmt.Sprint("Class ", i)}}, {"INSERT INTO courses(id,school_id,class_id,teacher_id,name) VALUES(?,?,?,?,?)", []any{course, school, cl, teacher, "Math"}}, {"INSERT INTO meetings(id,school_id,course_id,title,starts_at,status) VALUES(?,?,?,?,UTC_TIMESTAMP(),'live')", []any{meeting, school, course, "Lesson"}}} {
			if _, e = db.Exec(stmt.q, stmt.args...); e != nil {
				t.Fatal(e)
			}
		}
		meetingIDs = append(meetingIDs, meeting)
		if i < 6 {
			if _, e = a.meetingProvider(t.Context(), school, meeting); e != nil {
				t.Fatal(e)
			}
		}
	}
	var countA, countB int
	db.QueryRow("SELECT COUNT(*) FROM class_sfu_bindings WHERE provider_id='a'").Scan(&countA)
	db.QueryRow("SELECT COUNT(*) FROM class_sfu_bindings WHERE provider_id='b'").Scan(&countB)
	if countA != 4 || countB != 2 {
		t.Fatalf("weighted class assignments %d:%d", countA, countB)
	}
	// Concurrent participants stay on the persisted provider rather than splitting the classroom.
	var wg sync.WaitGroup
	results := make(chan string, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p, err := a.meetingProvider(t.Context(), school, meetingIDs[6])
			if err != nil {
				results <- "error"
			} else {
				results <- p.ID
			}
		}()
	}
	wg.Wait()
	close(results)
	var pinned string
	for id := range results {
		if id == "error" {
			t.Fatal("concurrent allocation failed")
		}
		if pinned == "" {
			pinned = id
		}
		if pinned != id {
			t.Fatal("one room split across SFU apps")
		}
	}
	wrong := settings
	wrong.SFU = wrong.SFU[1:]
	if got := request("POST", "/api/setup/settings", map[string]any{"settings": wrong, "school": firstSchool{}}, cookie); got.Code != 409 {
		t.Fatalf("pinned provider removed: %s", got.Body)
	}
	settings.R2 = r2Settings{Enabled: true, Account: strings.Repeat("a", 32), Bucket: "meet-recordings", Access: "test-access-key", Secret: "test-r2-secret"}
	w = request("POST", "/api/setup/settings", map[string]any{"settings": settings, "school": firstSchool{}}, cookie)
	if w.Code != 200 {
		t.Fatalf("R2 setup: %s", w.Body)
	}
	if !strings.Contains(lifecycle, "keep-other") || !strings.Contains(lifecycle, "meet-recordings-30d") || !strings.Contains(lifecycle, "<Days>30</Days>") || !strings.Contains(corsBody, a.origin) {
		t.Fatal("lifecycle/CORS not merged")
	}
	var owner string
	db.QueryRow("SELECT id FROM users WHERE school_id=? AND role='admin'", school).Scan(&owner)
	rec := uid()
	if _, e = db.Exec("INSERT INTO recordings(id,school_id,meeting_id,owner_id,object_key,status,bucket,expires_at) VALUES(?,?,?,?,?,'ready',?,UTC_TIMESTAMP()-INTERVAL 1 DAY)", rec, school, meetingIDs[0], owner, "recordings/expired.webm", settings.R2.Bucket); e != nil {
		t.Fatal(e)
	}
	login := request("POST", "/api/login", map[string]string{"school": "setup-school", "email": initial.Email, "password": initial.Password}, nil)
	if login.Code != 200 {
		t.Fatal("admin login failed")
	}
	userCookie := login.Result().Cookies()[0]
	if w = request("GET", "/api/setup/settings", nil, userCookie); w.Code != 401 {
		t.Fatal("school admin gained global configuration")
	}
	if w = request("GET", "/api/meetings/"+meetingIDs[0]+"/recordings/"+rec+"/download", nil, userCookie); w.Code != 404 {
		t.Fatalf("expired recording download: %s", w.Body)
	}
	if e = a.purgeExpired(t.Context()); e != nil {
		t.Fatal(e)
	}
	var deleted bool
	if e = db.QueryRow("SELECT deleted_at IS NOT NULL FROM recordings WHERE id=?", rec).Scan(&deleted); e != nil || !deleted || deletes != 1 {
		t.Fatal("expired object not deleted and marked")
	}
	if e = a.purgeExpired(t.Context()); e != nil || deletes != 1 {
		t.Fatal("retention not idempotent")
	}
	if w = request("POST", "/api/setup/lock", map[string]bool{}, cookie); w.Code != 200 {
		t.Fatal("lock failed")
	}
	if w = request("GET", "/api/setup/settings", nil, cookie); w.Code != 401 {
		t.Fatal("operator session still active")
	}
}
