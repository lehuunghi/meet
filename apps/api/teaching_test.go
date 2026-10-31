package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestTeachingCredit(t *testing.T) {
	now := time.Now().UTC()
	last := now.Add(-30 * time.Second)
	for _, v := range []struct {
		name       string
		tracked    bool
		start, end sql.NullTime
		online     bool
		last       time.Time
		want       int64
	}{
		{"waiting", true, sql.NullTime{}, sql.NullTime{}, true, last, 0},
		{"clipped start", true, sql.NullTime{Time: now.Add(-10 * time.Second), Valid: true}, sql.NullTime{}, true, last, 10},
		{"clipped end", true, sql.NullTime{Time: last.Add(-time.Hour), Valid: true}, sql.NullTime{Time: now.Add(-5 * time.Second), Valid: true}, true, last, 25},
		{"stale", true, sql.NullTime{Time: now.Add(-10 * time.Second), Valid: true}, sql.NullTime{}, true, now.Add(-time.Minute), 0},
		{"offline", false, sql.NullTime{}, sql.NullTime{}, false, last, 0},
		{"legacy", false, sql.NullTime{}, sql.NullTime{}, true, last, 30},
	} {
		t.Run(v.name, func(t *testing.T) {
			if got := teachingCredit(v.last, now, v.online, v.tracked, v.start, v.end); got != v.want {
				t.Fatalf("got %d want %d", got, v.want)
			}
		})
	}
}

func testTeachingWindow(t *testing.T, a *app, request func(string, string, string, *http.Cookie) *httptest.ResponseRecorder, teacher, student, adminCookie *http.Cookie) {
	t.Helper()
	must := func(w *httptest.ResponseRecorder, code int) {
		t.Helper()
		if w.Code != code {
			t.Fatalf("teaching want %d got %d %s", code, w.Code, w.Body.String())
		}
	}
	exec := func(q string, args ...any) {
		t.Helper()
		if _, e := a.db.Exec(q, args...); e != nil {
			t.Fatal(e)
		}
	}
	const id = "teaching-window-test"
	exec(`INSERT INTO meetings(id,school_id,course_id,title,starts_at,status,recording_allowed) SELECT ? ,school_id,course_id,'Teaching window test',UTC_TIMESTAMP()-INTERVAL 2 HOUR,'scheduled',TRUE FROM meetings WHERE id='demo-meeting'`, id)
	base := "/api/meetings/" + id
	must(request("POST", base+"/recording-control", `{"enabled":false}`, student), 403)
	must(request("POST", base+"/recording-control", `{}`, teacher), 400)
	must(request("POST", base+"/recording-control", `{"enabled":false}`, teacher), 200)
	var recording bool
	if e := a.db.QueryRow("SELECT recording_allowed FROM meetings WHERE id=?", id).Scan(&recording); e != nil || recording {
		t.Fatal("recording preference not saved", e)
	}
	// Use the actual tenant, not the participant or meeting ID, for recorder ownership.
	var school string
	if e := a.db.QueryRow("SELECT school_id FROM meetings WHERE id=?", id).Scan(&school); e != nil {
		t.Fatal(e)
	}
	lease := "server-recording-lease:" + school + ":" + id
	if e := a.cache.Set(t.Context(), lease, "test-worker", time.Minute).Err(); e != nil {
		t.Fatal(e)
	}
	must(request("POST", base+"/recording-control", `{"enabled":true}`, teacher), 409)
	a.cache.Del(t.Context(), lease)
	must(request("POST", base+"/recording-control", `{"enabled":true}`, teacher), 200)
	must(request("POST", base+"/state", `{"status":"live"}`, teacher), 200)
	var start, end sql.NullTime
	var seconds int64
	read := func() {
		t.Helper()
		if e := a.db.QueryRow("SELECT started_at,ended_at FROM meeting_teaching_windows WHERE meeting_id=?", id).Scan(&start, &end); e != nil {
			t.Fatal(e)
		}
	}
	must(request("POST", base+"/presence", `{"kind":"ready"}`, teacher), 403)
	read()
	if start.Valid {
		t.Fatal("preparing started recording")
	}
	must(request("POST", base+"/recordings/multipart", `{}`, teacher), 409)
	must(request("POST", base+"/presence", `{"kind":"ready"}`, student), 403)
	must(request("POST", base+"/presence", `{"kind":"join"}`, student), 200)
	exec("UPDATE presence SET last_seen=UTC_TIMESTAMP()-INTERVAL 20 SECOND WHERE meeting_id=?", id)
	must(request("POST", base+"/presence", `{"kind":"heartbeat"}`, student), 200)
	if e := a.db.QueryRow("SELECT seconds FROM presence WHERE meeting_id=? AND user_id='demo-student'", id).Scan(&seconds); e != nil || seconds != 0 {
		t.Fatal("preparation credited", seconds, e)
	}
	must(request("POST", base+"/presence", `{"kind":"join"}`, adminCookie), 200)
	read()
	if start.Valid {
		t.Fatal("admin observer started teaching")
	}
	exec("UPDATE presence SET last_seen=UTC_TIMESTAMP()-INTERVAL 30 SECOND WHERE meeting_id=? AND user_id='demo-student'", id)
	must(request("POST", base+"/presence", `{"kind":"join"}`, teacher), 200)
	must(request("POST", base+"/presence", `{"kind":"ready"}`, teacher), 200)
	read()
	if !start.Valid || end.Valid {
		t.Fatal("teacher join did not start teaching")
	}
	first := start.Time
	var observed time.Time
	if e := a.db.QueryRow("SELECT last_seen FROM presence WHERE meeting_id=? AND user_id='demo-student'", id).Scan(&observed); e != nil || !observed.Before(first.Add(-20*time.Second)) {
		t.Fatal("starting teaching refreshed a student heartbeat", observed, e)
	}
	must(request("POST", base+"/presence", `{"kind":"leave"}`, teacher), 200)
	read()
	if end.Valid {
		t.Fatal("leaving ended lesson")
	}
	must(request("POST", base+"/presence", `{"kind":"join"}`, teacher), 200)
	must(request("POST", base+"/presence", `{"kind":"ready"}`, teacher), 200)
	read()
	if !start.Time.Equal(first) {
		t.Fatal("reconnect reset start")
	}
	exec("UPDATE meeting_teaching_windows SET started_at=UTC_TIMESTAMP()-INTERVAL 60 SECOND WHERE meeting_id=?", id)
	exec("UPDATE presence SET last_seen=UTC_TIMESTAMP()-INTERVAL 20 SECOND WHERE meeting_id=? AND user_id='demo-student'", id)
	must(request("POST", base+"/presence", `{"kind":"heartbeat"}`, student), 200)
	a.db.QueryRow("SELECT seconds FROM presence WHERE meeting_id=? AND user_id='demo-student'", id).Scan(&seconds)
	if seconds < 19 || seconds > 21 {
		t.Fatal("teaching interval not credited", seconds)
	}
	must(request("POST", base+"/state", `{"status":"ended"}`, teacher), 200)
	must(request("POST", base+"/recording-control", `{"enabled":true}`, teacher), 409)
	read()
	if !end.Valid || !end.Time.After(start.Time) {
		t.Fatal("end not persisted")
	}
	must(request("POST", base+"/presence", `{"kind":"heartbeat"}`, student), 409)
	var course, class string
	if e := a.db.QueryRow("SELECT c.id,c.class_id FROM courses c JOIN meetings m ON m.course_id=c.id AND m.school_id=c.school_id WHERE m.id=?", id).Scan(&course, &class); e != nil {
		t.Fatal(e)
	}
	w := request("GET", "/api/attendance/report?course_id="+course+"&class_id="+class+"&meeting_id="+id, "", student)
	must(w, 200)
	var rows []map[string]any
	if json.Unmarshal(w.Body.Bytes(), &rows) != nil || len(rows) != 1 || rows[0]["teaching_started_at"] == nil || rows[0]["teaching_ended_at"] == nil {
		t.Fatal("report omitted teaching window", w.Body.String())
	}
	exec("DELETE FROM attendance_events WHERE meeting_id=?", id)
	exec("DELETE FROM presence WHERE meeting_id=?", id)
	exec("DELETE FROM meeting_teaching_windows WHERE meeting_id=?", id)
	exec("DELETE FROM meetings WHERE id=?", id)
}
