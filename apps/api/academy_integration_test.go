package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	mysql "github.com/go-sql-driver/mysql"
	"github.com/redis/go-redis/v9"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestAcademyIntegration(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN unset")
	}
	base, e := sql.Open("mysql", dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer base.Close()
	name := "academy_test_" + uid()
	if _, e = base.Exec("CREATE DATABASE " + name); e != nil {
		t.Fatal(e)
	}
	defer base.Exec("DROP DATABASE " + name)
	config, _ := mysql.ParseDSN(dsn)
	config.DBName = name
	db, e := sql.Open("mysql", config.FormatDSN())
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	if e = migrate(db); e != nil {
		t.Fatal(e)
	}
	t.Setenv("CONFIG_DIR", t.TempDir())
	t.Setenv("LOGIN_SCHOOL", "academy")
	cfg := systemSettings{Platform: "school", Retention: 30, Commerce: commerceSettings{FreeVideos: 4, BankBIN: "970436", BankAccount: "123456789", ChecksumKey: "test-checksum"}, R2: r2Settings{Enabled: true, Account: "test", Bucket: "test-bucket", Access: "test-access", Secret: "test-secret"}}
	if e = saveSettings(cfg); e != nil {
		t.Fatal(e)
	}
	opt, _ := redis.ParseURL(os.Getenv("TEST_REDIS_URL"))
	cache := redis.NewClient(opt)
	defer cache.Close()
	a := &app{db: db, cache: cache, client: &http.Client{Timeout: time.Second}, origin: "https://academy.example", secure: true}
	ctx := context.Background()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, e := db.Exec(q, args...); e != nil {
			t.Fatal(e)
		}
	}
	exec("INSERT INTO schools(id,slug,name) VALUES('academy-school','academy','Trung tâm thử'),('academy-other','other','Khác')")
	for _, u := range []struct{ ID, School, Role string }{{"ac-admin", "academy-school", "admin"}, {"ac-student", "academy-school", "student"}, {"ac-teacher", "academy-school", "teacher"}, {"ac-limited", "academy-school", "admin"}, {"ac-other", "academy-other", "admin"}} {
		exec("INSERT INTO users(id,school_id,name,email,password_hash,role) VALUES(?,?,?,?,?,?)", u.ID, u.School, "Người dùng thử", u.ID+"@example.test", "test-only-hash", u.Role)
	}
	exec("INSERT INTO user_controls(user_id,state,permissions) VALUES('ac-limited','active','[\"content\"]')")
	exec("INSERT INTO classes(id,school_id,name) VALUES('ac-class','academy-school','Lớp Live')")
	exec("INSERT INTO courses(id,school_id,class_id,teacher_id,name) VALUES('ac-math','academy-school','ac-class','ac-teacher','Toán')")
	exec("INSERT INTO meetings(id,school_id,course_id,title,starts_at,status) VALUES('ac-meeting','academy-school','ac-math','Buổi học',UTC_TIMESTAMP(),'live')")
	exec("INSERT INTO enrollments(school_id,class_id,user_id) VALUES('academy-school','ac-class','ac-student')")
	exec("INSERT INTO academy_profiles(school_id,user_id,dob,address,school_name,phone,parent_phone,email_verified) VALUES('academy-school','ac-student','2010-01-01','Địa chỉ','Trường học','0901234567','0912345678',TRUE)")
	exec("INSERT INTO academy_courses(id,school_id,title,description,teacher_name,academic_course_id,published) VALUES('ac-course','academy-school','Khóa Toán','Giới thiệu','Giáo viên','ac-math',TRUE)")
	exec("INSERT INTO academy_plans(id,school_id,name,price_vnd,days,live_enabled) VALUES('ac-plan','academy-school','VIP',100000,30,TRUE)")
	for i := 0; i < 7; i++ {
		exec("INSERT INTO academy_lessons(id,school_id,course_id,title,object_key,bucket,status,duration_seconds) VALUES(?,'academy-school','ac-course',?,?,'test-bucket','ready',600)", fmt.Sprintf("lesson-%d", i), fmt.Sprintf("Bài %d", i), fmt.Sprintf("academy/vod/test/%d.mp4", i))
	}
	cookie := func(id, school, role string) *http.Cookie {
		token := uid()
		u := identity{ID: id, School: school, Role: role, Version: 1}
		raw, _ := json.Marshal(u)
		cache.Set(ctx, "session:"+digest(token), string(raw), time.Hour)
		cache.Set(ctx, "current-session:"+id, digest(token), time.Hour)
		t.Cleanup(func() { cache.Del(ctx, "session:"+digest(token), "current-session:"+id) })
		return &http.Cookie{Name: "meet_session", Value: token}
	}
	admin := cookie("ac-admin", "academy-school", "admin")
	student := cookie("ac-student", "academy-school", "student")
	limited := cookie("ac-limited", "academy-school", "admin")
	other := cookie("ac-other", "academy-other", "admin")
	h := a.routes()
	request := func(method, path, body string, c *http.Cookie) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Origin", a.origin)
		if c != nil {
			r.AddCookie(c)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	must := func(w *httptest.ResponseRecorder, status int) {
		t.Helper()
		if w.Code != status {
			t.Fatalf("want %d got %d: %s", status, w.Code, w.Body.String())
		}
	}
	must(request("GET", "/api/academy/courses", "", nil), 404)
	must(request("GET", "/api/meetings/ac-meeting", "", student), 200)
	cfg.Platform = "academy"
	if e = saveSettings(cfg); e != nil {
		t.Fatal(e)
	}
	must(request("GET", "/api/meetings/ac-meeting", "", student), 402)
	must(request("GET", "/api/academy/admin/orders", "", limited), 403)
	must(request("GET", "/api/academy/control/people", "", limited), 403)
	must(request("GET", "/api/academy/control/classes", "", limited), 403)
	must(request("GET", "/api/academy/control/people", "", student), 403)
	must(request("GET", "/api/academy/control/people", "", admin), 200)
	must(request("POST", "/api/academy/lessons/lesson-0/play", "{}", other), 404)
	for i := 0; i < 3; i++ {
		must(request("POST", fmt.Sprintf("/api/academy/lessons/lesson-%d/play", i), "{}", student), 200)
	}
	must(request("POST", "/api/academy/lessons/lesson-0/play", "{}", student), 200)
	var lock sync.Mutex
	accepted := 0
	var wg sync.WaitGroup
	for i := 3; i < 7; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			w := request("POST", fmt.Sprintf("/api/academy/lessons/lesson-%d/play", i), "{}", student)
			lock.Lock()
			defer lock.Unlock()
			if w.Code == 200 {
				accepted++
			} else if w.Code != 402 {
				t.Errorf("quota response %d %s", w.Code, w.Body.String())
			}
		}(i)
	}
	wg.Wait()
	if accepted != 1 {
		t.Fatalf("quota race: %d requests accepted", accepted)
	}
	order := request("POST", "/api/academy/orders", `{"plan_id":"ac-plan"}`, student)
	must(order, 201)
	var out map[string]any
	_ = json.Unmarshal(order.Body.Bytes(), &out)
	id := out["id"].(string)
	exec("UPDATE academy_plans SET days=1,price_vnd=1 WHERE id='ac-plan'")
	must(request("POST", "/api/academy/orders/"+id+"/review", `{"action":"approve"}`, limited), 403)
	must(request("POST", "/api/academy/orders/"+id+"/review", `{"action":"approve"}`, other), 404)
	must(request("POST", "/api/academy/orders/"+id+"/review", `{"action":"approve"}`, admin), 200)
	var until time.Time
	if db.QueryRow("SELECT expires_at FROM academy_memberships WHERE user_id='ac-student'").Scan(&until) != nil {
		t.Fatal("missing membership")
	}
	if time.Until(until) < 29*24*time.Hour {
		t.Fatal("plan edits changed order snapshot")
	}
	must(request("POST", "/api/academy/orders/"+id+"/review", `{"action":"approve"}`, admin), 200)
	var again time.Time
	_ = db.QueryRow("SELECT expires_at FROM academy_memberships WHERE user_id='ac-student'").Scan(&again)
	if !again.Equal(until) {
		t.Fatal("duplicate approval extended VIP")
	}
	must(request("GET", "/api/meetings/ac-meeting", "", student), 200)
	must(request("POST", "/api/academy/lessons/lesson-6/play", "{}", student), 200)
	must(request("POST", "/api/academy/site", `{"content":{"headline":"Học tốt","description":"Tiếng Việt đầy đủ","published":true}}`, admin), 200)
	web := request("GET", "/website", "", nil)
	must(web, 200)
	if !strings.Contains(web.Body.String(), "Học tốt") || strings.Contains(web.Body.String(), "test-secret") {
		t.Fatal("SSR content/secret failure")
	}
	// Marketing pages escape CMS text, retain course intent and never expose storage keys.
	siteBody := `{"content":{"headline":"VA thử","published":true,"about":"Giới thiệu thật","contact_email":"support@example.test","privacy":"Chính sách <script>không thực thi</script>","course_pages":{"ac-course":{"audience":"Học sinh lớp 10","objectives":"Hiểu hàm số\nVận dụng đồ thị","outline":"Chương 1\nChương 2","schedule":"Thứ hai","preview_lesson":"lesson-0"}}}}`
	siteRead := request("GET", "/api/academy/site", "", admin)
	must(siteRead, 200)
	var siteRows []map[string]string
	_ = json.Unmarshal(siteRead.Body.Bytes(), &siteRows)
	siteBody = strings.Replace(siteBody, `{"content":`, `{"revision":"`+siteRows[0]["revision"]+`","content":`, 1)
	saved := request("POST", "/api/academy/site", siteBody, admin)
	must(saved, 200)
	must(request("POST", "/api/academy/site", `{"content":{"headline":"old client"}}`, admin), 409)
	var revision map[string]any
	_ = json.Unmarshal(saved.Body.Bytes(), &revision)
	must(request("POST", "/api/academy/site", `{"revision":"stale","content":{"headline":"không ghi đè","published":true}}`, admin), 409)
	coursePage := request("GET", "/khoa-hoc/ac-course", "", nil)
	must(coursePage, 200)
	for _, needle := range []string{"Học sinh lớp 10", "Chương 1", "/hoc/khoa-hoc/ac-course", "/hoc/bai-giang/lesson-0"} {
		if !strings.Contains(coursePage.Body.String(), needle) {
			t.Fatalf("missing course detail %s", needle)
		}
	}
	if strings.Contains(coursePage.Body.String(), "academy/vod/test/") {
		t.Fatal("public object key leaked")
	}
	policy := request("GET", "/chinh-sach/bao-mat", "", nil)
	must(policy, 200)
	if strings.Contains(policy.Body.String(), "<script>") {
		t.Fatal("policy HTML unescaped")
	}
	must(request("GET", "/chinh-sach/thanh-toan-hoan-phi", "", nil), 404)
	exec("INSERT INTO academy_courses(id,school_id,title,description,teacher_name,published) VALUES('private-course','academy-school','PRIVATE COURSE','PRIVATE BODY','',FALSE),('foreign-course','academy-other','FOREIGN COURSE','FOREIGN BODY','',TRUE)")
	must(request("GET", "/khoa-hoc/private-course", "", nil), 404)
	must(request("GET", "/khoa-hoc/foreign-course", "", nil), 404)
	sitemap := request("GET", "/sitemap.xml", "", nil)
	must(sitemap, 200)
	if !strings.Contains(sitemap.Body.String(), "/khoa-hoc/ac-course") || strings.Contains(sitemap.Body.String(), "private-course") || strings.Contains(sitemap.Body.String(), "foreign-course") {
		t.Fatal("sitemap course scope")
	}

	// Teacher-only announcements, and students never receive classmates' personal records.
	teacher := cookie("ac-teacher", "academy-school", "teacher")
	exec("INSERT INTO users(id,school_id,email,name,password_hash,role) VALUES('ac-unassigned','academy-school','unassigned@example.test','Không phân công','test','teacher'),('ac-second','academy-school','second@example.test','Học sinh thứ hai','test','student')")
	unassigned := cookie("ac-unassigned", "academy-school", "teacher")
	exec("INSERT INTO enrollments VALUES('academy-school','ac-class','ac-second')")
	exec("INSERT INTO academy_memberships VALUES('academy-school','ac-second',UTC_TIMESTAMP()+INTERVAL 30 DAY,TRUE)")
	must(request("POST", "/api/courses/ac-math/classroom", `{"title":"Thông báo học tập","body":"Ôn tập chương 1"}`, teacher), 201)
	must(request("POST", "/api/courses/ac-math/classroom", `{"title":"Không được","body":"Không được"}`, student), 403)
	must(request("GET", "/api/courses/ac-math/classroom", "", unassigned), 404)
	must(request("GET", "/api/courses/ac-math/classroom", "", other), 404)
	must(request("GET", "/api/courses/ac-math/classroom", "", limited), 403)
	community := request("GET", "/api/courses/ac-math/classroom", "", student)
	must(community, 200)
	var communityData map[string]any
	_ = json.Unmarshal(community.Body.Bytes(), &communityData)
	if len(communityData["students"].([]any)) != 0 || len(communityData["announcements"].([]any)) != 1 || communityData["can_manage"] != false {
		t.Fatal("student roster/privacy failure")
	}
	staffCommunity := request("GET", "/api/courses/ac-math/classroom", "", teacher)
	must(staffCommunity, 200)
	if !strings.Contains(staffCommunity.Body.String(), "Học sinh thứ hai") {
		t.Fatal("assigned teacher cannot see class roster")
	}

	// Work summaries use own progress and assigned courses only, with no question/answer payloads.
	exec("INSERT INTO academy_progress(school_id,user_id,lesson_id,seconds,completed) VALUES('academy-school','ac-student','lesson-0',120,FALSE),('academy-school','ac-second','lesson-1',240,FALSE)")
	exec("INSERT INTO academy_assignments(id,school_id,course_id,teacher_id,title,questions,due_at) VALUES('ac-task','academy-school','ac-course','ac-teacher','Bài cần nộp','[{\"id\":\"q\",\"prompt\":\"Question\",\"answer\":\"ANSWER-SECRET\"}]',UTC_TIMESTAMP()+INTERVAL 1 DAY)")
	summary := request("GET", "/api/academy/workspace", "", student)
	must(summary, 200)
	if !strings.Contains(summary.Body.String(), "lesson-0") || strings.Contains(summary.Body.String(), "lesson-1") || !strings.Contains(summary.Body.String(), "ac-task") || strings.Contains(summary.Body.String(), "ANSWER-SECRET") {
		t.Fatal("workspace personal-data scope")
	}
	exec("INSERT INTO academy_submissions(school_id,assignment_id,user_id,answers) VALUES('academy-school','ac-task','ac-student','{}')")
	teacherSummary := request("GET", "/api/academy/workspace", "", teacher)
	must(teacherSummary, 200)
	var work map[string]any
	_ = json.Unmarshal(teacherSummary.Body.Bytes(), &work)
	task := work["tasks"].([]any)[0].(map[string]any)
	if fmt.Sprint(task["ungraded"]) != "1" || fmt.Sprint(task["missing"]) != "1" {
		t.Fatalf("task counts %v", task)
	}
	unassignedSummary := request("GET", "/api/academy/workspace", "", unassigned)
	must(unassignedSummary, 200)
	if strings.Contains(unassignedSummary.Body.String(), "ac-task") || strings.Contains(unassignedSummary.Body.String(), "ac-meeting") {
		t.Fatal("unassigned teacher workspace leak")
	}

	direct := request("GET", "/api/academy/assignments/ac-task", "", student)
	must(direct, 200)
	if strings.Contains(direct.Body.String(), "ANSWER-SECRET") || !strings.Contains(direct.Body.String(), "course_id") {
		t.Fatal("direct task leaks key or loses course")
	}
	must(request("GET", "/api/academy/lessons/lesson-0", "", student), 200)
	must(request("GET", "/api/academy/assignments/ac-task", "", other), 404)
	exec("DELETE FROM enrollments WHERE school_id='academy-school' AND class_id='ac-class' AND user_id='ac-student'")
	must(request("GET", "/api/academy/assignments/ac-task", "", student), 404)
	must(request("GET", "/api/academy/courses/ac-course/assignments", "", student), 403)
	must(request("POST", "/api/academy/assignments/ac-task/submissions", `{"answers":{}}`, student), 402)
	exec("INSERT INTO enrollments(school_id,class_id,user_id) VALUES('academy-school','ac-class','ac-student')")
	notices := request("GET", "/api/academy/notifications", "", student)
	must(notices, 200)
	var ns []academyNotification
	_ = json.Unmarshal(notices.Body.Bytes(), &ns)
	if len(ns) == 0 {
		t.Fatal("missing scoped notifications")
	}
	must(request("POST", "/api/academy/notifications/read", `{"ids":["`+ns[0].ID+`"]}`, student), 200)
	notices = request("GET", "/api/academy/notifications", "", student)
	_ = json.Unmarshal(notices.Body.Bytes(), &ns)
	if !ns[0].Read {
		t.Fatal("notification read state not persistent")
	}
	must(request("POST", "/api/academy/notifications/read", `{"ids":["bad"]}`, student), 400)
	must(request("GET", "/api/meetings?month=2026-99", "", student), 400)
	must(request("GET", "/api/attendance/report?month=2026-99", "", student), 400)
	exec("DELETE FROM academy_memberships WHERE school_id='academy-school' AND user_id='ac-student'")
	freeSummary := request("GET", "/api/academy/workspace", "", student)
	must(freeSummary, 200)
	_ = json.Unmarshal(freeSummary.Body.Bytes(), &work)
	if len(work["tasks"].([]any)) != 0 || len(work["meetings"].([]any)) != 0 {
		t.Fatal("free workspace exposed VIP actions")
	}

	// Permanent catalog deletion is tenant-scoped, confirmed and atomic with CMS.
	exec("INSERT INTO academy_courses(id,school_id,title,description,published) VALUES('delete-qa','academy-school','Xóa thử','Nội dung',TRUE)")
	must(request("POST", "/api/academy/courses/delete-qa/delete", `{"confirm":"Xóa thử"}`, student), 403)
	must(request("POST", "/api/academy/courses/delete-qa/delete", `{"confirm":"Xóa thử"}`, other), 404)
	must(request("POST", "/api/academy/courses/delete-qa/delete", `{"confirm":"sai"}`, admin), 400)
	must(request("POST", "/api/academy/courses/ac-course/delete", `{"confirm":"Khóa Toán"}`, admin), 409)
	var deletionSite string
	if e = db.QueryRow("SELECT content FROM academy_site WHERE school_id='academy-school'").Scan(&deletionSite); e != nil {
		t.Fatal(e)
	}
	var siteFields map[string]any
	_ = json.Unmarshal([]byte(deletionSite), &siteFields)
	siteFields["course_pages"] = map[string]any{"delete-qa": map[string]string{"audience": "Thử"}, "ac-course": map[string]string{"audience": "Giữ"}}
	siteJSON, _ := json.Marshal(siteFields)
	exec("UPDATE academy_site SET content=? WHERE school_id='academy-school'", string(siteJSON))
	must(request("POST", "/api/academy/courses/delete-qa/delete", `{"confirm":"Xóa thử"}`, limited), 200)
	must(request("POST", "/api/academy/courses/delete-qa/delete", `{"confirm":"Xóa thử"}`, limited), 404)
	var deletedCount int
	_ = db.QueryRow("SELECT COUNT(*) FROM academy_courses WHERE id='delete-qa'").Scan(&deletedCount)
	if deletedCount != 0 {
		t.Fatal("course deletion was not permanent")
	}
	_ = db.QueryRow("SELECT content FROM academy_site WHERE school_id='academy-school'").Scan(&deletionSite)
	if strings.Contains(deletionSite, "delete-qa") || !strings.Contains(deletionSite, "ac-course") {
		t.Fatal("course page cleanup affected other content")
	}

	// A published site may hold unfinished profiles without exposing them via HTML or public JSON.
	profileSite := request("GET", "/api/academy/site", "", admin)
	var profileRows []map[string]string
	_ = json.Unmarshal(profileSite.Body.Bytes(), &profileRows)
	profilePayload := `{"revision":"` + profileRows[0]["revision"] + `","content":{"published":true,"show_teachers":true,"show_testimonials":true,"teachers":[{"Name":"PRIVATE-TEACHER","Published":false}],"testimonials":[{"Name":"PRIVATE-REVIEW","Text":"DRAFT-TEXT","Audience":"parent","Published":false}]}}`
	must(request("POST", "/api/academy/site", profilePayload, admin), 200)
	profilePublic := request("GET", "/api/academy/public", "", nil)
	must(profilePublic, 200)
	if strings.Contains(profilePublic.Body.String(), "PRIVATE-") || strings.Contains(profilePublic.Body.String(), "DRAFT-TEXT") {
		t.Fatal("public API exposed unpublished profiles")
	}
	profileSite = request("GET", "/api/academy/site", "", admin)
	if !strings.Contains(profileSite.Body.String(), "PRIVATE-TEACHER") {
		t.Fatal("admin lost editable draft")
	}
	_ = json.Unmarshal(profileSite.Body.Bytes(), &profileRows)
	must(request("POST", "/api/academy/site", `{"revision":"`+profileRows[0]["revision"]+`","content":{"published":true,"testimonials":[{"Name":"","Text":"","Audience":"parent","Published":true}]}}`, admin), 400)
	must(request("POST", "/api/academy/site", `{"revision":"`+profileRows[0]["revision"]+`","content":{"published":true,"testimonials":[{"Name":"Minh họa","Text":"Thử","Rating":6,"Published":true}]}}`, admin), 400)

	previewBody := `{"content":{"headline":"PRIVATE-PREVIEW-HEADLINE","published":false,"posts":[{"Title":"Bài nháp riêng","Body":"PRIVATE-PREVIEW-BODY","Published":false}]},"post":0}`
	must(request("POST", "/api/academy/site/preview", previewBody, student), 403)
	preview := request("POST", "/api/academy/site/preview", previewBody, limited)
	must(preview, 200)
	if !strings.Contains(preview.Body.String(), "PRIVATE-PREVIEW-BODY") || preview.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("private preview missing or cacheable")
	}
	profileSite = request("GET", "/api/academy/site", "", admin)
	if strings.Contains(profileSite.Body.String(), "PRIVATE-PREVIEW-") {
		t.Fatal("preview persisted unsaved content")
	}
	must(request("POST", "/api/academy/site/preview", `{"content":{},"course":"ac-course"}`, other), 404)
	must(request("POST", "/api/academy/site/preview", `{"content":{},"post":9}`, admin), 400)
	// Real SQL queue/revision/order transactions with a deterministic S3 provider.
	exec("INSERT INTO academy_courses(id,school_id,title,description,published) VALUES('copy-course','academy-school','Video lớp','Thử',TRUE)")
	exec("INSERT INTO recordings(id,school_id,meeting_id,owner_id,object_key,bucket,status,size_bytes,expires_at) VALUES('copy-recording','academy-school','ac-meeting','ac-admin','recordings/academy-school/ac-meeting/copy.webm','test-bucket','ready',100,UTC_TIMESTAMP()+INTERVAL 2 DAY)")
	copyBody := `{"recording_id":"copy-recording","title":"Bài từ lớp","chapter":"Chương 1","notes":"Ghi chú tiếng Việt","duration_seconds":600,"published":true}`
	must(request("POST", "/api/academy/courses/copy-course/recordings", copyBody, student), 403)
	must(request("POST", "/api/academy/courses/copy-course/recordings", copyBody, other), 404)
	queued := request("POST", "/api/academy/courses/copy-course/recordings", copyBody, limited)
	must(queued, 202)
	var queuedData map[string]string
	_ = json.Unmarshal(queued.Body.Bytes(), &queuedData)
	copyID := queuedData["id"]
	repeated := request("POST", "/api/academy/courses/copy-course/recordings", copyBody, limited)
	must(repeated, 200)
	var repeatedData map[string]string
	_ = json.Unmarshal(repeated.Body.Bytes(), &repeatedData)
	if repeatedData["id"] != copyID {
		t.Fatal("duplicate import created a second lesson")
	}
	listed := request("GET", "/api/academy/courses/copy-course/lessons", "", student)
	must(listed, 200)
	if strings.Contains(listed.Body.String(), copyID) {
		t.Fatal("unfinished copy was published")
	}
	copied := false
	copyCalls := 0
	a.client.Transport = testTransport(func(r *http.Request) (*http.Response, error) {
		status := 200
		body := ""
		headers := http.Header{}
		length := int64(0)
		switch {
		case r.Method == "HEAD" && strings.Contains(r.URL.Path, "academy/vod/") && !copied:
			status = 404
		case r.Method == "HEAD":
			headers.Set("Content-Type", "video/webm")
			headers.Set("Content-Length", "100")
			headers.Set("ETag", `"copy-etag"`)
			length = 100
		case r.Method == "PUT":
			if r.Header.Get("X-Amz-Copy-Source-If-Match") != `"copy-etag"` {
				t.Fatal("copy did not pin source ETag")
			}
			copied = true
			copyCalls++
			body = `<CopyObjectResult><ETag>"copy-etag"</ETag><LastModified>2026-10-27T00:00:00Z</LastModified></CopyObjectResult>`
			headers.Set("Content-Type", "application/xml")
			length = int64(len(body))
		default:
			return nil, fmt.Errorf("unexpected copy provider operation %s", r.Method)
		}
		return &http.Response{StatusCode: status, Header: headers, Body: io.NopCloser(strings.NewReader(body)), ContentLength: length, Request: r}, nil
	})
	job, err := a.claimAcademyCopy(ctx)
	if err != nil || job == nil {
		t.Fatal("copy job not claimable", err)
	}
	if err = a.copyAcademyRecording(ctx, job); err != nil {
		t.Fatal(err)
	}
	listed = request("GET", "/api/academy/courses/copy-course/lessons", "", student)
	must(listed, 200)
	if !strings.Contains(listed.Body.String(), "Ghi chú tiếng Việt") || !strings.Contains(listed.Body.String(), copyID) {
		t.Fatal("verified copy or notes not visible")
	}
	// Process crash after the provider commits: resume the destination even if the original expires.
	exec("UPDATE academy_lessons SET status='draft',size_bytes=0 WHERE id=?", copyID)
	exec("UPDATE academy_lesson_details SET import_state='copying',lease_until=UTC_TIMESTAMP()-INTERVAL 1 MINUTE WHERE lesson_id=?", copyID)
	exec("UPDATE recordings SET expires_at=UTC_TIMESTAMP()-INTERVAL 1 DAY WHERE id='copy-recording'")
	job, err = a.claimAcademyCopy(ctx)
	if err != nil || job == nil {
		t.Fatal("interrupted copy not reclaimed", err)
	}
	if err = a.copyAcademyRecording(ctx, job); err != nil {
		t.Fatal(err)
	}
	if copyCalls != 1 {
		t.Fatal("verified destination copied twice")
	}
	var rev int
	_ = db.QueryRow("SELECT revision FROM academy_lesson_details WHERE lesson_id=?", copyID).Scan(&rev)
	editBody := fmt.Sprintf(`{"title":"Bài đã sửa","chapter":"Chương 2","notes":"Ghi chú mới","published":true,"revision":%d}`, rev)
	must(request("POST", "/api/academy/lessons/"+copyID+"/edit", editBody, other), 404)
	must(request("POST", "/api/academy/lessons/"+copyID+"/edit", editBody, limited), 200)
	must(request("POST", "/api/academy/lessons/"+copyID+"/edit", editBody, limited), 409)
	exec("INSERT INTO academy_lessons(id,school_id,course_id,title,object_key,bucket,status,size_bytes,position) VALUES('copy-manual','academy-school','copy-course','Bài sau','academy/vod/test/manual.webm','test-bucket','ready',100,2)")
	orderBody := fmt.Sprintf(`{"ids":["copy-manual","%s"],"expected":["%s","copy-manual"]}`, copyID, copyID)
	must(request("POST", "/api/academy/courses/copy-course/lesson-order", orderBody, limited), 200)
	must(request("POST", "/api/academy/courses/copy-course/lesson-order", orderBody, limited), 409)
	must(request("POST", "/api/academy/courses/copy-course/lesson-order", `{"ids":["copy-manual","copy-manual"],"expected":["copy-manual","`+copyID+`"]}`, limited), 400)
	bad := request("POST", "/api/academy/webhooks/payos", `{"success":true,"data":{"amount":1000},"signature":"00"}`, nil)
	must(bad, 403)
}
