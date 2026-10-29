package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"database/sql"
	"encoding/base32"
	"encoding/binary"
	"encoding/json"
	"fmt"
	mysql "github.com/go-sql-driver/mysql"
	"github.com/redis/go-redis/v9"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
)

func TestProductionSafetyIntegration(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN unset")
	}
	base, e := sql.Open("mysql", dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer base.Close()
	name := "meet_safety_" + uid()
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
	if e = migrate(db); e != nil {
		t.Fatal(e)
	}
	t.Setenv("ALLOW_DEMO_SEED", "true")
	t.Setenv("DEMO_PASSWORD", "integration-password-123")
	if e = seed(db); e != nil {
		t.Fatal(e)
	}
	t.Setenv("CONFIG_DIR", t.TempDir())
	cfg := systemSettings{Retention: 30, SFU: []sfuProvider{{ID: "test", AppID: "test-app", Secret: "test-secret", Weight: 1, Enabled: true}}, R2: r2Settings{Enabled: true, Account: "test", Bucket: "test-bucket", Access: "test-key", Secret: "test-secret"}}
	raw, _ := json.Marshal(cfg)
	if e = os.WriteFile(configPath("settings.json"), raw, 0600); e != nil {
		t.Fatal(e)
	}
	opt, e := redis.ParseURL(os.Getenv("TEST_REDIS_URL"))
	if e != nil {
		t.Fatal(e)
	}
	cache := redis.NewClient(opt)
	defer cache.Close()
	ctx := context.Background()
	cache.Del(ctx, "media-sweep-cursor", "recording-start:demo-teacher")
	session := "safe-" + uid()
	active := true
	closeFail := true
	closeCalls := 0
	uploaded := false
	incomplete := true
	completeCalls := 0
	uploadID := "upload-" + uid()
	client := &http.Client{Timeout: time.Second, Transport: testTransport(func(r *http.Request) (*http.Response, error) {
		status := 200
		body := ""
		headers := http.Header{"Content-Type": []string{"application/json"}}
		if r.URL.Host == "rtc.live.cloudflare.com" {
			switch {
			case strings.HasSuffix(r.URL.Path, "/sessions/new"):
				if r.Body != nil {
					b, _ := io.ReadAll(r.Body)
					if len(b) != 0 {
						t.Fatalf("new SFU session must not send JSON: %s", b)
					}
				}
				body = `{"sessionId":"` + session + `"}`
			case strings.HasSuffix(r.URL.Path, "/tracks/close"):
				closeCalls++
				if closeFail {
					status = 503
					body = `{}`
				} else {
					active = false
					body = `{"tracks":[{"mid":"0"}]}`
				}
			case r.Method == "GET":
				if active {
					body = `{"tracks":[{"mid":"0","status":"active"}]}`
				} else {
					body = `{"tracks":[{"mid":"0","status":"inactive"}]}`
				}
			default:
				body = `{"tracks":[{"mid":"0"}]}`
			}
		} else {
			headers.Set("Content-Type", "application/xml")
			switch {
			case r.Method == "HEAD":
				if uploaded {
					headers.Set("Content-Length", fmt.Sprint(recordingPartSize+1024))
					headers.Set("Content-Type", "video/webm")
				} else {
					status = 404
				}
			case r.Method == "POST" && r.URL.Query().Has("uploads"):
				body = `<InitiateMultipartUploadResult><Bucket>test-bucket</Bucket><Key>recording</Key><UploadId>` + uploadID + `</UploadId></InitiateMultipartUploadResult>`
			case r.Method == "GET" && r.URL.Query().Has("uploadId"):
				body = `<ListPartsResult><IsTruncated>false</IsTruncated><Part><PartNumber>1</PartNumber><ETag>"one"</ETag><Size>16777216</Size></Part>`
				if !incomplete {
					body += `<Part><PartNumber>2</PartNumber><ETag>"two"</ETag><Size>1024</Size></Part>`
				}
				body += `</ListPartsResult>`
			case r.Method == "POST" && r.URL.Query().Has("uploadId"):
				completeCalls++
				uploaded = true
				status = 503
				body = `<Error><Code>ServiceUnavailable</Code></Error>` // Provider committed, reply lost.
			case r.Method == "DELETE":
				status = 204
			default:
				return nil, fmt.Errorf("unexpected provider operation %s %s", r.Method, r.URL.Path)
			}
		}
		return &http.Response{StatusCode: status, Header: headers, Body: io.NopCloser(strings.NewReader(body)), Request: r, ContentLength: func() int64 {
			if r.Method == "HEAD" && uploaded {
				return recordingPartSize + 1024
			}
			return int64(len(body))
		}()}, nil
	})}
	a := &app{db: db, cache: cache, client: client, origin: "https://safety.example", secure: true}
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
		w := request("POST", "/api/login", `{"school":"`+school+`","email":"`+role+`@example.test","password":"integration-password-123"}`, nil)
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		return w.Result().Cookies()[0]
	}
	teacher := login("demo", "teacher")
	student := login("demo", "student")
	other := login("other", "teacher")
	if _, e = db.Exec("UPDATE meetings SET status='live',recording_allowed=TRUE WHERE id='demo-meeting'"); e != nil {
		t.Fatal(e)
	}
	must := func(w *httptest.ResponseRecorder, code int) {
		t.Helper()
		if w.Code != code {
			t.Fatalf("want %d got %d %s", code, w.Code, w.Body.String())
		}
	}
	must(request("GET", "/api/meetings/demo-meeting", "", other), 404)
	must(request("GET", "/api/meetings/demo-meeting", "", student), 200)
	must(request("POST", "/api/meetings/demo-meeting/presence", `{"kind":"join"}`, student), 200)
	must(request("POST", "/api/meetings/demo-meeting/sfu", `{"op":"new"}`, student), 200)
	must(request("POST", "/api/meetings/demo-meeting/media/reset", `{}`, other), 404)
	must(request("POST", "/api/meetings/demo-meeting/media/reset", `{}`, student), 200)
	must(request("POST", "/api/meetings/demo-meeting/sfu", `{"op":"tracks","session_id":"`+session+`","tracks":[{"location":"local","mid":"0","trackName":"camera"}]}`, student), 409)
	cache.Set(ctx, "media-retired:"+session, time.Now().Unix()-61, 0)
	if e = a.cleanupMedia(ctx); e != nil {
		t.Fatal(e)
	}
	var n int
	db.QueryRow("SELECT COUNT(*) FROM media_sessions WHERE id=?", session).Scan(&n)
	if n != 1 {
		t.Fatal("failed cleanup lost session")
	}
	closeFail = false
	if e = a.cleanupMedia(ctx); e != nil {
		t.Fatal(e)
	}
	db.QueryRow("SELECT COUNT(*) FROM media_sessions WHERE id=?", session).Scan(&n)
	if n != 0 || closeCalls != 2 {
		t.Fatal("cleanup not retried", n, closeCalls)
	}
	must(request("POST", "/api/meetings/demo-meeting/recordings/multipart", `{}`, student), 403)
	w := request("POST", "/api/meetings/demo-meeting/recordings/multipart", `{}`, teacher)
	must(w, 201)
	var start struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(w.Body.Bytes(), &start) != nil || start.ID == "" {
		t.Fatal(w.Body.String())
	}
	path := "/api/meetings/demo-meeting/recordings/" + start.ID
	must(request("POST", path+"/parts/1", `{"size":1024}`, other), 404)
	must(request("POST", path+"/parts/1", `{"size":1024}`, student), 403)
	must(request("POST", path+"/parts/513", `{"size":1024}`, teacher), 400)
	must(request("POST", path+"/parts/1", `{"size":0}`, teacher), 400)
	must(request("POST", path+"/parts/1", `{"size":16777216}`, teacher), 200)
	must(request("POST", path+"/finish", `{"parts":2}`, teacher), 409)
	incomplete = false
	// SDK retries may receive another failure even after the first successful commit.
	w = request("POST", path+"/finish", `{"parts":2}`, teacher)
	must(w, 502)
	must(request("POST", path+"/abort", `{}`, teacher), 409)
	must(request("POST", path+"/finish", `{"parts":2}`, teacher), 200)
	before := completeCalls
	must(request("POST", path+"/finish", `{"parts":2}`, teacher), 200)
	if completeCalls != before {
		t.Fatal("idempotent finish repeated provider completion")
	}
	var state string
	db.QueryRow("SELECT status FROM recordings WHERE id=?", start.ID).Scan(&state)
	if state != "ready" {
		t.Fatal(state)
	}
	adminCookie := login("demo", "admin")
	// Isolate the clock scenario; a class/teacher cannot run two root lessons at once.
	if _, e = db.Exec("UPDATE meetings SET status='ended' WHERE id='demo-meeting'"); e != nil {
		t.Fatal(e)
	}
	testTeachingWindow(t, a, request, teacher, student, adminCookie)
	if _, e = db.Exec("UPDATE meetings SET status='live' WHERE id='demo-meeting'"); e != nil {
		t.Fatal(e)
	}
	testBreakouts(t, a, request, teacher, student, other)
	testRoomDrawing(t, a, request, teacher, student, other)
	testRoomModeration(t, a, request, teacher, student, other)
	testCourseWorkspace(t, a, request, teacher, student, other)
	must(request("POST", "/api/accounts/demo-student/recovery", `{}`, teacher), 403)
	must(request("POST", "/api/accounts/other-student/recovery", `{}`, adminCookie), 404)
	must(request("POST", "/api/accounts/demo-admin/recovery", `{}`, adminCookie), 403)
	issue := func() string {
		w := request("POST", "/api/accounts/demo-teacher/recovery", `{}`, adminCookie)
		must(w, 200)
		var out struct {
			URL string `json:"url"`
		}
		json.Unmarshal(w.Body.Bytes(), &out)
		link, _ := url.Parse(out.URL)
		return strings.TrimPrefix(link.Fragment, "token=")
	}
	oldToken := issue()
	newToken := issue()
	must(request("POST", "/api/reset-password", `{"token":"`+oldToken+`","password":"new-password-12345"}`, nil), 400)
	secret := "JBSWY3DPEHPK3PXP"
	enc, e := encryptOTP(secret)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("INSERT INTO account_security(user_id,secret,last_step) VALUES('demo-teacher',?,0)", enc); e != nil {
		t.Fatal(e)
	}
	must(request("POST", "/api/reset-password", `{"token":"`+newToken+`","password":"new-password-12345"}`, nil), 403)
	key, _ := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secret)
	var counter [8]byte
	binary.BigEndian.PutUint64(counter[:], uint64(time.Now().Unix()/30))
	mac := hmac.New(sha1.New, key)
	mac.Write(counter[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 15
	otp := fmt.Sprintf("%06d", (binary.BigEndian.Uint32(sum[offset:offset+4])&0x7fffffff)%1000000)
	must(request("POST", "/api/reset-password", `{"token":"`+newToken+`","password":"new-password-12345","code":"`+otp+`"}`, nil), 200)
	must(request("GET", "/api/me", "", teacher), 401)
	must(request("POST", "/api/reset-password", `{"token":"`+newToken+`","password":"another-password-12345"}`, nil), 400)
	w = request("GET", "/api/audit?action=account.recovery.complete", "", adminCookie)
	must(w, 200)
	if !strings.Contains(w.Body.String(), "demo-teacher") || strings.Contains(w.Body.String(), newToken) {
		t.Fatal("audit scope/content incorrect")
	}
	must(request("GET", "/api/audit?before=invalid", "", adminCookie), 400)
	cache.Del(ctx, "media-owner:"+session, "media-retired:"+session, "recording-multipart:"+start.ID, "media-sweep-cursor")
}
