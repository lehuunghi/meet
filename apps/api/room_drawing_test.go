package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDrawingOwnershipEpochAndValidation(t *testing.T) {
	s := newDrawingState()
	target := []drawTarget{{Key: "screen-key", User: "student", Name: "Student"}}
	run := func(in drawingInput, actor string, host bool, want int) {
		t.Helper()
		code, _ := applyDrawing(&s, in, actor, host, target, s.Control)
		if code != want {
			t.Fatalf("%s want %d got %d", in.Action, want, code)
		}
	}
	run(drawingInput{Action: "open_board"}, "student", false, 403)
	run(drawingInput{Action: "open_board"}, "host", true, 200)
	stroke := drawStroke{ID: "student-stroke", Kind: "pen", Color: "#0B4ED8", Width: 4, Seq: 1, Points: []drawPoint{{10, 10}, {100, 80}}}
	in := drawingInput{Action: "stroke", Context: "board:p1", Stroke: stroke}
	run(in, "student", false, 403)
	run(drawingInput{Action: "allow", Allow: true}, "host", true, 200)
	run(in, "student", false, 200)
	in.Stroke.Seq = 2
	in.Stroke.Points = append(in.Stroke.Points, drawPoint{120, 90})
	run(in, "student", false, 200)
	run(in, "other", false, 403)
	if len(s.Pages[0].Strokes) != 1 || s.Pages[0].Strokes[0].Owner != "student" {
		t.Fatal("ownership or idempotency failed")
	}
	run(drawingInput{Action: "erase", Context: "board:p1", ID: stroke.ID}, "student", false, 200)
	run(in, "student", false, 409)
	run(drawingInput{Action: "clear", Context: "board:p1"}, "host", true, 200)
	in.Stroke.ID = "student-new"
	run(in, "student", false, 409)
	run(drawingInput{Action: "open_screen", Target: "screen-key"}, "student", false, 403)
	run(drawingInput{Action: "show_presentation", Target: "screen-key"}, "student", false, 403)
	run(drawingInput{Action: "close"}, "host", true, 200)
	run(drawingInput{Action: "open_screen", Target: "screen-key"}, "student", false, 200)
	run(drawingInput{Action: "allow", Allow: false}, "student", false, 403)
	run(drawingInput{Action: "allow", Allow: false}, "host", true, 200)
	run(drawingInput{Action: "open_board"}, "host", true, 200)
	in.Epoch = 1
	run(in, "student", false, 403)
	stroke.Kind = "<script>"
	if validDrawStroke(stroke) {
		t.Fatal("invalid tool accepted")
	}
	stroke.Kind = "pen"
	stroke.Points[0].X = 1601
	if validDrawStroke(stroke) {
		t.Fatal("out-of-bounds accepted")
	}
}

func TestDrawingSharedSurfaceSwitch(t *testing.T) {
	s := newDrawingState()
	targets := []drawTarget{{Key: "share", User: "student"}}
	run := func(in drawingInput, actor string, host bool, want int) {
		t.Helper()
		code, _ := applyDrawing(&s, in, actor, host, targets, s.Control)
		if code != want {
			t.Fatalf("%s: got %d want %d", in.Action, code, want)
		}
	}
	run(drawingInput{Action: "open_board"}, "teacher", true, 200)
	stroke := drawStroke{ID: "teacher-board", Kind: "pen", Color: "#0B4ED8", Width: 4, Seq: 1, Points: []drawPoint{{10, 10}, {50, 50}}}
	run(drawingInput{Action: "stroke", Context: "board:p1", Stroke: stroke}, "teacher", true, 200)
	run(drawingInput{Action: "show_presentation", Target: "share"}, "student", false, 403)
	run(drawingInput{Action: "show_presentation", Target: "missing"}, "teacher", true, 409)
	if !s.Active || s.Mode != "board" {
		t.Fatal("invalid switch changed board")
	}
	run(drawingInput{Action: "show_presentation", Target: "share"}, "teacher", true, 200)
	if s.Active || s.Mode != "screen" || len(s.Pages[0].Strokes) != 1 {
		t.Fatal("presentation should hide board and retain its contents")
	}
	run(drawingInput{Action: "open_screen", Target: "share"}, "student", false, 200)
	stroke.ID = "student-ink"
	run(drawingInput{Action: "stroke", Context: "screen:share", Stroke: stroke}, "student", false, 200)
	run(drawingInput{Action: "open_board"}, "teacher", true, 200)
	if !s.Active || s.Mode != "board" || len(s.Pages[0].Strokes) != 1 || len(s.Screens["share"].Strokes) != 1 {
		t.Fatal("switch lost board or screen ink")
	}
	run(drawingInput{Action: "close"}, "teacher", true, 200)
	if s.Active || s.Mode != "screen" {
		t.Fatal("closing board should return to the valid presentation")
	}
}
func testRoomDrawing(t *testing.T, a *app, request func(string, string, string, *http.Cookie) *httptest.ResponseRecorder, teacher, student, other *http.Cookie) {
	t.Helper()
	ctx := context.Background()
	if w := request("POST", "/api/meetings/demo-meeting/presence", `{"kind":"join"}`, teacher); w.Code != 200 {
		t.Fatalf("drawing host join: %d %s", w.Code, w.Body.String())
	}
	_, e := a.db.Exec("UPDATE presence SET online=TRUE,last_seen=UTC_TIMESTAMP(6) WHERE school_id='school-demo' AND meeting_id='demo-meeting'")
	if e != nil {
		t.Fatal(e)
	}
	url := "/api/meetings/demo-meeting/drawing"
	must := func(w *httptest.ResponseRecorder, code int) {
		t.Helper()
		if w.Code != code {
			t.Fatalf("drawing want %d got %d: %s", code, w.Code, w.Body.String())
		}
	}
	must(request("GET", url, "", nil), 401)
	must(request("GET", url, "", other), 404)
	must(request("GET", url, "", student), 200)
	must(request("POST", url, `{"action":"open_board","revision":0}`, student), 403)
	must(request("POST", url, `{"action":"open_board","revision":0}`, teacher), 200)
	payload := `{"action":"stroke","context":"board:p1","epoch":0,"stroke":{"id":"demo-student-line","kind":"pen","color":"#34A853","width":4,"seq":1,"points":[{"x":10,"y":10},{"x":80,"y":90}]}}`
	must(request("POST", url, payload, student), 403)
	must(request("POST", url, `{"action":"allow","allow_students":true,"revision":1}`, teacher), 200)
	must(request("POST", url, payload, student), 200)
	must(request("POST", url, payload, student), 200)
	w := request("GET", url, "", teacher)
	must(w, 200)
	var out struct {
		State    drawingState `json:"state"`
		Revision int64        `json:"revision"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if len(out.State.Pages[0].Strokes) != 1 {
		t.Fatal("duplicate stroke or missing sync")
	}
	must(request("GET", fmt.Sprintf("%s?since=%d", url, out.Revision), "", student), 200)
	must(request("POST", url, `{"action":"clear","context":"board:p1","epoch":0,"revision":2}`, teacher), 200)
	must(request("POST", url, payload, student), 409)
	if _, e = a.db.Exec("INSERT INTO media_sessions(id,school_id,meeting_id,user_id) VALUES('drawing-test-session','school-demo','demo-meeting','demo-student')"); e != nil {
		t.Fatal(e)
	}
	if _, e = a.db.Exec("INSERT INTO publications(school_id,meeting_id,session_id,track_name,user_id) VALUES('school-demo','demo-meeting','drawing-test-session','screen-video-drawing-test','demo-student')"); e != nil {
		t.Fatal(e)
	}
	target := digest("drawing-test-session:screen-video-drawing-test")
	switchRequest := fmt.Sprintf(`{"action":"show_presentation","target":%q,"revision":3}`, target)
	must(request("POST", url, switchRequest, student), 403)
	must(request("POST", url, `{"action":"show_presentation","target":"invalid","revision":3}`, teacher), 409)
	must(request("POST", url, switchRequest, teacher), 200)
	must(request("POST", url, `{"action":"open_board","revision":4}`, teacher), 200)
	w = request("GET", url, "", student)
	must(w, 200)
	if json.Unmarshal(w.Body.Bytes(), &out) != nil || !out.State.Active || out.State.Mode != "board" || out.State.Pages[0].Epoch != 1 {
		t.Fatal("shared surface transition lost state", w.Body.String())
	}
	if _, e = a.db.Exec("DELETE FROM publications WHERE session_id='drawing-test-session'"); e != nil {
		t.Fatal(e)
	}
	if _, e = a.db.Exec("DELETE FROM media_sessions WHERE id='drawing-test-session'"); e != nil {
		t.Fatal(e)
	}
	_, e = a.db.Exec("INSERT INTO room_members(school_id,meeting_id,user_id,state) VALUES('school-demo','demo-meeting','demo-student','removed') ON DUPLICATE KEY UPDATE state='removed'")
	if e != nil {
		t.Fatal(e)
	}
	must(request("GET", url, "", student), 403)
	must(request("POST", url, payload, student), 403)
	_, _ = a.db.Exec("DELETE FROM room_members WHERE school_id='school-demo' AND meeting_id='demo-meeting' AND user_id='demo-student'")
	// State remains in SQL for reconnects, not only in one browser.
	var raw string
	if a.db.QueryRowContext(ctx, "SELECT content FROM meeting_drawing_state WHERE school_id='school-demo' AND meeting_id='demo-meeting'").Scan(&raw) != nil || !strings.Contains(raw, "p1") {
		t.Fatal("drawing state not persisted")
	}
}

// Demo drawing bypasses the server; exercise all advertised colors and tools here.
func TestDrawingPaletteContract(t *testing.T) {
	for _, color := range []string{"#0B4ED8", "#00C2E8", "#FFAA1D", "#FF4D4F", "#162B49", "#FFFFFF", "#006F86", "#34A853"} {
		for _, kind := range []string{"pen", "marker", "laser", "line", "arrow", "rect", "ellipse", "text", "note", "stamp"} {
			s := newDrawingState()
			s.Active = true
			in := drawingInput{Action: "stroke", Context: "board:p1", Stroke: drawStroke{ID: "teacher-test", Kind: kind, Color: color, Width: 4, Seq: 1, Text: "Test", Points: []drawPoint{{10, 10}, {100, 80}}}}
			code, message := applyDrawing(&s, in, "teacher", true, nil, 0)
			if code != 200 {
				t.Fatalf("%s %s rejected: %d %s", color, kind, code, message)
			}
		}
	}
	for _, color := range []string{"", "#34A853<script>", "red", "#00000000"} {
		if validDrawStroke(drawStroke{ID: "teacher-test", Kind: "pen", Color: color, Width: 4, Seq: 1, Points: []drawPoint{{10, 10}}}) {
			t.Fatalf("invalid color accepted: %s", color)
		}
	}
}
