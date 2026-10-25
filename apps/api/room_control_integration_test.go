package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testRoomModeration(t *testing.T, a *app, request func(string, string, string, *http.Cookie) *httptest.ResponseRecorder, teacher, student, other *http.Cookie) {
	t.Helper()
	base := "/api/meetings/demo-meeting"
	must := func(w *httptest.ResponseRecorder, code int) {
		t.Helper()
		if w.Code != code {
			t.Fatalf("moderation want %d got %d %s", code, w.Code, w.Body.String())
		}
	}
	must(request("POST", base+"/controls", `{"lobby":true,"chat_enabled":false,"present_enabled":false,"revision":0}`, student), 403)
	must(request("POST", base+"/controls", `{"lobby":true,"chat_enabled":false,"present_enabled":false,"revision":0}`, teacher), 200)
	// Students already in the live room stay admitted when lobby is enabled.
	w := request("GET", base, "", student)
	must(w, 200)
	if !strings.Contains(w.Body.String(), `"admission":"admitted"`) {
		t.Fatal(w.Body.String())
	}
	id := uid()
	email := "waiting-" + id + "@example.test"
	if _, e := a.db.Exec(`INSERT INTO users(id,school_id,email,name,password_hash,role) SELECT ?,'school-demo',?,'Waiting student',password_hash,'student' FROM users WHERE id='demo-student'`, id, email); e != nil {
		t.Fatal(e)
	}
	if _, e := a.db.Exec("INSERT INTO enrollments(school_id,class_id,user_id) VALUES('school-demo','demo-class',?)", id); e != nil {
		t.Fatal(e)
	}
	w = request("POST", "/api/login", `{"school":"demo","email":"`+email+`","password":"integration-password-123"}`, nil)
	must(w, 200)
	waiting := w.Result().Cookies()[0]
	w = request("POST", base+"/admission", `{}`, waiting)
	must(w, 200)
	if !strings.Contains(w.Body.String(), "waiting") {
		t.Fatal(w.Body.String())
	}
	for _, path := range []string{"/tracks", "/participants", "/messages", "/members", "/polls", "/reactions"} {
		must(request("GET", base+path, "", waiting), 403)
	}
	must(request("POST", base+"/presence", `{"kind":"join"}`, waiting), 403)
	must(request("POST", base+"/sfu", `{"op":"new"}`, waiting), 403)
	moderate := func(action string, cookie *http.Cookie) *httptest.ResponseRecorder {
		return request("POST", base+"/moderate", `{"action":"`+action+`","user_id":"`+id+`"}`, cookie)
	}
	must(moderate("admit", waiting), 403)
	must(moderate("admit", other), 404)
	must(moderate("admit|deny", teacher), 400)
	must(moderate("admit", teacher), 200)
	must(request("POST", base+"/presence", `{"kind":"join"}`, waiting), 200)
	must(request("POST", base+"/messages", `{"content":"blocked chat"}`, waiting), 403)
	must(request("POST", base+"/sfu", `{"op":"new"}`, waiting), 200)
	var sid string
	if a.db.QueryRow("SELECT id FROM media_sessions WHERE user_id=?", id).Scan(&sid) != nil {
		t.Fatal("no student media session")
	}
	must(request("POST", base+"/sfu", `{"op":"tracks","session_id":"`+sid+`","tracks":[{"location":"local","mid":"0","trackName":"screen-video-test"}]}`, waiting), 403)
	must(request("POST", base+"/sfu", `{"op":"tracks","session_id":"`+sid+`","tracks":[{"location":"local","mid":"0","trackName":"video-test"}]}`, waiting), 200)
	must(moderate("request_mute", teacher), 200)
	w = request("GET", base, "", waiting)
	must(w, 200)
	var view struct {
		Mute int64 `json:"mute_request"`
	}
	json.Unmarshal(w.Body.Bytes(), &view)
	if view.Mute != 1 {
		t.Fatal(w.Body.String())
	}
	must(moderate("request_mute_all", teacher), 200)
	w = request("GET", base, "", waiting)
	must(w, 200)
	json.Unmarshal(w.Body.Bytes(), &view)
	if view.Mute != 2 {
		t.Fatal("bulk mic request missing")
	}
	must(request("POST", base+"/hand", `{"raised":true}`, waiting), 200)
	must(moderate("lower_hands_all", teacher), 200)
	must(request("POST", base+"/polls", `{"question":"Q","options":["A","B"]}`, waiting), 403)
	must(request("POST", base+"/polls", `{"question":"Q","options":["A","a"]}`, teacher), 400)
	w = request("POST", base+"/polls", `{"question":"Bạn đã hiểu chưa?","options":["Đã hiểu","Cần giảng lại"]}`, teacher)
	must(w, 201)
	var poll struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(w.Body.Bytes(), &poll) != nil || poll.ID == "" {
		t.Fatal(w.Body.String())
	}
	vote := base + "/polls/" + poll.ID
	must(request("POST", vote, `{"action":"vote","choice":1}`, other), 404)
	must(request("POST", vote, `{"action":"vote","choice":99}`, waiting), 400)
	must(request("POST", vote, `{"action":"vote","choice":1}`, waiting), 200)
	must(request("POST", vote, `{"action":"vote","choice":0}`, waiting), 200)
	w = request("GET", base+"/polls", "", waiting)
	must(w, 200)
	var polls []roomPoll
	if json.Unmarshal(w.Body.Bytes(), &polls) != nil || len(polls) != 1 || polls[0].Counts[0] != 1 || polls[0].Counts[1] != 0 || polls[0].MyChoice != 0 || strings.Contains(w.Body.String(), id) {
		t.Fatal("poll results leaked identities or duplicated votes", w.Body.String())
	}
	must(request("POST", vote, `{"action":"close"}`, waiting), 403)
	must(request("POST", vote, `{"action":"close"}`, teacher), 200)
	must(request("POST", vote, `{"action":"vote","choice":1}`, waiting), 409)
	must(request("POST", base+"/reactions", `{"emoji":"invalid"}`, waiting), 400)
	must(request("POST", base+"/reactions", `{"emoji":"👍"}`, waiting), 201)
	must(request("GET", base+"/reactions", "", waiting), 200)
	for i := 0; i < 4; i++ {
		must(request("POST", base+"/reactions", `{"emoji":"👏"}`, waiting), 201)
	}
	must(request("POST", base+"/reactions", `{"emoji":"🎉"}`, waiting), 429)
	must(moderate("remove", teacher), 200)
	must(request("POST", base+"/presence", `{"kind":"heartbeat"}`, waiting), 403)
	must(request("POST", base+"/sfu", `{"op":"new"}`, waiting), 403)
	must(request("GET", base+"/polls", "", waiting), 403)
	if a.cache.Exists(context.Background(), "media-retired:"+sid).Val() != 1 {
		t.Fatal("removed student's SFU not retired")
	}
	must(moderate("admit", teacher), 200)
	must(request("POST", base+"/presence", `{"kind":"join"}`, waiting), 200)
	must(request("POST", base+"/sfu", `{"op":"renegotiate","session_id":"`+sid+`"}`, waiting), 409)
	if _, e := a.db.Exec("UPDATE room_members SET state='waiting' WHERE user_id=?", id); e != nil {
		t.Fatal(e)
	}
	must(request("POST", base+"/controls", `{"lobby":false,"chat_enabled":true,"present_enabled":true,"revision":1}`, teacher), 200)
	must(request("POST", base+"/controls", `{"lobby":true,"chat_enabled":false,"present_enabled":false,"revision":1}`, teacher), 409)
	w = request("GET", base, "", waiting)
	must(w, 200)
	if !strings.Contains(w.Body.String(), `"admission":"admitted"`) {
		t.Fatal("disabling lobby stranded student", w.Body.String())
	}
	must(request("POST", base+"/messages", `{"content":"chat restored"}`, waiting), 201)
	must(request("POST", base+"/media/reset", `{"session_id":"not-owned"}`, student), 200)
	var remaining int
	a.db.QueryRow("SELECT COUNT(*) FROM media_sessions WHERE id=?", sid).Scan(&remaining)
	if remaining != 1 {
		t.Fatal("another student's scoped reset deleted media")
	}
}
