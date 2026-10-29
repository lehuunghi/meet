package main

import (
	"context"
	"database/sql"
	"encoding/json"
	mysql "github.com/go-sql-driver/mysql"
	"github.com/redis/go-redis/v9"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestRecordingModes(t *testing.T) {
	for _, s := range []string{"vps", "browser", "cluster"} {
		if !validRecordingMode(s) {
			t.Fatal(s)
		}
	}
	for _, s := range []string{"", "auto", "shell"} {
		if validRecordingMode(s) {
			t.Fatal(s)
		}
	}
}

func TestRecordingWorkersIntegration(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN unset")
	}
	base, e := sql.Open("mysql", dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer base.Close()
	database := "meet_workers_" + uid()
	if _, e = base.Exec("CREATE DATABASE " + database); e != nil {
		t.Fatal(e)
	}
	defer base.Exec("DROP DATABASE " + database)
	d, e := mysql.ParseDSN(dsn)
	if e != nil {
		t.Fatal(e)
	}
	d.DBName = database
	db, e := sql.Open("mysql", d.FormatDSN())
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	if e = migrate(db); e != nil {
		t.Fatal(e)
	}
	opt, e := redis.ParseURL(os.Getenv("TEST_REDIS_URL"))
	if e != nil {
		t.Fatal(e)
	}
	cache := redis.NewClient(opt)
	defer cache.Close()
	a := &app{db: db, cache: cache, client: &http.Client{Timeout: time.Second}}
	t.Setenv("CONFIG_DIR", t.TempDir())
	cfg := systemSettings{R2: r2Settings{Enabled: true, Account: "test", Bucket: "test", Access: "test", Secret: "test"}, SFU: []sfuProvider{{ID: "p", AppID: "app", Secret: "secret", Enabled: true, Weight: 1}}, Retention: 30}
	if e = saveSettings(cfg); e != nil {
		t.Fatal(e)
	}
	school, teacher, administrator, class, course, meeting := uid(), uid(), uid(), uid(), uid(), uid()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, e := db.Exec(q, args...); e != nil {
			t.Fatal(e)
		}
	}
	exec("INSERT INTO schools(id,slug,name) VALUES(?,?,?)", school, school, "Worker school")
	for id, role := range map[string]string{teacher: "teacher", administrator: "admin"} {
		exec("INSERT INTO users(id,school_id,email,name,password_hash,role) VALUES(?,?,?,?,?,?)", id, school, id+"@qa.invalid", id, "not-a-login", role)
	}
	exec("INSERT INTO classes(id,school_id,name) VALUES(?,?,?)", class, school, "Class")
	exec("INSERT INTO courses(id,school_id,class_id,teacher_id,name) VALUES(?,?,?,?,?)", course, school, class, teacher, "Math")
	exec("INSERT INTO meetings(id,school_id,course_id,title,starts_at,status,recording_allowed) VALUES(?,?,?,?,UTC_TIMESTAMP(),'live',TRUE)", meeting, school, course, "Worker lesson")
	exec("INSERT INTO meeting_teaching_windows(school_id,meeting_id,started_at,teacher_id) VALUES(?,?,UTC_TIMESTAMP(),?)", school, meeting, teacher)
	exec("INSERT INTO recording_policies VALUES(?,'cluster')", school)
	call := func(fn http.HandlerFunc, body, token, job, lease, action string, u identity) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/", strings.NewReader(body))
		r.SetPathValue("job", job)
		r.SetPathValue("action", action)
		r.SetPathValue("id", meeting)
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		r.Header.Set("X-Recording-Lease", lease)
		if u.ID != "" {
			r = r.WithContext(context.WithValue(r.Context(), authKey{}, u))
		}
		w := httptest.NewRecorder()
		fn(w, r)
		return w
	}
	adminUser := identity{ID: administrator, School: school, Role: "admin"}
	var creds []struct{ ID, Token string }
	for i := 0; i < 2; i++ {
		w := call(a.recordingWorkers, `{"Action":"enroll","Name":"Worker"}`, "", "", "", "", adminUser)
		if w.Code != 201 {
			t.Fatal(w.Code, w.Body.String())
		}
		var code struct{ Code string }
		json.Unmarshal(w.Body.Bytes(), &code)
		payload := `{"Code":"` + code.Code + `","Platform":"linux"}`
		w = call(a.recorderEnroll, payload, "", "", "", "", identity{})
		if w.Code != 201 {
			t.Fatal(w.Code, w.Body.String())
		}
		var c struct{ ID, Token string }
		json.Unmarshal(w.Body.Bytes(), &c)
		creds = append(creds, c)
		if w = call(a.recorderEnroll, payload, "", "", "", "", identity{}); w.Code != 403 {
			t.Fatal("enrollment reused", w.Code)
		}
	}
	w := call(a.recorderClaim, `{}`, creds[0].Token, "", "", "", identity{})
	var claimed struct{ Job recordingWorkerJob }
	json.Unmarshal(w.Body.Bytes(), &claimed)
	j := claimed.Job
	if w.Code != 200 || j.ID == "" {
		t.Fatal(w.Code, w.Body.String())
	}
	defer cache.Del(t.Context(), recordingLeaseKey(j), "recorder-node-job:"+j.Node, "recorder-job:"+j.ID)
	w = call(a.recorderClaim, `{}`, creds[1].Token, "", "", "", identity{})
	if strings.Contains(w.Body.String(), `"lease"`) {
		t.Fatal("room assigned twice")
	}
	if w = call(a.recorderJobAction, `{}`, creds[1].Token, j.ID, j.Lease, "tick", identity{}); w.Code != 403 {
		t.Fatal("another node used job", w.Code)
	}
	w = call(a.recorderJobAction, `{"State":"recording"}`, creds[0].Token, j.ID, j.Lease, "tick", identity{})
	if w.Code != 200 || strings.Contains(w.Body.String(), `"stop":true`) {
		t.Fatal(w.Code, w.Body.String())
	}
	if w = call(a.recorderJobAction, `{"op":"publish"}`, creds[0].Token, j.ID, j.Lease, "sfu", identity{}); w.Code != 403 {
		t.Fatal("recorder allowed publishing", w.Code, w.Body.String())
	}
	a.client.Transport = testTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 503, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("{}")), Request: r}, nil
	})
	w = call(a.recorderJobAction, `{"op":"new"}`, creds[0].Token, j.ID, j.Lease, "sfu", identity{})
	if w.Code != 502 {
		t.Fatal(w.Code, w.Body.String())
	}
	failoverKey := "sfu-failover-request:" + school + ":" + meeting
	defer cache.Del(t.Context(), failoverKey)
	if !strings.Contains(cache.Get(t.Context(), failoverKey).Val(), `"verified":true`) {
		t.Fatal("worker upstream failure was not sent to failover coordinator")
	}
	recording := uid()
	key := recordingPrefix + school + "/" + meeting + "/" + recording + ".webm"
	exec("INSERT INTO recordings(id,school_id,meeting_id,owner_id,object_key,bucket,expires_at) VALUES(?,?,?,?,?,'test',UTC_TIMESTAMP()+INTERVAL 30 DAY)", recording, school, meeting, teacher, key)
	state, _ := json.Marshal(multipartRecording{Upload: "upload", Key: key, Bucket: "test"})
	cache.Set(t.Context(), "recording-multipart:"+recording, state, time.Hour)
	cache.Set(t.Context(), "recorder-file-job:"+recording, j.ID, time.Hour)
	defer cache.Del(t.Context(), "recording-multipart:"+recording, "recorder-file-job:"+recording)
	w = call(a.recorderJobAction, `{"Recording":"`+recording+`","Part":1,"Size":1024}`, creds[0].Token, j.ID, j.Lease, "part", identity{})
	if w.Code != 200 || !strings.Contains(w.Body.String(), "X-Amz-Signature") {
		t.Fatal("remote signed upload", w.Code, w.Body.String())
	}
	if w = call(a.recorderJobAction, `{"Recording":"other","Part":1,"Size":1024}`, creds[0].Token, j.ID, j.Lease, "part", identity{}); w.Code != 403 {
		t.Fatal("cross job file accepted", w.Code)
	}
	a.client.Transport = testTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"video/webm"}, "Content-Length": []string{"1024"}}, ContentLength: 1024, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
	})
	w = call(a.recorderJobAction, `{"Recording":"`+recording+`","Parts":1}`, creds[0].Token, j.ID, j.Lease, "finish", identity{})
	if w.Code != 200 {
		t.Fatal("remote completion", w.Code, w.Body.String())
	}
	w = call(a.recordingWorkers, `{"Action":"mode","Mode":"browser"}`, "", "", "", "", adminUser)
	if w.Code != 409 {
		t.Fatal("policy changed during recording", w.Code)
	}
	// An expired worker may never renew another worker's lease or delete it on release.
	cache.Set(t.Context(), recordingLeaseKey(j), "replacement", time.Minute)
	if w = call(a.recorderJobAction, `{}`, creds[0].Token, j.ID, j.Lease, "tick", identity{}); w.Code != 409 {
		t.Fatal("expired lease renewed", w.Code)
	}
	call(a.recorderJobAction, `{}`, creds[0].Token, j.ID, j.Lease, "release", identity{})
	if cache.Get(t.Context(), recordingLeaseKey(j)).Val() != "replacement" {
		t.Fatal("stale release removed new lease")
	}
	exec("UPDATE recorder_nodes SET enabled=FALSE WHERE id=?", creds[0].ID)
	if w = call(a.recorderClaim, `{}`, creds[0].Token, "", "", "", identity{}); w.Code != 401 {
		t.Fatal("revoked node accepted", w.Code)
	}
}
