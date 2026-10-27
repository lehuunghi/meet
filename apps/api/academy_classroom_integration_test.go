package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"golang.org/x/crypto/bcrypt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func exerciseAcademyClassroom(t *testing.T, a *app, db *sql.DB, request func(string, string, string, *http.Cookie) *httptest.ResponseRecorder, cookie func(string, string, string) *http.Cookie, admin, student, other *http.Cookie) {
	t.Helper()
	var lastRequest string
	originalRequest := request
	request = func(method, path, body string, c *http.Cookie) *httptest.ResponseRecorder {
		lastRequest = method + " " + path
		return originalRequest(method, path, body, c)
	}
	exec := func(q string, args ...any) {
		t.Helper()
		if _, e := db.Exec(q, args...); e != nil {
			t.Fatal(e)
		}
	}
	must := func(r *httptest.ResponseRecorder, n int) {
		t.Helper()
		if r.Code != n {
			t.Fatalf("%s: want %d got %d: %s", lastRequest, n, r.Code, r.Body.String())
		}
	}
	getID := func(r *httptest.ResponseRecorder) string {
		t.Helper()
		var data map[string]any
		if json.Unmarshal(r.Body.Bytes(), &data) != nil || data["id"] == nil {
			t.Fatal("missing id", r.Body.String())
		}
		return data["id"].(string)
	}
	hash, _ := bcrypt.GenerateFromPassword([]byte("secret123"), 4)
	exec("INSERT INTO users(id,school_id,name,email,password_hash,role,short_id) VALUES('link-buyer','academy-school','HS thử','buyer@example.test',?,'student','SV0901'),('link-teacher','academy-school','GV thử','link-teacher@example.test',?,'teacher','GV0901')", hash, hash)
	exec("INSERT INTO academy_profiles(school_id,user_id,dob,address,school_name,phone,parent_phone,email_verified) VALUES('academy-school','link-buyer','2010-01-01','Hà Nội','Trường thử','0901234567','0912345678',TRUE)")
	exec("INSERT INTO classes(id,school_id,name) VALUES('link-class','academy-school','Lớp QA')")
	exec("INSERT INTO courses(id,school_id,class_id,teacher_id,name) VALUES('link-subject','academy-school','link-class','link-teacher','Môn liên kết')")
	exec("INSERT INTO academy_courses(id,school_id,title,description,academic_course_id,published) VALUES('link-course','academy-school','Khóa liên kết','Thử','link-subject',TRUE),('foreign-linked','academy-other','Ngoài đơn vị','Thử',NULL,TRUE)")
	exec("INSERT INTO academy_lessons(id,school_id,course_id,title,object_key,bucket,status,duration_seconds,size_bytes) VALUES('link-video','academy-school','link-course','Bài thử','academy/vod/test/video.webm','test-bucket','ready',600,100),('foreign-video','academy-other','foreign-linked','Không thuộc quyền','academy/vod/foreign/video.webm','test-bucket','ready',600,100)")
	buyer := cookie("link-buyer", "academy-school", "student")
	teacher := cookie("link-teacher", "academy-school", "teacher")
	videoPlan := request("POST", "/api/academy/plans", `{"name":"Video QA","price_vnd":123000,"days":30,"live_enabled":false,"active":true}`, admin)
	must(videoPlan, 200)
	videoPlanID := getID(videoPlan)
	livePlan := request("POST", "/api/academy/plans", `{"name":"Live QA","price_vnd":223000,"days":7,"live_enabled":true,"active":true}`, admin)
	must(livePlan, 200)
	livePlanID := getID(livePlan)
	purchase := func(plan string) string {
		t.Helper()
		r := request("POST", "/api/academy/orders", fmt.Sprintf(`{"plan_id":"%s"}`, plan), buyer)
		must(r, 201)
		return getID(r)
	}
	approve := func(id string) {
		t.Helper()
		must(request("POST", "/api/academy/orders/"+id+"/review", `{"action":"approve"}`, admin), 200)
	}
	pending := purchase(videoPlanID)
	if a.hasVIP(context.Background(), "academy-school", "link-buyer", false) {
		t.Fatal("pending purchase unlocked VIP")
	}
	for i := 0; i < 4; i++ {
		must(request("POST", fmt.Sprintf("/api/academy/lessons/lesson-%d/play", i), "{}", buyer), 200)
	}
	must(request("POST", "/api/academy/lessons/lesson-4/play", "{}", buyer), 402)
	approve(pending)
	if !a.hasVIP(context.Background(), "academy-school", "link-buyer", false) || a.hasVIP(context.Background(), "academy-school", "link-buyer", true) {
		t.Fatal("video purchase entitlement incorrect")
	}
	for _, id := range []string{"lesson-4", "lesson-5", "lesson-6", "link-video"} {
		must(request("POST", "/api/academy/lessons/"+id+"/play", "{}", buyer), 200)
	}
	must(request("POST", "/api/academy/lessons/foreign-video/play", "{}", buyer), 404)
	exec("UPDATE academy_courses SET published=FALSE WHERE id='link-course'")
	must(request("POST", "/api/academy/lessons/link-video/play", "{}", buyer), 404)
	exec("UPDATE academy_courses SET published=TRUE WHERE id='link-course'")
	must(request("POST", "/api/academy/courses/link-course/enroll", "{}", buyer), 402)
	liveOrder := purchase(livePlanID)
	approve(liveOrder)
	if !a.hasVIP(context.Background(), "academy-school", "link-buyer", true) {
		t.Fatal("paid Live order did not unlock Live")
	}
	var liveUntil time.Time
	_ = db.QueryRow("SELECT expires_at FROM academy_live_memberships WHERE user_id='link-buyer'").Scan(&liveUntil)
	approve(purchase(videoPlanID))
	var after time.Time
	_ = db.QueryRow("SELECT expires_at FROM academy_live_memberships WHERE user_id='link-buyer'").Scan(&after)
	if !after.Equal(liveUntil) {
		t.Fatal("video renewal changed purchased Live period")
	}
	approve(liveOrder)
	_ = db.QueryRow("SELECT expires_at FROM academy_live_memberships WHERE user_id='link-buyer'").Scan(&after)
	if !after.Equal(liveUntil) {
		t.Fatal("duplicate review extended Live twice")
	}
	must(request("POST", "/api/academy/courses/link-course/enroll", "{}", buyer), 200)
	must(request("POST", "/api/academy/courses/link-course/enroll", "{}", buyer), 200)
	var enrollments int
	_ = db.QueryRow("SELECT COUNT(*) FROM enrollments WHERE class_id='link-class' AND user_id='link-buyer'").Scan(&enrollments)
	if enrollments != 1 {
		t.Fatal("duplicate class enrollment")
	}
	must(request("GET", "/api/academy/classrooms/link-subject/courses", "", buyer), 200)
	must(request("GET", "/api/academy/classrooms/link-subject/courses", "", teacher), 200)
	must(request("GET", "/api/academy/classrooms/link-subject/courses", "", other), 404)
	must(request("POST", "/api/classes/link-class/manage", `{"name":"Lớp QA đã sửa","state":"active","revision":0}`, admin), 200)
	prepared := request("POST", "/api/courses/link-subject/prepare", "{}", teacher)
	must(prepared, 200)
	meeting := getID(prepared)
	must(request("POST", "/api/meetings/"+meeting+"/state", `{"status":"live"}`, teacher), 200)
	must(request("POST", "/api/classes/link-class/manage", `{"name":"Lớp QA đã sửa","state":"suspended","revision":1}`, admin), 409)
	must(request("POST", "/api/meetings/"+meeting+"/state", `{"status":"ended"}`, teacher), 200)
	must(request("POST", "/api/classes/link-class/manage", `{"name":"Lớp QA đã sửa","state":"suspended","revision":1}`, admin), 200)
	must(request("POST", "/api/courses/link-subject/prepare", "{}", teacher), 409)
	must(request("POST", "/api/academy/courses/link-course/enroll", "{}", buyer), 409)
	must(request("POST", "/api/academy/lessons/link-video/play", "{}", buyer), 200)
	must(request("POST", "/api/classes/link-class/manage", `{"name":"Lớp QA đã sửa","state":"active","revision":1}`, admin), 409)
	must(request("POST", "/api/classes/link-class/manage", `{"name":"Lớp QA đã sửa","state":"active","revision":2}`, admin), 200)
	must(request("POST", "/api/classes/link-class/manage", `{"name":"Lớp QA đã sửa","state":"deleted","confirm":"Sai","revision":3}`, admin), 409)
	must(request("POST", "/api/classes/link-class/manage", `{"name":"Lớp QA đã sửa","state":"deleted","confirm":"Lớp QA đã sửa","revision":3}`, admin), 200)
	must(request("POST", "/api/classes/link-class/manage", `{"name":"Lớp QA đã sửa","state":"active","revision":4}`, admin), 409)
	if strings.Contains(request("GET", "/api/classes", "", admin).Body.String(), "link-class") || !strings.Contains(request("GET", "/api/classes?include_deleted=1", "", admin).Body.String(), "link-class") {
		t.Fatal("class archival visibility incorrect")
	}
	must(request("POST", "/api/courses/link-subject/prepare", "{}", teacher), 409)
	must(request("POST", "/api/academy/lessons/link-video/play", "{}", buyer), 200)
	var revision int
	_ = db.QueryRow("SELECT revision FROM users WHERE id='link-teacher'").Scan(&revision)
	must(request("POST", "/api/teachers/batch", fmt.Sprintf(`{"rows":[{"id":"link-teacher","name":"GV đã sửa","email":"link-teacher@example.test","password":"","revision":%d}]}`, revision), admin), 200)
	login := request("POST", "/api/login", `{"email":"link-teacher@example.test","password":"secret123"}`, nil)
	must(login, 200)
	teacher = login.Result().Cookies()[0]
	must(request("GET", "/api/catalog", "", teacher), 200)
	_ = db.QueryRow("SELECT revision FROM users WHERE id='link-teacher'").Scan(&revision)
	must(request("POST", "/api/accounts", fmt.Sprintf(`{"id":"link-teacher","state":"suspended","permissions":[],"revision":%d}`, revision), admin), 200)
	must(request("GET", "/api/catalog", "", teacher), 401)
	_ = db.QueryRow("SELECT revision FROM users WHERE id='link-teacher'").Scan(&revision)
	must(request("POST", "/api/accounts", fmt.Sprintf(`{"id":"link-teacher","state":"active","permissions":[],"revision":%d}`, revision), admin), 200)
	_ = db.QueryRow("SELECT revision FROM users WHERE id='link-teacher'").Scan(&revision)
	must(request("POST", "/api/accounts/link-teacher/delete", fmt.Sprintf(`{"confirm":"link-teacher@example.test","revision":%d}`, revision), admin), 200)
	must(request("POST", "/api/academy/lessons/link-video/play", "{}", buyer), 200)
	exec("UPDATE academy_memberships SET expires_at=UTC_TIMESTAMP()-INTERVAL 1 DAY WHERE user_id='link-buyer'")
	must(request("POST", "/api/academy/lessons/link-video/play", "{}", buyer), 402)
}
