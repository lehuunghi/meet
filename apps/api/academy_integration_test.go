package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	mysql "github.com/go-sql-driver/mysql"
	"github.com/redis/go-redis/v9"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestAcademyIntegration(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN unset")
	}
	base, e := sql.Open("mysql", dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer base.Close()
	name := "academy_test_" + uid()
	if _, e = base.Exec("CREATE DATABASE " + name); e != nil {
		t.Fatal(e)
	}
	defer base.Exec("DROP DATABASE " + name)
	config, _ := mysql.ParseDSN(dsn)
	config.DBName = name
	db, e := sql.Open("mysql", config.FormatDSN())
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	if e = migrate(db); e != nil {
		t.Fatal(e)
	}
	t.Setenv("CONFIG_DIR", t.TempDir())
	t.Setenv("LOGIN_SCHOOL", "academy")
	cfg := systemSettings{Platform: "school", Retention: 30, Commerce: commerceSettings{FreeVideos: 4, BankBIN: "970436", BankAccount: "123456789", ChecksumKey: "test-checksum"}, R2: r2Settings{Enabled: true, Account: "test", Bucket: "test-bucket", Access: "test-access", Secret: "test-secret"}}
	if e = saveSettings(cfg); e != nil {
		t.Fatal(e)
	}
	opt, _ := redis.ParseURL(os.Getenv("TEST_REDIS_URL"))
	cache := redis.NewClient(opt)
	defer cache.Close()
	a := &app{db: db, cache: cache, client: &http.Client{Timeout: time.Second}, origin: "https://academy.example", secure: true}
	ctx := context.Background()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, e := db.Exec(q, args...); e != nil {
			t.Fatal(e)
		}
	}
	exec("INSERT INTO schools(id,slug,name) VALUES('academy-school','academy','Trung tâm thử'),('academy-other','other','Khác')")
	for _, u := range []struct{ ID, School, Role string }{{"ac-admin", "academy-school", "admin"}, {"ac-student", "academy-school", "student"}, {"ac-teacher", "academy-school", "teacher"}, {"ac-limited", "academy-school", "admin"}, {"ac-other", "academy-other", "admin"}} {
		exec("INSERT INTO users(id,school_id,name,email,password_hash,role) VALUES(?,?,?,?,?,?)", u.ID, u.School, "Người dùng thử", u.ID+"@example.test", "test-only-hash", u.Role)
	}
	exec("INSERT INTO user_controls(user_id,state,permissions) VALUES('ac-limited','active','[\"content\"]')")
	exec("INSERT INTO classes(id,school_id,name) VALUES('ac-class','academy-school','Lớp Live')")
	exec("INSERT INTO courses(id,school_id,class_id,teacher_id,name) VALUES('ac-math','academy-school','ac-class','ac-teacher','Toán')")
	exec("INSERT INTO meetings(id,school_id,course_id,title,starts_at,status) VALUES('ac-meeting','academy-school','ac-math','Buổi học',UTC_TIMESTAMP(),'live')")
	exec("INSERT INTO enrollments(school_id,class_id,user_id) VALUES('academy-school','ac-class','ac-student')")
	exec("INSERT INTO academy_profiles(school_id,user_id,dob,address,school_name,phone,parent_phone,email_verified) VALUES('academy-school','ac-student','2010-01-01','Địa chỉ','Trường học','0901234567','0912345678',TRUE)")
	exec("INSERT INTO academy_courses(id,school_id,title,description,teacher_name,academic_course_id,published) VALUES('ac-course','academy-school','Khóa Toán','Giới thiệu','Giáo viên','ac-math',TRUE)")
	exec("INSERT INTO academy_plans(id,school_id,name,price_vnd,days,live_enabled) VALUES('ac-plan','academy-school','VIP',100000,30,TRUE)")
	for i := 0; i < 7; i++ {
		exec("INSERT INTO academy_lessons(id,school_id,course_id,title,object_key,bucket,status,duration_seconds) VALUES(?,'academy-school','ac-course',?,?,'test-bucket','ready',600)", fmt.Sprintf("lesson-%d", i), fmt.Sprintf("Bài %d", i), fmt.Sprintf("academy/vod/test/%d.mp4", i))
	}
	cookie := func(id, school, role string) *http.Cookie {
		token := uid()
		u := identity{ID: id, School: school, Role: role, Version: 1}
		raw, _ := json.Marshal(u)
		cache.Set(ctx, "session:"+digest(token), string(raw), time.Hour)
		cache.Set(ctx, "current-session:"+id, digest(token), time.Hour)
		t.Cleanup(func() { cache.Del(ctx, "session:"+digest(token), "current-session:"+id) })
		return &http.Cookie{Name: "meet_session", Value: token}
	}
	admin := cookie("ac-admin", "academy-school", "admin")
	student := cookie("ac-student", "academy-school", "student")
	limited := cookie("ac-limited", "academy-school", "admin")
	other := cookie("ac-other", "academy-other", "admin")
	h := a.routes()
	request := func(method, path, body string, c *http.Cookie) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Origin", a.origin)
		if c != nil {
			r.AddCookie(c)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	must := func(w *httptest.ResponseRecorder, status int) {
		t.Helper()
		if w.Code != status {
			t.Fatalf("want %d got %d: %s", status, w.Code, w.Body.String())
		}
	}
	must(request("GET", "/api/academy/courses", "", nil), 404)
	must(request("GET", "/api/meetings/ac-meeting", "", student), 200)
	cfg.Platform = "academy"
	if e = saveSettings(cfg); e != nil {
		t.Fatal(e)
	}
	must(request("GET", "/api/meetings/ac-meeting", "", student), 402)
	must(request("GET", "/api/academy/admin/orders", "", limited), 403)
	must(request("GET", "/api/academy/control/people", "", limited), 403)
	must(request("GET", "/api/academy/control/classes", "", limited), 403)
	must(request("GET", "/api/academy/control/people", "", student), 403)
	must(request("GET", "/api/academy/control/people", "", admin), 200)
	must(request("POST", "/api/academy/lessons/lesson-0/play", "{}", other), 404)
	for i := 0; i < 3; i++ {
		must(request("POST", fmt.Sprintf("/api/academy/lessons/lesson-%d/play", i), "{}", student), 200)
	}
	must(request("POST", "/api/academy/lessons/lesson-0/play", "{}", student), 200)
	var lock sync.Mutex
	accepted := 0
	var wg sync.WaitGroup
	for i := 3; i < 7; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			w := request("POST", fmt.Sprintf("/api/academy/lessons/lesson-%d/play", i), "{}", student)
			lock.Lock()
			defer lock.Unlock()
			if w.Code == 200 {
				accepted++
			} else if w.Code != 402 {
				t.Errorf("quota response %d %s", w.Code, w.Body.String())
			}
		}(i)
	}
	wg.Wait()
	if accepted != 1 {
		t.Fatalf("quota race: %d requests accepted", accepted)
	}
	order := request("POST", "/api/academy/orders", `{"plan_id":"ac-plan"}`, student)
	must(order, 201)
	var out map[string]any
	_ = json.Unmarshal(order.Body.Bytes(), &out)
	id := out["id"].(string)
	exec("UPDATE academy_plans SET days=1,price_vnd=1 WHERE id='ac-plan'")
	must(request("POST", "/api/academy/orders/"+id+"/review", `{"action":"approve"}`, limited), 403)
	must(request("POST", "/api/academy/orders/"+id+"/review", `{"action":"approve"}`, other), 404)
	must(request("POST", "/api/academy/orders/"+id+"/review", `{"action":"approve"}`, admin), 200)
	var until time.Time
	if db.QueryRow("SELECT expires_at FROM academy_memberships WHERE user_id='ac-student'").Scan(&until) != nil {
		t.Fatal("missing membership")
	}
	if time.Until(until) < 29*24*time.Hour {
		t.Fatal("plan edits changed order snapshot")
	}
	must(request("POST", "/api/academy/orders/"+id+"/review", `{"action":"approve"}`, admin), 200)
	var again time.Time
	_ = db.QueryRow("SELECT expires_at FROM academy_memberships WHERE user_id='ac-student'").Scan(&again)
	if !again.Equal(until) {
		t.Fatal("duplicate approval extended VIP")
	}
	must(request("GET", "/api/meetings/ac-meeting", "", student), 200)
	must(request("POST", "/api/academy/lessons/lesson-6/play", "{}", student), 200)
	must(request("POST", "/api/academy/site", `{"content":{"headline":"Học tốt","description":"Tiếng Việt đầy đủ","published":true}}`, admin), 200)
	web := request("GET", "/website", "", nil)
	must(web, 200)
	if !strings.Contains(web.Body.String(), "Học tốt") || strings.Contains(web.Body.String(), "test-secret") {
		t.Fatal("SSR content/secret failure")
	}
	bad := request("POST", "/api/academy/webhooks/payos", `{"success":true,"data":{"amount":1000},"signature":"00"}`, nil)
	must(bad, 403)
}
