package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func testBreakouts(t *testing.T, a *app, request func(string, string, string, *http.Cookie) *httptest.ResponseRecorder, teacher, student, other *http.Cookie) {
	t.Helper()
	const parent = "breakout-test-parent"
	base := "/api/meetings/" + parent
	exec := func(q string, args ...any) {
		t.Helper()
		if _, e := a.db.Exec(q, args...); e != nil {
			t.Fatal(e)
		}
	}
	must := func(w *httptest.ResponseRecorder, code int) *httptest.ResponseRecorder {
		t.Helper()
		if w.Code != code {
			t.Fatalf("breakout expected %d got %d: %s", code, w.Code, w.Body.String())
		}
		return w
	}
	exec(`INSERT INTO meetings(id,school_id,course_id,title,starts_at) SELECT ?,school_id,course_id,'Breakout test',UTC_TIMESTAMP() FROM meetings WHERE id='demo-meeting'`, parent)
	defer func() {
		rows, e := a.db.Query(`SELECT br.meeting_id FROM meeting_breakout_rooms br JOIN meeting_breakout_rounds b ON b.school_id=br.school_id AND b.id=br.round_id WHERE b.parent_id=?`, parent)
		if e != nil {
			t.Error(e)
			return
		}
		ids := []string{parent}
		for rows.Next() {
			var id string
			rows.Scan(&id)
			ids = append(ids, id)
		}
		rows.Close()
		for _, id := range ids {
			for _, table := range []string{"publications", "media_sessions", "meeting_messages", "meeting_hands", "meeting_reactions", "meeting_drawing_state", "attendance_events", "presence", "meeting_teaching_windows", "meeting_links", "meeting_sfu_bindings", "room_settings", "room_members"} {
				if _, e = a.db.Exec("DELETE FROM "+table+" WHERE meeting_id=?", id); e != nil {
					t.Error(table, e)
				}
			}
		}
		exec(`DELETE bm FROM meeting_breakout_members bm JOIN meeting_breakout_rounds b ON b.id=bm.round_id WHERE b.parent_id=?`, parent)
		exec(`DELETE br FROM meeting_breakout_rooms br JOIN meeting_breakout_rounds b ON b.id=br.round_id WHERE b.parent_id=?`, parent)
		exec(`DELETE FROM meeting_breakout_rounds WHERE parent_id=?`, parent)
		for _, id := range ids {
			exec(`DELETE FROM meetings WHERE id=?`, id)
		}
	}()
	must(request("POST", base+"/state", `{"status":"live"}`, teacher), 200)
	must(request("POST", base+"/presence", `{"kind":"join"}`, teacher), 200)
	must(request("POST", base+"/presence", `{"kind":"ready"}`, teacher), 200)
	must(request("POST", base+"/presence", `{"kind":"join"}`, student), 200)
	must(request("POST", base+"/breakouts", `{"action":"create","count":2}`, student), 403)
	must(request("GET", base+"/breakouts", "", other), 404)
	must(request("POST", base+"/breakouts", `{"action":"create","count":21}`, teacher), 400)
	type snapshot struct {
		Round    string `json:"round_id"`
		Status   string `json:"status"`
		Revision int    `json:"revision"`
		Current  string `json:"current_room_id"`
		Rooms    []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"rooms"`
	}
	var s snapshot
	read := func(w *httptest.ResponseRecorder) {
		t.Helper()
		if e := json.Unmarshal(w.Body.Bytes(), &s); e != nil {
			t.Fatal(e)
		}
	}
	read(must(request("POST", base+"/breakouts", `{"action":"create","count":2}`, teacher), 200))
	if len(s.Rooms) != 2 {
		t.Fatal("missing rooms", s)
	}
	r1, r2 := s.Rooms[0].ID, s.Rooms[1].ID
	post := func(action string, extra map[string]any) *httptest.ResponseRecorder {
		body := map[string]any{"action": action, "revision": s.Revision}
		for k, v := range extra {
			body[k] = v
		}
		raw, _ := json.Marshal(body)
		w := request("POST", base+"/breakouts", string(raw), teacher)
		if w.Code == 200 {
			read(w)
		}
		return w
	}
	must(post("assign", map[string]any{"room_id": r1, "users": []string{"demo-student"}}), 200)
	must(request("POST", base+"/breakouts", `{"action":"rename","revision":0,"room_id":"`+r1+`","name":"Stale"}`, teacher), 409)
	must(post("rename", map[string]any{"room_id": r1, "name": "Nhóm phân tích"}), 200)
	must(request("GET", "/api/meetings/"+r1, "", student), 404)
	exec(`INSERT INTO room_settings(school_id,meeting_id,present_enabled) VALUES('school-demo',?,FALSE)`, parent)
	must(post("start", nil), 200)
	var present bool
	if e := a.db.QueryRow(`SELECT present_enabled FROM room_settings WHERE meeting_id=?`, r1).Scan(&present); e != nil || present {
		t.Fatal("group did not inherit presentation restriction", e)
	}
	must(post("assign", map[string]any{"room_id": r2, "users": []string{"demo-student"}}), 409)
	// A failed upstream close must not move membership or open the new room.
	exec(`INSERT INTO media_sessions(id,school_id,meeting_id,user_id) VALUES('break-root','school-demo',?,'demo-student')`, parent)
	exec(`INSERT INTO publications(school_id,meeting_id,session_id,track_name,user_id) VALUES('school-demo',?,'break-root','audio-old','demo-student')`, parent)
	original := a.client
	failClose := true
	closes := 0
	a.client = &http.Client{Timeout: time.Second, Transport: testTransport(func(r *http.Request) (*http.Response, error) {
		code := 200
		body := `{"tracks":[{"mid":"0","status":"active"}]}`
		if strings.HasSuffix(r.URL.Path, "/tracks/close") {
			closes++
			body = `{"tracks":[{"mid":"0"}]}`
			if failClose {
				code = 503
			}
		}
		return &http.Response{StatusCode: code, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}, nil
	})}
	defer func() { a.client = original }()
	move := func(room string, cookie *http.Cookie) *httptest.ResponseRecorder {
		return request("POST", base+"/breakouts", fmt.Sprintf(`{"action":"join","room_id":%q}`, room), cookie)
	}
	must(move(r1, student), 503)
	var current string
	a.db.QueryRow(`SELECT COALESCE(current_room_id,'') FROM meeting_breakout_members WHERE user_id='demo-student' AND round_id=?`, s.Round).Scan(&current)
	if current != "" {
		t.Fatal("moved despite failed teardown")
	}
	failClose = false
	must(move(r1, student), 200)
	if closes < 2 {
		t.Fatal("old transport never closed")
	}
	must(request("POST", "/api/meetings/"+r1+"/presence", `{"kind":"join"}`, student), 200)
	must(request("POST", "/api/meetings/"+r1+"/messages", `{"content":"Nội dung riêng nhóm 1"}`, student), 201)
	must(request("GET", "/api/meetings/"+r2+"/messages", "", student), 404)
	must(request("GET", base+"/messages", "", student), 409)
	must(request("POST", base+"/sfu", `{"op":"new"}`, student), 409)
	must(move(r2, student), 403)
	must(move(r2, teacher), 200)
	must(request("POST", "/api/meetings/"+r2+"/presence", `{"kind":"join"}`, teacher), 200)
	exec(`INSERT INTO media_sessions(id,school_id,meeting_id,user_id) VALUES('break-a','school-demo',?,'demo-student'),('break-b','school-demo',?,'demo-teacher')`, r1, r2)
	exec(`INSERT INTO publications(school_id,meeting_id,session_id,track_name,user_id) VALUES('school-demo',?,'break-b','audio-private','demo-teacher')`, r2)
	must(request("POST", "/api/meetings/"+r1+"/sfu", `{"op":"tracks","session_id":"break-a","tracks":[{"location":"remote","sessionId":"break-b","trackName":"audio-private"}]}`, student), 403)
	must(request("POST", "/api/meetings/"+r1+"/recording-control", `{"enabled":true}`, teacher), 409)
	var meetings []map[string]any
	w := must(request("GET", "/api/meetings", "", student), 200)
	json.Unmarshal(w.Body.Bytes(), &meetings)
	for _, m := range meetings {
		if m["id"] == r1 || m["id"] == r2 {
			t.Fatal("child counted as public lesson")
		}
	}
	// Root attendance continues while media is in a child room.
	exec(`UPDATE meeting_teaching_windows SET started_at=UTC_TIMESTAMP()-INTERVAL 60 SECOND WHERE meeting_id=?`, parent)
	exec(`UPDATE presence SET last_seen=UTC_TIMESTAMP()-INTERVAL 10 SECOND WHERE meeting_id=? AND user_id='demo-student'`, parent)
	must(request("POST", base+"/presence", `{"kind":"heartbeat"}`, student), 200)
	var seconds int64
	a.db.QueryRow(`SELECT seconds FROM presence WHERE meeting_id=? AND user_id='demo-student'`, parent).Scan(&seconds)
	if seconds < 9 {
		t.Fatal("group time lost from parent attendance", seconds)
	}
	must(post("close", nil), 200)
	must(request("GET", "/api/meetings/"+r1, "", student), 404)
	must(move("", student), 200)
	// Returning from the closed child doesn't end the lesson.
	var state string
	a.db.QueryRow(`SELECT status FROM meetings WHERE id=?`, parent).Scan(&state)
	if state != "live" {
		t.Fatal("closing groups ended parent")
	}
	must(request("POST", base+"/state", `{"status":"ended"}`, teacher), 200)
	var live int
	a.db.QueryRow(`SELECT COUNT(*) FROM meetings m JOIN meeting_breakout_rooms br ON br.meeting_id=m.id JOIN meeting_breakout_rounds b ON b.id=br.round_id WHERE b.parent_id=? AND m.status='live'`, parent).Scan(&live)
	if live != 0 {
		t.Fatal("orphan live child rooms")
	}
}
