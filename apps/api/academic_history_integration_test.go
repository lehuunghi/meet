package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func testAcademicHistory(t *testing.T, a *app, school, owner string) {
	t.Helper()
	ctx := t.Context()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, e := a.db.ExecContext(ctx, q, args...); e != nil {
			t.Fatal(e)
		}
	}
	student, newStudent, teacher, replacement := uid(), uid(), uid(), uid()
	for id, role := range map[string]string{student: "student", newStudent: "student", teacher: "teacher", replacement: "teacher"} {
		exec("INSERT INTO users(id,school_id,email,name,password_hash,role) VALUES(?,?,?,?,?,?)", id, school, id+"@qa.invalid", id, "not-a-login-hash", role)
	}
	first, second, course, meeting := uid(), uid(), uid(), uid()
	exec("INSERT INTO classes(id,school_id,name) VALUES(?,?,?),(?,?,?)", first, school, "History "+first, second, school, "History "+second)
	exec("INSERT INTO courses(id,school_id,class_id,teacher_id,name) VALUES(?,?,?,?,?)", course, school, first, teacher, "History QA")
	exec("INSERT INTO enrollments(school_id,class_id,user_id) VALUES(?,?,?)", school, first, student)
	exec("INSERT INTO meetings(id,school_id,course_id,title,starts_at,status) VALUES(?,?,?,?,UTC_TIMESTAMP(),'live')", meeting, school, course, "History QA")
	tx, e := a.db.BeginTx(ctx, nil)
	if e != nil {
		t.Fatal(e)
	}
	if e = snapshotLesson(ctx, tx, school, meeting); e != nil {
		tx.Rollback()
		t.Fatal(e)
	}
	if e = tx.Commit(); e != nil {
		t.Fatal(e)
	}
	exec("UPDATE meetings SET status='ended' WHERE id=?", meeting)
	exec("INSERT INTO enrollments(school_id,class_id,user_id) VALUES(?,?,?)", school, first, newStudent)
	call := func(role, user, method, url, body string, handler http.HandlerFunc) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, url, strings.NewReader(body))
		r = r.WithContext(context.WithValue(r.Context(), authKey{}, identity{School: school, ID: user, Role: role}))
		w := httptest.NewRecorder()
		handler(w, r)
		return w
	}
	rows := func(role, user string) []map[string]any {
		t.Helper()
		w := call(role, user, "GET", "/api/attendance/report?course_id="+course, "", a.attendanceReport)
		if w.Code != 200 {
			t.Fatalf("report %d %s", w.Code, w.Body)
		}
		var out []map[string]any
		if e := json.Unmarshal(w.Body.Bytes(), &out); e != nil {
			t.Fatal(e)
		}
		return out
	}
	if out := rows("admin", owner); len(out) != 1 || out[0]["id"] != student {
		t.Fatalf("new student marked absent for old lesson: %v", out)
	}
	body, _ := json.Marshal(map[string]string{"Action": "transfer", "User": student, "From": first, "To": second, "Reason": "QA history"})
	w := call("admin", owner, "POST", "/api/academic/operations", string(body), a.academicOperations)
	if w.Code != 200 {
		t.Fatalf("transfer %d %s", w.Code, w.Body)
	}
	if out := rows("student", student); len(out) != 1 || out[0]["id"] != student {
		t.Fatal("transfer erased own attendance history")
	}
	if out := rows("student", newStudent); len(out) != 0 {
		t.Fatal("new student inherited old absence")
	}
	exec("UPDATE courses SET teacher_id=? WHERE id=?", replacement, course)
	if out := rows("teacher", teacher); len(out) != 1 {
		t.Fatal("former teacher lost own lesson history")
	}
	next := uid()
	exec("INSERT INTO meetings(id,school_id,course_id,title,starts_at) VALUES(?,?,?,?,UTC_TIMESTAMP())", next, school, course, "Next lesson")
	r := httptest.NewRequest("POST", "/api/meetings/"+next+"/state", strings.NewReader(`{"status":"live"}`))
	r.SetPathValue("id", next)
	r = r.WithContext(context.WithValue(r.Context(), authKey{}, identity{School: school, ID: owner, Role: "admin"}))
	w = httptest.NewRecorder()
	a.meetingState(w, r)
	if w.Code != 200 {
		t.Fatalf("start %d %s", w.Code, w.Body)
	}
	var count int
	if e = a.db.QueryRow("SELECT COUNT(*) FROM lesson_roster WHERE meeting_id=? AND user_id=?", next, newStudent).Scan(&count); e != nil || count != 1 {
		t.Fatal("new lesson roster did not capture new student")
	}
	if e = a.db.QueryRow("SELECT COUNT(*) FROM lesson_roster WHERE meeting_id=? AND user_id=?", next, student).Scan(&count); e != nil || count != 0 {
		t.Fatal("transferred student remains in future roster")
	}
	rec := uid()
	exec("INSERT INTO recordings(id,school_id,meeting_id,owner_id,object_key,status,bucket,expires_at) VALUES(?,?,?,?,?,'ready','old-recording-bucket',UTC_TIMESTAMP()+INTERVAL 1 DAY)", rec, school, meeting, teacher, "recordings/history-qa.webm")
	r = httptest.NewRequest("GET", "/api/meetings/"+meeting+"/recordings/"+rec+"/download", nil)
	r.SetPathValue("id", meeting)
	r.SetPathValue("recording", rec)
	r = r.WithContext(context.WithValue(r.Context(), authKey{}, identity{School: school, ID: teacher, Role: "teacher"}))
	w = httptest.NewRecorder()
	a.recordingDownload(w, r)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "old-recording-bucket") {
		t.Fatalf("historical bucket not used: %d %s", w.Code, w.Body)
	}
	start := time.Now().Add(24 * time.Hour).UTC()
	payload := map[string]string{"Action": "schedule", "Course": course, "Name": "Tomorrow", "Starts": start.Format(time.RFC3339), "Ends": start.Add(time.Hour).Format(time.RFC3339)}
	raw, _ := json.Marshal(payload)
	if w = call("admin", owner, "POST", "/api/academic/operations", string(raw), a.academicOperations); w.Code != 200 {
		t.Fatalf("schedule %d %s", w.Code, w.Body)
	}
	if w = call("admin", owner, "POST", "/api/academic/operations", string(raw), a.academicOperations); w.Code != 409 {
		t.Fatalf("conflicting schedule accepted: %d", w.Code)
	}
	termBody := `{"Action":"term","Name":"QA revision ` + uid() + `","Starts":"2026-09-01","Ends":"2027-06-30"}`
	w = call("admin", owner, "POST", "/api/academic/operations", termBody, a.academicOperations)
	if w.Code != 200 {
		t.Fatalf("term create %d %s", w.Code, w.Body)
	}
	var created map[string]any
	if e = json.Unmarshal(w.Body.Bytes(), &created); e != nil {
		t.Fatal(e)
	}
	change := map[string]any{"Action": "term", "ID": created["id"], "Name": "QA changed " + uid(), "Starts": "2026-09-01", "Ends": "2027-06-30", "Revision": 0}
	raw, _ = json.Marshal(change)
	if w = call("admin", owner, "POST", "/api/academic/operations", string(raw), a.academicOperations); w.Code != 409 {
		t.Fatal("stale term revision accepted")
	}
	change["Revision"] = 1
	raw, _ = json.Marshal(change)
	if w = call("admin", owner, "POST", "/api/academic/operations", string(raw), a.academicOperations); w.Code != 200 {
		t.Fatalf("term edit %d %s", w.Code, w.Body)
	}
	// Don't leave synthetic live rooms behind for subsequent integration checks.
	exec("UPDATE meetings SET status='ended' WHERE id=?", next)
	term := uid()
	exec("INSERT INTO academic_terms(id,school_id,name,starts_on,ends_on,closed) VALUES(?,?,?,CURDATE(),CURDATE()+INTERVAL 1 YEAR,TRUE)", term, school, "QA "+term)
	exec("INSERT INTO class_terms(school_id,class_id,term_id) VALUES(?,?,?)", school, first, term)
	draft := uid()
	exec("INSERT INTO meetings(id,school_id,course_id,title,starts_at) VALUES(?,?,?,?,UTC_TIMESTAMP())", draft, school, course, "Closed term")
	r = httptest.NewRequest("POST", "/api/meetings/"+draft+"/state", strings.NewReader(`{"status":"live"}`))
	r.SetPathValue("id", draft)
	r = r.WithContext(context.WithValue(r.Context(), authKey{}, identity{School: school, ID: owner, Role: "admin"}))
	w = httptest.NewRecorder()
	a.meetingState(w, r)
	if w.Code != 409 {
		t.Fatalf("closed term allowed teaching: %d %s", w.Code, w.Body)
	}
	if w = call("teacher", teacher, "POST", "/api/academic/operations", `{"Action":"term","Name":"Forbidden"}`, a.academicOperations); w.Code != 403 {
		t.Fatal("teacher gained school administration")
	}

}
