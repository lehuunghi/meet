package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/xuri/excelize/v2"
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
	// Teacher-only XLSX never accepts a role column and returns no passwords.
	book := excelize.NewFile()
	teacherEmail := "xlsx-" + uid()[:8] + "@example.test"
	for i, row := range [][]any{{"email", "name", "password"}, {teacherEmail, "XLSX Teacher", "teacher-password-123"}} {
		cell, _ := excelize.CoordinatesToCellName(1, i+1)
		if err := book.SetSheetRow("Sheet1", cell, &row); err != nil {
			t.Fatal(err)
		}
	}
	xlsx, err := book.WriteToBuffer()
	book.Close()
	if err != nil {
		t.Fatal(err)
	}
	var upload bytes.Buffer
	form := multipart.NewWriter(&upload)
	part, _ := form.CreateFormFile("file", "teachers.xlsx")
	part.Write(xlsx.Bytes())
	form.Close()
	req := httptest.NewRequest("POST", "/api/teachers/import", &upload)
	req.Header.Set("Origin", a.origin)
	req.Header.Set("Content-Type", form.FormDataContentType())
	req.AddCookie(administrator)
	response := httptest.NewRecorder()
	h.ServeHTTP(response, req)
	if response.Code != 200 || strings.Contains(response.Body.String(), "teacher-password-123") {
		t.Fatalf("teacher XLSX: %s", response.Body)
	}
	var importedRole, importedShort string
	if db.QueryRow("SELECT role,short_id FROM users WHERE school_id='school-demo' AND email=?", teacherEmail).Scan(&importedRole, &importedShort) != nil || importedRole != "teacher" || !strings.HasPrefix(importedShort, "GV") {
		t.Fatal("teacher import did not force role/short ID")
	}
	// Editable academic tables: unassigned courses, short IDs, student-code login and separate assignment.
	classResult := request("POST", "/api/classes", `{"name":"Academic-`+uid()[:8]+`"}`, administrator)
	var created map[string]string
	if classResult.Code != 201 || json.Unmarshal(classResult.Body.Bytes(), &created) != nil || !strings.HasPrefix(created["short_id"], "LH") {
		t.Fatalf("short class: %s", classResult.Body)
	}
	classID := created["id"]
	classCode := created["short_id"]
	w = request("POST", "/api/classes/"+classCode+"/courses/batch", `{"rows":[{"name":"Toán mới"},{"name":"Lý mới"}]}`, administrator)
	if w.Code != 200 {
		t.Fatalf("unassigned subjects: %s", w.Body)
	}
	w = request("GET", "/api/catalog", "", administrator)
	var catalog []map[string]any
	if json.Unmarshal(w.Body.Bytes(), &catalog) != nil {
		t.Fatal("catalog")
	}
	var courseID, courseCode string
	for _, v := range catalog {
		if v["class_id"] == classID && v["name"] == "Toán mới" {
			courseID = v["id"].(string)
			courseCode = v["short_id"].(string)
			if v["teacher_id"] != nil {
				t.Fatal("new subject unexpectedly assigned")
			}
		}
	}
	if courseCode == "" {
		t.Fatal("unassigned course absent from catalog")
	}
	studentEmail := "academic-" + uid()[:8] + "@example.test"
	studentCode := "TESTSV" + strings.ToUpper(uid()[:8])
	body := `{"rows":[{"email":"` + studentEmail + `","student_code":"` + studentCode + `","name":"Academic Student","password":"academic-password-123"}]}`
	if w = request("POST", "/api/classes/"+classCode+"/students/batch", body, administrator); w.Code != 200 {
		t.Fatalf("student batch: %s", w.Body)
	}
	w = request("GET", "/api/classes/"+classCode+"/students", "", administrator)
	var enrolled []map[string]any
	if json.Unmarshal(w.Body.Bytes(), &enrolled) != nil || len(enrolled) != 1 || !strings.HasPrefix(enrolled[0]["short_id"].(string), "SV") {
		t.Fatalf("short student ID: %s", w.Body)
	}
	studentShort := enrolled[0]["short_id"].(string)
	studentID := enrolled[0]["id"].(string)
	if w = request("POST", "/api/classes/"+classCode+"/students/batch", `{"rows":[{"id":"`+studentShort+`","revision":1,"email":"`+studentEmail+`","student_code":"`+studentCode+`","name":"Academic Student Edited","password":""}]}`, administrator); w.Code != 200 {
		t.Fatalf("inline student edit: %s", w.Body)
	}
	w = request("POST", "/api/login", `{"school":"demo","email":"`+strings.ToLower(studentCode)+`","password":"academic-password-123"}`, nil)
	if w.Code != 200 {
		t.Fatalf("student code login: %s", w.Body)
	}
	academicStudent := w.Result().Cookies()[0]
	if w = request("GET", "/api/classes/"+classCode+"/students", "", student); w.Code != 403 {
		t.Fatal("student accessed admin table")
	}
	var teacherShort string
	if e = db.QueryRow("SELECT short_id FROM users WHERE id='demo-teacher'").Scan(&teacherShort); e != nil {
		t.Fatal(e)
	}
	if w = request("POST", "/api/assignments", `{"rows":[{"course_id":"`+courseCode+`","teacher_id":"`+teacherShort+`","revision":1}]}`, administrator); w.Code != 200 {
		t.Fatalf("short-ID assignment: %s", w.Body)
	}
	if w = request("POST", "/api/classes/"+classCode+"/courses/batch", `{"rows":[{"id":"`+courseCode+`","name":"Stale","revision":1}]}`, administrator); w.Code != 409 {
		t.Fatal("stale edit accepted")
	}
	if w = request("POST", "/api/assignments", `{"rows":[{"course_id":"`+courseCode+`","teacher_id":"other-teacher","revision":2}]}`, administrator); w.Code != 404 {
		t.Fatal("cross-school teacher assigned")
	}
	if w = request("POST", "/api/classes/other-class/students/batch", body, administrator); w.Code != 404 {
		t.Fatal("cross-school class write")
	}
	newEmail := "rollback-" + uid()[:8] + "@example.test"
	if w = request("POST", "/api/classes/"+classCode+"/students/batch", `{"rows":[{"email":"`+newEmail+`","student_code":"ROLLBACK1","name":"New","password":"academic-password-123"},{"email":"`+studentEmail+`","student_code":"ROLLBACK2","name":"Duplicate","password":"academic-password-123"}]}`, administrator); w.Code != 409 {
		t.Fatal("duplicate not rejected")
	}
	var rollbackCount int
	db.QueryRow("SELECT COUNT(*) FROM users WHERE school_id='school-demo' AND email=?", newEmail).Scan(&rollbackCount)
	if rollbackCount != 0 {
		t.Fatal("partial bulk insert committed")
	}
	w = request("POST", "/api/meetings", `{"course_id":"`+courseID+`","title":"Interactive lesson","starts_at":"2026-10-24T01:00:00Z","recording_allowed":false}`, teacher)
	var lesson map[string]string
	if w.Code != 201 || json.Unmarshal(w.Body.Bytes(), &lesson) != nil {
		t.Fatalf("create interactive lesson: %s", w.Body)
	}
	room := "/api/meetings/" + lesson["id"]
	if w = request("POST", room+"/state", `{"status":"live"}`, teacher); w.Code != 200 {
		t.Fatalf("start interactive: %s", w.Body)
	}
	if w = request("POST", "/api/assignments", `{"rows":[{"course_id":"`+courseCode+`","teacher_id":"","revision":2}]}`, administrator); w.Code != 409 {
		t.Fatal("live assignment changed")
	}
	if w = request("POST", room+"/messages", `{"content":"before join"}`, academicStudent); w.Code != 409 {
		t.Fatal("nonparticipant chat")
	}
	if w = request("POST", room+"/presence", `{"kind":"join"}`, academicStudent); w.Code != 200 {
		t.Fatal("academic student join")
	}
	if w = request("POST", room+"/messages", `{"content":"Xin chào lớp"}`, academicStudent); w.Code != 201 {
		t.Fatalf("chat: %s", w.Body)
	}
	if w = request("POST", room+"/hand", `{"raised":true}`, academicStudent); w.Code != 200 {
		t.Fatal("raise hand")
	}
	w = request("GET", room+"/participants", "", teacher)
	var participants []map[string]any
	if json.Unmarshal(w.Body.Bytes(), &participants) != nil || len(participants) != 1 || participants[0]["id"] != studentID || participants[0]["hand_raised"] != float64(1) {
		t.Fatalf("participants: %s", w.Body)
	}
	if w = request("GET", room+"/messages", "", other); w.Code != 404 {
		t.Fatal("cross-school chat read")
	}
	if w = request("POST", room+"/state", `{"status":"ended"}`, teacher); w.Code != 200 {
		t.Fatal("end interactive")
	}
	if w = request("POST", room+"/messages", `{"content":"after end"}`, academicStudent); w.Code != 409 {
		t.Fatal("ended chat accepted")
	}
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
