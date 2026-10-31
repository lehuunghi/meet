package main

import (
	"context"
	"database/sql"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func exerciseAcademyCleanup(t *testing.T, a *app, db *sql.DB, request func(string, string, string, *http.Cookie) *httptest.ResponseRecorder, cookie func(string, string, string) *http.Cookie, admin, student, limited, other *http.Cookie) {
	t.Helper()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, e := db.Exec(q, args...); e != nil {
			t.Fatal(e)
		}
	}
	must := func(r *httptest.ResponseRecorder, status int) {
		t.Helper()
		if r.Code != status {
			t.Fatalf("cleanup want %d got %d: %s", status, r.Code, r.Body.String())
		}
	}
	count := func(q string) int {
		t.Helper()
		var n int
		if e := db.QueryRow(q).Scan(&n); e != nil {
			t.Fatal(e)
		}
		return n
	}
	url := "/api/academy/admin/data-cleanup"
	must(request("GET", url+"?kind=all", "", student), 403)
	must(request("POST", url, `{"kind":"all","confirm":"XÓA"}`, limited), 403)
	exec("UPDATE meetings SET status='ended' WHERE school_id='academy-school'")
	exec("INSERT INTO meetings(id,school_id,course_id,title,starts_at,status) VALUES('cleanup-meeting','academy-school','ac-math','Buổi cần xóa',UTC_TIMESTAMP()-INTERVAL 1 DAY,'live')")
	exec("INSERT INTO presence(school_id,meeting_id,user_id,joined_at,last_seen,seconds) VALUES('academy-school','cleanup-meeting','ac-student',UTC_TIMESTAMP(),UTC_TIMESTAMP(),600)")
	exec("INSERT INTO attendance_events(school_id,meeting_id,user_id,kind) VALUES('academy-school','cleanup-meeting','ac-student','join')")
	must(request("POST", url, `{"kind":"attendance","meeting_id":"cleanup-meeting","confirm":"XÓA"}`, admin), 409)
	exec("UPDATE meetings SET status='ended' WHERE id='cleanup-meeting'")
	must(request("POST", url, `{"kind":"attendance","meeting_id":"cleanup-meeting","confirm":"wrong"}`, admin), 400)
	must(request("POST", url, `{"kind":"attendance","meeting_id":"cleanup-meeting","confirm":"XÓA"}`, other), 404)
	must(request("POST", url, `{"kind":"attendance","meeting_id":"cleanup-meeting","confirm":"XÓA"}`, admin), 200)
	for _, table := range []string{"presence", "attendance_events"} {
		if count("SELECT COUNT(*) FROM "+table+" WHERE meeting_id='cleanup-meeting'") != 0 {
			t.Fatal("attendance retained", table)
		}
	}
	report := request("GET", "/api/attendance/report?class_id=ac-class&course_id=ac-math&meeting_id=cleanup-meeting", "", admin)
	must(report, 200)
	if strings.Contains(report.Body.String(), "ac-student") {
		t.Fatal("erased session reappeared as absent")
	}
	exec("INSERT INTO recordings(id,school_id,meeting_id,owner_id,object_key,bucket,status,created_at,expires_at) VALUES('cleanup-rec','academy-school','cleanup-meeting','ac-admin','recordings/academy-school/cleanup-meeting/cleanup-rec.webm','test-bucket','ready',UTC_TIMESTAMP()-INTERVAL 1 DAY,UTC_TIMESTAMP()+INTERVAL 1 DAY)")
	must(request("POST", url, `{"kind":"videos","recording_id":"cleanup-rec","confirm":"XÓA"}`, other), 404)
	exec("UPDATE recordings SET created_at=UTC_TIMESTAMP() WHERE id='cleanup-rec'")
	must(request("POST", url, `{"kind":"videos","recording_id":"cleanup-rec","confirm":"XÓA"}`, admin), 409)
	exec("UPDATE recordings SET created_at=UTC_TIMESTAMP()-INTERVAL 1 DAY WHERE id='cleanup-rec'")
	exec("INSERT INTO academy_lessons(id,school_id,course_id,title,object_key,bucket,status,created_at) VALUES('cleanup-lesson','academy-school','ac-course','Video xóa','academy/vod/academy-school/cleanup-lesson.mp4','test-bucket','ready',UTC_TIMESTAMP()-INTERVAL 1 DAY)")
	exec("INSERT INTO academy_lesson_details(school_id,lesson_id,course_id,notes) VALUES('academy-school','cleanup-lesson','ac-course','Ghi chú riêng')")
	exec("INSERT INTO academy_views VALUES('academy-school','ac-student','2026-10','cleanup-lesson')")
	exec("INSERT INTO academy_progress(school_id,user_id,lesson_id,seconds) VALUES('academy-school','ac-student','cleanup-lesson',100)")
	members := count("SELECT COUNT(*) FROM academy_memberships")
	must(request("POST", url, `{"kind":"videos","recording_id":"cleanup-rec","confirm":"XÓA"}`, admin), 200)
	must(request("GET", "/api/meetings/cleanup-meeting/recordings/cleanup-rec/download", "", admin), 404)
	if count("SELECT COUNT(*) FROM academy_lessons WHERE id='cleanup-lesson'") != 1 {
		t.Fatal("recording delete removed independent lesson")
	}
	must(request("POST", url, `{"kind":"videos","lesson_id":"cleanup-lesson","confirm":"XÓA"}`, admin), 200)
	for _, table := range []string{"academy_views", "academy_progress", "academy_lesson_details"} {
		if count("SELECT COUNT(*) FROM "+table+" WHERE lesson_id='cleanup-lesson'") != 0 {
			t.Fatal("lesson children retained")
		}
	}
	if count("SELECT COUNT(*) FROM academy_lessons WHERE id='cleanup-lesson'") != 0 || count("SELECT COUNT(*) FROM academy_memberships") != members {
		t.Fatal("deletion scope incorrect")
	}
	// R2 failure must retain a durable retry. Credentials never appear in status.
	old := a.client
	defer func() { a.client = old }()
	fail := true
	deletes := 0
	a.client = &http.Client{Transport: testTransport(func(r *http.Request) (*http.Response, error) {
		if r.Method != "DELETE" {
			t.Fatal("unexpected object mutation", r.Method)
		}
		deletes++
		status := 204
		body := ""
		if fail {
			status = 403
			body = "<Error><Code>AccessDenied</Code></Error>"
		}
		return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}, nil
	})}
	if a.cleanupDeletedMedia(context.Background()) == nil || count("SELECT COUNT(*) FROM media_delete_queue WHERE completed_at IS NULL") != 2 {
		t.Fatal("failed R2 delete lost retry")
	}
	fail = false
	if e := a.cleanupDeletedMedia(context.Background()); e != nil {
		t.Fatal(e)
	}
	if e := a.cleanupDeletedMedia(context.Background()); e != nil {
		t.Fatal(e)
	}
	if count("SELECT COUNT(*) FROM media_delete_queue WHERE completed_at IS NULL") != 0 || deletes != 3 {
		t.Fatal("R2 deletion did not finish")
	}
	teacher := cookie("ac-teacher", "academy-school", "teacher")
	staffProfile := `{"name":"Giáo viên","dob":"1990-01-01","address":"Hà Nội","phone":"0901234567"}`
	must(request("POST", "/api/academy/profile", staffProfile, teacher), 200)
	must(request("POST", "/api/academy/profile", staffProfile, admin), 200)
	must(request("POST", "/api/academy/profile", staffProfile, student), 400)
}
