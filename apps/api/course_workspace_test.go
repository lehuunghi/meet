package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"sync"
	"testing"
)

func TestPasswordAndRoomCodeRules(t *testing.T) {
	if !validAccountPassword("student", "123456") || !validAccountPassword("teacher", "áéíóúà") || validAccountPassword("teacher", "12345") || validAccountPassword("admin", "123456") {
		t.Fatal("password role limits")
	}
	for i := 0; i < 30; i++ {
		code, e := shortRoomCode()
		if e != nil || !regexp.MustCompile(`^[a-z0-9]{6}$`).MatchString(code) {
			t.Fatal("invalid code", code, e)
		}
	}
}
func testCourseWorkspace(t *testing.T, a *app, request func(string, string, string, *http.Cookie) *httptest.ResponseRecorder, teacher, student, other *http.Cookie) {
	t.Helper()
	path := "/api/courses/demo-math/prepare"
	if request("POST", path, `{}`, student).Code != 403 || request("POST", path, `{}`, other).Code != 404 {
		t.Fatal("prepare authorization")
	}
	w := request("POST", path, `{}`, teacher)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var room struct {
		ID   string `json:"id"`
		Code string `json:"short_code"`
	}
	json.Unmarshal(w.Body.Bytes(), &room)
	if room.ID != "demo-meeting" || !regexp.MustCompile(`^[a-z0-9]{6}$`).MatchString(room.Code) {
		t.Fatal("prepare did not reuse live meeting", w.Body.String())
	}
	if request("GET", "/api/rooms/"+room.Code, "", student).Code != 200 || request("GET", "/api/rooms/"+room.Code, "", other).Code != 404 {
		t.Fatal("short link bypassed course/tenant")
	}
	course := uid()
	if _, e := a.db.Exec("INSERT INTO courses(id,school_id,class_id,teacher_id,name) VALUES(?,'school-demo','demo-class','demo-teacher','Prepare concurrency')", course); e != nil {
		t.Fatal(e)
	}
	var wg sync.WaitGroup
	responses := make(chan *httptest.ResponseRecorder, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			responses <- request("POST", "/api/courses/"+course+"/prepare", `{}`, teacher)
		}()
	}
	wg.Wait()
	close(responses)
	ids := map[string]bool{}
	for w := range responses {
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		var item struct {
			ID string `json:"id"`
		}
		json.Unmarshal(w.Body.Bytes(), &item)
		ids[item.ID] = true
	}
	if len(ids) != 1 {
		t.Fatal("concurrent prepare duplicated meeting")
	}
	var count int
	a.db.QueryRow("SELECT COUNT(*) FROM meetings WHERE course_id=?", course).Scan(&count)
	if count != 1 {
		t.Fatal("unexpected meeting count", count)
	}
	if request("GET", "/api/meetings?page=-1", "", teacher).Code != 400 {
		t.Fatal("negative page accepted")
	}
}
