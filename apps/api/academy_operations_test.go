package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestMailTemplatesAndWireEncoding(t *testing.T) {
	for _, v := range defaultAcademyTemplates {
		if !validAcademyTemplate(v) {
			t.Fatal("invalid default", v.Kind)
		}
	}
	cases := []academyMailTemplate{{Kind: "verification", Subject: "Xác thực", Body: "missing link"}, {Kind: "notification", Subject: "Title\r\nBcc: test", Body: "content"}, {Kind: "manual", Subject: "Title", Body: "{{verification_link}}"}, {Kind: "notification", Subject: "Title", Body: "{{unknown}}"}}
	for _, v := range cases {
		if validAcademyTemplate(v) {
			t.Fatal("accepted unsafe or broken template")
		}
	}
	text := strings.Repeat("Tiếng Việt đầy đủ — Đặng Thị Ánh\n", 100)
	encoded := mimeAcademyBase64(text)
	for _, line := range strings.Split(encoded, "\r\n") {
		if len(line) > 76 {
			t.Fatal("SMTP line exceeds MIME limit")
		}
	}
	raw, e := base64.StdEncoding.DecodeString(strings.ReplaceAll(encoded, "\r\n", ""))
	if e != nil || string(raw) != text {
		t.Fatal("Vietnamese email corrupted")
	}
	if got := renderAcademyMail("{{content}} {{name}}", map[string]string{"content": "{{name}}", "name": "An"}); got != "{{name}} An" {
		t.Fatal("replacement was recursively expanded", got)
	}
}
func exerciseAcademyCommunications(t *testing.T, a *app, db *sql.DB, request func(string, string, string, *http.Cookie) *httptest.ResponseRecorder, teacher, admin, student, limited, other *http.Cookie) {
	t.Helper()
	ctx := context.Background()
	must := func(w *httptest.ResponseRecorder, code int) {
		t.Helper()
		if w.Code != code {
			t.Fatalf("communications want %d got %d: %s", code, w.Code, w.Body.String())
		}
	}
	exec := func(q string, args ...any) {
		t.Helper()
		if _, e := db.Exec(q, args...); e != nil {
			t.Fatal(e)
		}
	}
	count := func(q string, args ...any) int {
		t.Helper()
		var n int
		if e := db.QueryRow(q, args...).Scan(&n); e != nil {
			t.Fatal(e)
		}
		return n
	}
	cfg, e := loadSettings()
	if e != nil {
		t.Fatal(e)
	}
	original := cfg
	defer saveSettings(original)
	cfg.Commerce.SMTPAddress = "smtp.fixture:587"
	cfg.Commerce.SMTPFrom = "no-reply@example.test"
	if e = saveSettings(cfg); e != nil {
		t.Fatal(e)
	}
	for _, c := range []*http.Cookie{student, teacher, limited} {
		must(request("GET", "/api/academy/mail-templates", "", c), 403)
		must(request("POST", "/api/academy/broadcasts", `{}`, c), 403)
	}
	must(request("GET", "/api/academy/mail-templates", "", admin), 200)
	template := `{"kind":"verification","subject":"Xác thực cho {{name}}","body":"Bấm {{verification_link}}","revision":0}`
	must(request("POST", "/api/academy/mail-templates", template, admin), 200)
	must(request("POST", "/api/academy/mail-templates", template, admin), 409)
	must(request("POST", "/api/academy/mail-templates", `{"kind":"verification","subject":"Xác thực","body":"Không có liên kết","revision":1}`, admin), 400)
	body := fmt.Sprintf(`{"title":"Thông báo chung tiếng Việt","body":"Nội dung chung\nDòng tiếp theo","request_id":"%s","email":true}`, uid())
	posted := request("POST", "/api/academy/broadcasts", body, admin)
	must(posted, 201)
	var b struct {
		ID         string `json:"id"`
		Recipients int    `json:"email_recipients"`
	}
	if json.Unmarshal(posted.Body.Bytes(), &b) != nil || b.ID == "" {
		t.Fatal("no broadcast")
	}
	expected := count("SELECT COUNT(*) FROM users u WHERE school_id='academy-school' AND active=TRUE AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.school_id=u.school_id AND d.user_id=u.id)")
	if b.Recipients != expected {
		t.Fatal("missed recipients", b.Recipients, expected)
	}
	must(request("POST", "/api/academy/broadcasts", body, admin), 200)
	if count("SELECT COUNT(*) FROM academy_mail_jobs") != expected {
		t.Fatal("duplicate request duplicated emails")
	}
	for _, c := range []*http.Cookie{student, teacher, admin, limited} {
		feed := request("GET", "/api/academy/notifications", "", c)
		must(feed, 200)
		if !strings.Contains(feed.Body.String(), digest("broadcast:"+b.ID)) || !strings.Contains(feed.Body.String(), "Nội dung chung") {
			t.Fatal("account missed global notification")
		}
	}
	foreign := request("GET", "/api/academy/notifications", "", other)
	must(foreign, 200)
	if strings.Contains(foreign.Body.String(), b.ID) || strings.Contains(foreign.Body.String(), "Nội dung chung") {
		t.Fatal("broadcast crossed tenants")
	}
	must(request("POST", "/api/academy/broadcasts/"+b.ID+"/delete", `{"confirm":"XOA THONG BAO"}`, other), 404)
	must(request("POST", "/api/academy/broadcasts/"+b.ID+"/delete", `{"confirm":"wrong"}`, admin), 400)
	must(request("POST", "/api/academy/broadcasts/"+b.ID+"/delete", `{"confirm":"XOA THONG BAO"}`, admin), 200)
	for _, c := range []*http.Cookie{student, teacher, admin} {
		feed := request("GET", "/api/academy/notifications", "", c)
		must(feed, 200)
		if strings.Contains(feed.Body.String(), digest("broadcast:"+b.ID)) {
			t.Fatal("deleted notice remained")
		}
	}
	if count("SELECT COUNT(*) FROM academy_mail_jobs WHERE status='cancelled'") != expected {
		t.Fatal("unsent notification mail not cancelled")
	}
	oldMailer := a.mailer
	defer func() { a.mailer = oldMailer }()
	calls := 0
	var mu sync.Mutex
	a.mailer = func(to, subject, body string) error {
		mu.Lock()
		defer mu.Unlock()
		calls++
		if strings.Contains(subject, "{{") || strings.Contains(body, "{{name}}") {
			t.Error("unrendered personalization")
		}
		return nil
	}
	if e = a.sendNextAcademyMail(ctx); e != nil {
		t.Fatal(e)
	}
	if calls != 0 {
		t.Fatal("deleted broadcast sent email")
	}
	manual := fmt.Sprintf(`{"subject":"Chào {{name}}","body":"Nội dung tiếng Việt cho {{email}}","audience":"all","request_id":"%s"}`, uid())
	queued := request("POST", "/api/academy/mail-campaigns", manual, admin)
	must(queued, 201)
	var campaign struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(queued.Body.Bytes(), &campaign)
	must(request("POST", "/api/academy/mail-campaigns", manual, admin), 201)
	// An empty SKIP LOCKED claim is not evidence that the queue is drained.
	// Keep every eligible row locked to reproduce that case deterministically.
	locked, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		t.Fatal(err)
	}
	defer locked.Rollback()
	lockedRows, err := locked.QueryContext(ctx, "SELECT id FROM academy_mail_jobs WHERE campaign_id=? FOR UPDATE", campaign.ID)
	if err != nil {
		t.Fatal(err)
	}
	for lockedRows.Next() {
		var id string
		if err = lockedRows.Scan(&id); err != nil {
			t.Fatal(err)
		}
	}
	if err = lockedRows.Err(); err != nil {
		t.Fatal(err)
	}
	lockedRows.Close()
	if err = a.sendNextAcademyMail(ctx); err != nil {
		t.Fatal(err)
	}
	if calls != 0 || count("SELECT COUNT(*) FROM academy_mail_jobs WHERE campaign_id=? AND status='queued'", campaign.ID) != expected {
		t.Fatal("locked claim sent or lost mail")
	}
	if err = locked.Rollback(); err != nil {
		t.Fatal(err)
	}
	deliveryContext, cancelDelivery := context.WithTimeout(ctx, 15*time.Second)
	defer cancelDelivery()
	var wg sync.WaitGroup
	for worker := 0; worker < 4; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for deliveryContext.Err() == nil {
				if err := a.sendNextAcademyMail(deliveryContext); err != nil {
					t.Error(err)
					return
				}
				var remaining int
				if err := db.QueryRowContext(deliveryContext, "SELECT COUNT(*) FROM academy_mail_jobs WHERE campaign_id=? AND status<>'sent'", campaign.ID).Scan(&remaining); err != nil {
					t.Error(err)
					return
				}
				if remaining == 0 {
					return
				}
				select {
				case <-deliveryContext.Done():
					return
				case <-time.After(5 * time.Millisecond):
				}
			}
		}()
	}
	wg.Wait()
	if calls != expected || count("SELECT COUNT(*) FROM academy_mail_jobs WHERE campaign_id=? AND status='sent'", campaign.ID) != expected {
		t.Fatalf("mail delivery duplicated or incomplete: calls=%d expected=%d sent=%d queued=%d sending=%d cancelled=%d", calls, expected, count("SELECT COUNT(*) FROM academy_mail_jobs WHERE campaign_id=? AND status='sent'", campaign.ID), count("SELECT COUNT(*) FROM academy_mail_jobs WHERE campaign_id=? AND status='queued'", campaign.ID), count("SELECT COUNT(*) FROM academy_mail_jobs WHERE campaign_id=? AND status='sending'", campaign.ID), count("SELECT COUNT(*) FROM academy_mail_jobs WHERE campaign_id=? AND status='cancelled'", campaign.ID))
	}
	retryBody := fmt.Sprintf(`{"subject":"Thử lại","body":"Email cho tôi","audience":"self","request_id":"%s"}`, uid())
	retry := request("POST", "/api/academy/mail-campaigns", retryBody, admin)
	must(retry, 201)
	_ = json.Unmarshal(retry.Body.Bytes(), &campaign)
	a.mailer = func(string, string, string) error { return errors.New("fixture SMTP offline") }
	if a.sendNextAcademyMail(ctx) == nil {
		t.Fatal("SMTP failure lost")
	}
	if count("SELECT COUNT(*) FROM academy_mail_jobs WHERE campaign_id=? AND status='failed'", campaign.ID) != 1 {
		t.Fatal("failure not persisted")
	}
	must(request("POST", "/api/academy/mail-campaigns/"+campaign.ID+"/retry", `{}`, admin), 200)
	a.mailer = func(string, string, string) error { return nil }
	if e = a.sendNextAcademyMail(ctx); e != nil {
		t.Fatal(e)
	}
	// Real file decoding, tenant resolution and non-content role denial; no R2 required.
	upload := func(data []byte, c *http.Cookie) *httptest.ResponseRecorder {
		var buf bytes.Buffer
		writer := multipart.NewWriter(&buf)
		f, _ := writer.CreateFormFile("image", "photo.png")
		_, _ = f.Write(data)
		_ = writer.Close()
		r := httptest.NewRequest("POST", "/api/academy/site/images", &buf)
		r.Header.Set("Origin", a.origin)
		r.Header.Set("Content-Type", writer.FormDataContentType())
		if c != nil {
			r.AddCookie(c)
		}
		w := httptest.NewRecorder()
		a.routes().ServeHTTP(w, r)
		return w
	}
	var img bytes.Buffer
	_ = png.Encode(&img, image.NewNRGBA(image.Rect(0, 0, 8, 8)))
	must(upload(img.Bytes(), student), 403)
	must(upload([]byte(`<svg onload="alert(1)"></svg>`), admin), 400)
	photo := upload(img.Bytes(), admin)
	must(photo, 201)
	var asset map[string]string
	_ = json.Unmarshal(photo.Body.Bytes(), &asset)
	shown := request("GET", asset["url"], "", nil)
	must(shown, 200)
	if shown.Header().Get("Content-Type") != "image/png" {
		t.Fatal("image MIME invalid")
	}
	t.Setenv("LOGIN_SCHOOL", "other")
	must(request("GET", asset["url"], "", nil), 404)
	t.Setenv("LOGIN_SCHOOL", "academy")
	if !validWebsiteImage(asset["url"]) {
		t.Fatal("CMS rejected its uploaded image")
	}
	// A receipt creates a pending invoice exactly once and never grants VIP.
	exec("INSERT INTO academy_plans(id,school_id,name,price_vnd,days,live_enabled) VALUES('invoice-plan','academy-school','VIP giao dịch',100000,30,TRUE)")
	exec("INSERT INTO academy_orders(id,school_id,user_id,plan_id,price_vnd,days,live_enabled) VALUES('invoice-order','academy-school','ac-student','invoice-plan',100000,30,TRUE)")
	must(request("POST", "/api/academy/orders/invoice-order/confirm-transfer", `{"confirm":true}`, student), 409)
	must(request("POST", "/api/academy/orders/invoice-order/confirm-transfer", `{"confirm":true}`, other), 403)
	oldClient := a.client
	defer func() { a.client = oldClient }()
	a.client = &http.Client{Timeout: time.Second, Transport: testTransport(func(r *http.Request) (*http.Response, error) {
		if r.Method != "HEAD" || !strings.HasSuffix(r.URL.Hostname(), ".r2.cloudflarestorage.com") {
			t.Fatal("unexpected live provider request")
		}
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"image/png"}, "Content-Length": []string{"10"}}, ContentLength: 10, Body: io.NopCloser(strings.NewReader(""))}, nil
	})}
	key := "academy/receipts/academy-school/ac-student/" + uid()
	payload, _ := json.Marshal(map[string]string{"key": key})
	must(request("POST", "/api/academy/orders/invoice-order/receipt", string(payload), student), 200)
	members := count("SELECT COUNT(*) FROM academy_memberships")
	must(request("POST", "/api/academy/orders/invoice-order/confirm-transfer", `{"confirm":true}`, student), 201)
	must(request("POST", "/api/academy/orders/invoice-order/confirm-transfer", `{"confirm":true}`, student), 200)
	if count("SELECT COUNT(*) FROM academy_invoices WHERE order_id='invoice-order'") != 1 || count("SELECT COUNT(*) FROM academy_memberships") != members {
		t.Fatal("confirmation duplicated invoice or changed VIP")
	}
	detail := request("GET", "/api/academy/orders/invoice-order", "", student)
	must(detail, 200)
	if !strings.Contains(detail.Body.String(), `"invoice_number":"HD`) {
		t.Fatal("order missing invoice")
	}
	for _, c := range []*http.Cookie{student, admin} {
		w := request("GET", "/api/academy/orders/invoice-order/invoice", "", c)
		must(w, 200)
		if !strings.Contains(w.Body.String(), `"status":"pending"`) || strings.Contains(w.Body.String(), key) {
			t.Fatal("invoice state or private receipt leak")
		}
	}
	must(request("GET", "/api/academy/orders/invoice-order/invoice", "", other), 404)
	must(request("GET", "/api/academy/orders/invoice-order/invoice", "", teacher), 403)
	must(request("GET", "/api/academy/orders/invoice-order/invoice", "", limited), 403)
	must(request("POST", "/api/academy/orders/invoice-order/review", `{"action":"approve"}`, admin), 200)
	must(request("GET", "/api/academy/orders/invoice-order/invoice", "", student), 200)
}
