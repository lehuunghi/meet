package main

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func testSFURotationUsageFailover(t *testing.T, a *app, school, owner string, base string, cookie *http.Cookie, request func(string, string, any, *http.Cookie) *httptest.ResponseRecorder) {
	t.Helper()
	ctx := t.Context()
	cfg, e := loadSettings()
	if e != nil {
		t.Fatal(e)
	}
	defer saveSettings(cfg)
	oldClient := a.client
	defer func() { a.client = oldClient }()
	badApp := ""
	counter := 0
	var calls []string
	var mu sync.Mutex
	a.client = &http.Client{Transport: testTransport(func(r *http.Request) (*http.Response, error) {
		mu.Lock()
		defer mu.Unlock()
		calls = append(calls, r.Method+" "+r.URL.Path)
		status := 200
		counter++
		body := fmt.Sprintf(`{"sessionId":"probe-%d"}`, counter)
		if strings.Contains(r.URL.Path, "/apps/"+badApp+"/") && badApp != "" && strings.HasSuffix(r.URL.Path, "/new") && r.Method == "POST" {
			status = 503
			body = `{}`
		}
		if r.Method == "GET" {
			body = `{"tracks":[{"mid":"0","status":"active"}]}`
		}
		if strings.HasSuffix(r.URL.Path, "/tracks/close") {
			body = `{"tracks":[{"mid":"0"}]}`
		}
		return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
	})}
	must := func(e error) {
		t.Helper()
		if e != nil {
			t.Fatal(e)
		}
	}
	newMeeting := func() string {
		id := uid()
		_, e := a.db.Exec(`INSERT INTO meetings(id,school_id,course_id,title,starts_at,status) SELECT ?,school_id,course_id,'SFU QA',UTC_TIMESTAMP(),'live' FROM meetings WHERE school_id=? AND id=?`, id, school, base)
		must(e)
		return id
	}
	root := newMeeting()
	p, e := a.meetingProvider(ctx, school, root)
	must(e)
	if p.ID != "b" {
		t.Fatalf("same class must advance to b, got %s", p.ID)
	}
	next := newMeeting()
	np, e := a.meetingProvider(ctx, school, next)
	must(e)
	if np.ID != "a" {
		t.Fatal("same-class lesson did not wrap")
	}
	again, e := a.meetingProvider(ctx, school, root)
	must(e)
	if again.ID != p.ID {
		t.Fatal("room lost affinity")
	}
	child := newMeeting()
	round := uid()
	_, e = a.db.Exec("INSERT INTO meeting_breakout_rounds(id,school_id,parent_id,status) VALUES(?,?,?,'active')", round, school, root)
	must(e)
	_, e = a.db.Exec("INSERT INTO meeting_breakout_rooms(school_id,round_id,meeting_id,position) VALUES(?,?,?,1)", school, round, child)
	must(e)
	cp, e := a.meetingProvider(ctx, school, child)
	must(e)
	if cp.ID != p.ID {
		t.Fatal("group split from root allocation")
	}
	var cursor string
	must(a.db.QueryRow("SELECT last_provider FROM sfu_allocation_cursor WHERE id=1").Scan(&cursor))
	if cursor != "a" {
		t.Fatal("breakout consumed rotation")
	}
	sid := "usage-" + uid()
	stale, e := a.registerMediaSession(ctx, school, root, owner, sid, p)
	must(e)
	if stale {
		t.Fatal("new session stale")
	}
	_, e = a.db.Exec("INSERT INTO publications(school_id,meeting_id,session_id,track_name,user_id) VALUES(?,?,?,'video-qa',?)", school, root, sid, owner)
	must(e)
	url := "/api/meetings/" + root + "/media/usage"
	for _, v := range []usageSample{{sid, 100, 200}, {sid, 90, 150}, {sid, 140, 260}, {sid, 140, 260}} {
		w := request("POST", url, v, cookie)
		if w.Code != 200 {
			t.Fatalf("usage %d %s", w.Code, w.Body)
		}
	}
	if request("POST", url, usageSample{sid, 150, 270}, nil).Code != 401 {
		t.Fatal("anonymous usage accepted")
	}
	if request("POST", url, usageSample{"other-session", 999, 999}, cookie).Code != 404 {
		t.Fatal("unknown session accepted")
	}
	var sent, received uint64
	must(a.db.QueryRow("SELECT SUM(ingress_bytes),SUM(egress_bytes) FROM sfu_usage_daily WHERE school_id=? AND provider_id=?", school, p.ID).Scan(&sent, &received))
	if sent != 140 || received != 260 {
		t.Fatalf("duplicate usage %d %d", sent, received)
	}
	var wg sync.WaitGroup
	for _, v := range []usageSample{{sid, 210, 350}, {sid, 170, 280}, {sid, 200, 300}} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if e := recordSFUUsage(ctx, a.db, school, p.ID, p.AppID, v); e != nil {
				t.Error(e)
			}
		}()
	}
	wg.Wait()
	must(a.db.QueryRow("SELECT SUM(ingress_bytes),SUM(egress_bytes) FROM sfu_usage_daily WHERE school_id=? AND provider_id=?", school, p.ID).Scan(&sent, &received))
	if sent != 210 || received != 350 {
		t.Fatalf("concurrent usage %d %d", sent, received)
	}
	changed, e := a.trySFUFailover(ctx, school, root, p)
	must(e)
	if changed {
		t.Fatal("healthy provider moved")
	}
	a.cache.Del(ctx, "sfu-failover:"+school+":"+root)
	badApp = p.AppID
	changed, e = a.trySFUFailover(ctx, school, root, p)
	must(e)
	if !changed {
		t.Fatal("confirmed outage did not move")
	}
	replacement, e := a.meetingProvider(ctx, school, root)
	must(e)
	if replacement.ID != "a" || replacement.Generation <= p.Generation {
		t.Fatal("invalid replacement")
	}
	replacementChild, e := a.meetingProvider(ctx, school, child)
	must(e)
	if replacementChild.ID != replacement.ID || replacementChild.Generation <= cp.Generation {
		t.Fatal("child not migrated")
	}
	if a.cache.Exists(ctx, "media-retired:"+sid).Val() != 1 {
		t.Fatal("old session not retired")
	}
	var count int
	must(a.db.QueryRow("SELECT COUNT(*) FROM publications WHERE school_id=? AND meeting_id=?", school, root).Scan(&count))
	if count != 0 {
		t.Fatal("old publications survived")
	}
	route, e := a.sessionProvider(ctx, school, root, sid)
	must(e)
	if route.ID != p.ID {
		t.Fatal("cleanup routed to new app")
	}
	must(a.closeSFUSession(ctx, school, root, sid))
	found := false
	for _, v := range calls {
		if strings.Contains(v, "/apps/"+p.AppID+"/sessions/"+sid) {
			found = true
		}
	}
	if !found {
		t.Fatal("old app was not used for teardown")
	}
	w := request("POST", url, usageSample{sid, 240, 400}, cookie)
	if w.Code != 200 {
		t.Fatalf("final usage %s", w.Body)
	}
	must(a.db.QueryRow("SELECT SUM(ingress_bytes),SUM(egress_bytes) FROM sfu_usage_daily WHERE school_id=? AND provider_id=?", school, p.ID).Scan(&sent, &received))
	if sent != 240 || received != 400 {
		t.Fatal("old session usage attributed to new app")
	}
	stale, e = a.registerMediaSession(ctx, school, root, owner, "late-"+uid(), p)
	must(e)
	if !stale {
		t.Fatal("late upstream result accepted in new generation")
	}
	current := cfg
	current.SFU = append([]sfuProvider{}, cfg.SFU...)
	current.SFU[0].Enabled = false
	must(saveSettings(current))
	stable, e := a.meetingProvider(ctx, school, root)
	must(e)
	if stable.ID != "a" {
		t.Fatal("disabled active app split live room")
	}
	newer := newMeeting()
	selected, e := a.meetingProvider(ctx, school, newer)
	must(e)
	if selected.ID != "b" {
		t.Fatal("disabled app received a new lesson")
	}
	current.SFU[1].Enabled = false
	must(saveSettings(current))
	if _, e = a.meetingProvider(ctx, school, newMeeting()); e == nil {
		t.Fatal("all-disabled pool still creates media")
	}
}
