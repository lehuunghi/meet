package main

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func exerciseLiveDirectory(t *testing.T, a *app, db *sql.DB, request func(string, string, string, *http.Cookie) *httptest.ResponseRecorder, cookie func(string, string, string) *http.Cookie) {
	t.Helper()
	exec := func(q string) {
		t.Helper()
		if _, e := db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	must := func(r *httptest.ResponseRecorder, want int) {
		t.Helper()
		if r.Code != want {
			t.Fatalf("live directory want %d got %d %s", want, r.Code, r.Body.String())
		}
	}
	exec("INSERT INTO users(id,school_id,name,email,password_hash,role) VALUES('directory-free','academy-school','Free learner','dir-free@example.test','hash','student'),('directory-vip','academy-school','VIP learner','dir-vip@example.test','hash','student'),('directory-expired','academy-school','Expired learner','dir-expired@example.test','hash','student')")
	exec("INSERT INTO classes(id,school_id,name) VALUES('directory-class','academy-school','Lớp mới'),('directory-foreign-class','academy-other','Ngoài đơn vị')")
	exec("INSERT INTO courses(id,school_id,class_id,name) VALUES('directory-subject','academy-school','directory-class','Toán mở'),('directory-foreign-subject','academy-other','directory-foreign-class','Ngoài đơn vị')")
	exec("INSERT INTO meetings(id,school_id,course_id,title,starts_at,status) VALUES('directory-live','academy-school','directory-subject','Live mở',UTC_TIMESTAMP(),'live'),('directory-preparing','academy-school','directory-subject','Chuẩn bị',UTC_TIMESTAMP(),'scheduled'),('directory-ended','academy-school','directory-subject','Đã xong',UTC_TIMESTAMP(),'ended'),('directory-foreign','academy-other','directory-foreign-subject','PRIVATE-FOREIGN-ROOM',UTC_TIMESTAMP(),'live')")
	exec("INSERT INTO academy_memberships VALUES('academy-school','directory-vip',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 DAY),FALSE),('academy-school','directory-expired',DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY),TRUE)")
	free := cookie("directory-free", "academy-school", "student")
	vip := cookie("directory-vip", "academy-school", "student")
	expired := cookie("directory-expired", "academy-school", "student")
	list := request("GET", "/api/academy/live-classes", "", free)
	must(list, 200)
	for _, text := range []string{"directory-live", "directory-preparing"} {
		if !strings.Contains(list.Body.String(), text) {
			t.Fatal("unenrolled learner cannot discover room")
		}
	}
	for _, text := range []string{"directory-ended", "PRIVATE-FOREIGN-ROOM", "dir-free@example.test", "password", "object_key"} {
		if strings.Contains(list.Body.String(), text) {
			t.Fatal("discovery leaked private or inactive data", text)
		}
	}
	must(request("GET", "/api/academy/live-classes?page=-1", "", free), 400)
	must(request("GET", "/api/meetings/directory-live", "", free), 404)
	must(request("POST", "/api/academy/live-classes/directory-live/enter", "{}", free), 402)
	must(request("POST", "/api/academy/live-classes/directory-live/enter", "{}", expired), 402)
	var n int
	_ = db.QueryRow("SELECT COUNT(*) FROM enrollments WHERE class_id='directory-class'").Scan(&n)
	if n != 0 {
		t.Fatal("viewing or rejected entry enrolled a student")
	}
	must(request("POST", "/api/academy/live-classes/directory-preparing/enter", "{}", vip), 409)
	must(request("POST", "/api/academy/live-classes/directory-ended/enter", "{}", vip), 409)
	must(request("POST", "/api/academy/live-classes/directory-foreign/enter", "{}", vip), 404)
	filtered := request("GET", "/api/academy/live-classes?status=scheduled&q=To%C3%A1n", "", free)
	must(filtered, 200)
	if strings.Contains(filtered.Body.String(), "directory-live") {
		t.Fatal("status filter ignored")
	}
	must(request("POST", "/api/academy/live-classes/directory-live/enter", "{}", vip), 200)
	must(request("POST", "/api/academy/live-classes/directory-live/enter", "{}", vip), 200)
	_ = db.QueryRow("SELECT COUNT(*) FROM enrollments WHERE class_id='directory-class' AND user_id='directory-vip'").Scan(&n)
	if n != 1 {
		t.Fatal("duplicate enrollment")
	}
	must(request("GET", "/api/meetings/directory-live", "", vip), 200)
	exec("UPDATE academy_memberships SET expires_at=UTC_TIMESTAMP()-INTERVAL 1 SECOND WHERE user_id='directory-vip'")
	must(request("GET", "/api/meetings/directory-live", "", vip), 402)
	exec("INSERT INTO class_controls(school_id,class_id,state) VALUES('academy-school','directory-class','suspended')")
	list = request("GET", "/api/academy/live-classes", "", free)
	must(list, 200)
	if strings.Contains(list.Body.String(), "directory-live") {
		t.Fatal("suspended class visible")
	}
	exec("UPDATE meetings SET status='ended' WHERE school_id='academy-school' AND id LIKE 'directory-%'")
}
