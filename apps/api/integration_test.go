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
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &records) != nil || len(records) != 2 || records[0]["id"] != "demo-student" || records[0]["session_count"] != float64(1) || records[0]["meeting_id"] == records[1]["meeting_id"] {
		t.Fatalf("student per-session report: %s", w.Body)
	}
	// The second student enrolled after this lesson: do not invent an old absence.
	w = request("GET", "/api/attendance/report?course_id=demo-math&meeting_id=demo-meeting", "", teacher)
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &records) != nil || len(records) != 1 || records[0]["session_count"] != float64(1) {
		t.Fatalf("teacher meeting report: %s", w.Body)
	}
	administrator := login("demo", "admin")
	// The recording library is scoped by class AND subject and hides unfinished/expired files.
	readyRecording := uid()
	for _, entry := range []struct {
		id, status string
		days       int
	}{{readyRecording, "ready", 30}, {uid(), "pending", 30}, {uid(), "ready", -1}} {
		if _, err := db.Exec("INSERT INTO recordings(id,school_id,meeting_id,owner_id,object_key,bucket,status,size_bytes,expires_at) VALUES(?,'school-demo','demo-meeting','demo-teacher',?,'test-bucket',?,12345,DATE_ADD(UTC_TIMESTAMP(6),INTERVAL ? DAY))", entry.id, "recordings/test/"+entry.id, entry.status, entry.days); err != nil {
			t.Fatal(err)
		}
	}
	library := "/api/recordings?class_id=demo-class&course_id=demo-math"
	for _, allowed := range []*http.Cookie{administrator, teacher, student} {
		w = request("GET", library, "", allowed)
		var files []map[string]any
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &files) != nil || len(files) != 1 || files[0]["id"] != readyRecording {
			t.Fatalf("recording library: %d %s", w.Code, w.Body)
		}
		if strings.Contains(w.Body.String(), "object_key") || strings.Contains(w.Body.String(), "bucket") {
			t.Fatal("private object path exposed")
		}
	}
	for _, test := range []struct {
		path   string
		cookie *http.Cookie
		code   int
	}{{library, other, 404}, {"/api/recordings?class_id=other-class&course_id=demo-math", administrator, 404}, {library + "&meeting_id=other-meeting", teacher, 404}, {"/api/recordings?class_id=demo-class&course_id=demo-alt-course", teacher, 404}, {"/api/recordings?course_id=demo-math", administrator, 400}, {library + "&page=-1", student, 400}} {
		if request("GET", test.path, "", test.cookie).Code != test.code {
			t.Fatalf("recording scope failed: %s", test.path)
		}
	}
	if w = request("GET", library+"&meeting_id=demo-second-lesson", "", student); w.Code != 200 || w.Body.String() != "[]\n" {
		t.Fatalf("lesson filter mixed recordings: %s", w.Body)
	}
	recordingAdminEmail := "recordings-" + uid()[:8] + "@example.test"
	w = request("POST", "/api/accounts", `{"email":"`+recordingAdminEmail+`","name":"Quản trị bản ghi","password":"recordings-password-123","state":"active","permissions":["recordings"]}`, administrator)
	if w.Code != 200 {
		t.Fatalf("recordings admin: %s", w.Body)
	}
	w = request("POST", "/api/login", `{"school":"demo","email":"`+recordingAdminEmail+`","password":"recordings-password-123"}`, nil)
	if w.Code != 200 {
		t.Fatal("recording admin login")
	}
	recordingAdmin := w.Result().Cookies()[0]
	if request("GET", library, "", recordingAdmin).Code != 200 || request("GET", "/api/meetings?course_id=demo-math", "", recordingAdmin).Code != 200 || request("POST", "/api/meetings", "{}", recordingAdmin).Code != 403 || request("GET", "/api/attendance/report?course_id=demo-math", "", recordingAdmin).Code != 403 {
		t.Fatal("recordings-only permission not isolated")
	}
	// Student landing pages load all personal subjects without requiring a class/course selection.
	w = request("GET", "/api/attendance/report?user_id=demo-second", "", student)
	var personal []map[string]any
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &personal) != nil || len(personal) != 2 {
		t.Fatalf("personal attendance landing: %s", w.Body)
	}
	for _, row := range personal {
		if row["id"] != "demo-student" {
			t.Fatal("student selected another person's attendance")
		}
	}
	w = request("GET", "/api/recordings?user_id=other-student", "", student)
	var personalFiles []map[string]any
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &personalFiles) != nil || len(personalFiles) != 1 || personalFiles[0]["id"] != readyRecording {
		t.Fatalf("personal recordings landing: %s", w.Body)
	}
	if request("GET", "/api/recordings", "", teacher).Code != 200 || request("GET", "/api/recordings", "", administrator).Code != 400 {
		t.Fatal("role-specific default recording scope failed")
	}
	if request("GET", "/api/attendance/report?class_id=other-class", "", student).Code != 404 || request("GET", "/api/recordings?course_id=other-course", "", student).Code != 404 {
		t.Fatal("student optional filter escaped enrollment")
	}
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
	// A new login atomically replaces the prior session.
	newer := login("demo", "teacher")
	if request("GET", "/api/me", "", teacher).Code != 401 || request("GET", "/api/me", "", newer).Code != 200 {
		t.Fatal("single session not enforced")
	}
	// Assistants can read assigned classes but cannot start/end as the lead teacher.
	w = request("POST", "/api/assignments", `{"rows":[{"course_id":"`+courseCode+`","teacher_id":"`+teacherShort+`","assistant_ids":["demo-alt-teacher"],"revision":2}]}`, administrator)
	if w.Code != 200 {
		t.Fatalf("assistant assignment: %s", w.Body)
	}
	assistant := login("demo", "alt")
	if request("GET", "/api/attendance/report?course_id="+courseID, "", assistant).Code != 200 {
		t.Fatal("assistant report denied")
	}
	// Lesson-wide timing changes apply to every student without editing their recorded presence.
	timingPath := "/api/attendance/timing?meeting_id=demo-meeting&class_id=demo-class&course_id=demo-math"
	w = request("GET", timingPath, "", administrator)
	var currentTiming struct {
		Start time.Time `json:"starts_at"`
		End   time.Time `json:"ends_at"`
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &currentTiming) != nil {
		t.Fatalf("read lesson window: %s", w.Body)
	}
	common := map[string]any{"meeting_id": "demo-meeting", "class_id": "demo-class", "course_id": "demo-math", "starts_at": currentTiming.Start.Add(-5 * time.Minute), "ends_at": currentTiming.End.Add(5 * time.Minute), "expected_starts_at": currentTiming.Start, "expected_ends_at": currentTiming.End}
	commonJSON, _ := json.Marshal(common)
	if w = request("POST", "/api/attendance/timing", string(commonJSON), administrator); w.Code != 200 {
		t.Fatalf("common timing: %s", w.Body)
	}
	if request("POST", "/api/attendance/timing", string(commonJSON), administrator).Code != 409 {
		t.Fatal("stale common timing overwrote newer values")
	}
	if request("GET", timingPath, "", other).Code != 403 || request("GET", "/api/attendance/timing?meeting_id=other-meeting&class_id=demo-class&course_id=demo-math", "", administrator).Code != 404 {
		t.Fatal("lesson timing scope escaped")
	}
	w = request("GET", "/api/attendance/report?course_id=demo-math&meeting_id=demo-meeting", "", administrator)
	var commonRows []map[string]any
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &commonRows) != nil || len(commonRows) != 2 || commonRows[0]["lesson_start"] != commonRows[1]["lesson_start"] || commonRows[0]["lesson_end"] != commonRows[1]["lesson_end"] {
		t.Fatalf("lesson window differs by student: %s", w.Body)
	}
	var originalSeconds int64
	if db.QueryRow("SELECT seconds FROM presence WHERE school_id='school-demo' AND meeting_id='demo-meeting' AND user_id='demo-student'").Scan(&originalSeconds) != nil || originalSeconds != 125 {
		t.Fatal("common window altered individual connection history")
	}
	if request("POST", "/api/attendance/adjust", `{"meeting_id":"demo-meeting","user_id":"demo-student"}`, administrator).Code != 410 {
		t.Fatal("individual timing edit still enabled")
	}
	w = request("GET", "/api/attendance/report?course_id=demo-math&format=xlsx", "", administrator)
	workbook, err := excelize.OpenReader(bytes.NewReader(w.Body.Bytes()))
	if err != nil || w.Code != 200 {
		t.Fatalf("XLSX export: %d %s", w.Code, w.Body)
	}
	value, err := workbook.GetCellValue("Điểm danh", "A1")
	workbook.Close()
	if err != nil || value != "Lớp" {
		t.Fatal("Vietnamese XLSX header corrupted")
	}
	// Delegated administrators cannot call ungranted APIs or grant themselves more rights.
	adminEmail := "limited-" + uid()[:8] + "@example.test"
	w = request("POST", "/api/accounts", `{"email":"`+adminEmail+`","name":"Quản trị điểm danh","password":"limited-password-123","state":"active","permissions":["attendance"]}`, administrator)
	if w.Code != 200 {
		t.Fatalf("create delegated admin: %s", w.Body)
	}
	w = request("POST", "/api/login", `{"school":"demo","email":"`+adminEmail+`","password":"limited-password-123"}`, nil)
	if w.Code != 200 {
		t.Fatal("limited admin login")
	}
	limited := w.Result().Cookies()[0]
	if request("GET", "/api/accounts", "", limited).Code != 403 || request("GET", "/api/attendance/report?course_id=demo-math", "", limited).Code != 200 {
		t.Fatal("delegated permissions not enforced")
	}
	// TOTP setup needs password and successful confirmation; enabled accounts never bypass the second factor.
	t.Setenv("CONFIG_DIR", t.TempDir())
	w = request("POST", "/api/2fa", `{"action":"setup","password":"limited-password-123","code":""}`, limited)
	var setup map[string]string
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &setup) != nil || setup["secret"] == "" {
		t.Fatalf("TOTP setup: %s", w.Body)
	}
	step := time.Now().Unix() / 30
	otp := otpForTest(setup["secret"], step)
	w = request("POST", "/api/2fa", `{"action":"enable","password":"limited-password-123","code":"`+otp+`"}`, limited)
	if w.Code != 200 {
		t.Fatalf("TOTP enable: %s", w.Body)
	}
	if request("GET", "/api/me", "", limited).Code != 401 {
		t.Fatal("2FA change kept previous session")
	}
	w = request("POST", "/api/login", `{"school":"demo","email":"`+adminEmail+`","password":"limited-password-123"}`, nil)
	if w.Code != 202 || len(w.Result().Cookies()) != 0 {
		t.Fatal("2FA must return challenge without session", w.Body.String())
	}
	var challenge struct {
		Token string `json:"challenge"`
	}
	json.Unmarshal(w.Body.Bytes(), &challenge)
	if challenge.Token == "" {
		t.Fatal("missing challenge")
	}
	if request("POST", "/api/login/2fa", `{"challenge":"`+challenge.Token+`","code":"`+otp+`"}`, nil).Code != 401 {
		t.Fatal("replayed OTP accepted")
	}
	w = request("POST", "/api/login/2fa", `{"challenge":"`+challenge.Token+`","code":"`+otpForTest(setup["secret"], step+1)+`"}`, nil)
	if w.Code != 200 {
		t.Fatal("valid second factor rejected", w.Body.String())
	}
	if request("POST", "/api/login/2fa", `{"challenge":"`+challenge.Token+`","code":"123456"}`, nil).Code != 401 {
		t.Fatal("challenge reused")
	}

	// Database constraint must reject a cross-tenant enrollment even outside the API.
	if _, e = db.ExecContext(context.Background(), "INSERT INTO enrollments VALUES('school-demo','demo-class','other-student')"); e == nil {
		t.Fatal("cross-school FK accepted")
	}
}
