package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func exerciseAcademyManagement(t *testing.T, a *app, db *sql.DB, request func(string, string, string, *http.Cookie) *httptest.ResponseRecorder, cookie func(string, string, string) *http.Cookie, admin, student, limited, other *http.Cookie) {
	t.Helper()
	ctx := context.Background()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, e := db.Exec(q, args...); e != nil {
			t.Fatal(e)
		}
	}
	must := func(r *httptest.ResponseRecorder, want int) {
		t.Helper()
		if r.Code != want {
			t.Fatalf("want %d got %d: %s", want, r.Code, r.Body.String())
		}
	}
	must(request("POST", "/api/academy/admin/ui-texts", `{"texts":{},"revision":0}`, student), 403)
	textBody := `{"texts":{"Danh sách bài giảng":"Bài học <script>không thực thi</script>"},"revision":0}`
	must(request("POST", "/api/academy/admin/ui-texts", textBody, limited), 200)
	must(request("POST", "/api/academy/admin/ui-texts", textBody, limited), 409)
	html := request("GET", "/khoa-hoc/copy-course", "", nil)
	must(html, 200)
	if strings.Contains(html.Body.String(), "<script>") || !strings.Contains(html.Body.String(), "Bài học &lt;script&gt;không thực thi&lt;/script&gt;") {
		t.Fatal("UI text missing or unescaped")
	}
	var publicText map[string]any
	r := request("GET", "/api/academy/ui-texts", "", nil)
	must(r, 200)
	_ = json.Unmarshal(r.Body.Bytes(), &publicText)
	if publicText["texts"] == nil {
		t.Fatal("missing public dictionary")
	}
	must(request("POST", "/api/academy/admin/ui-texts", `{"texts":{"NOT-A-UI-KEY":"bad"},"revision":1}`, admin), 400)
	must(request("POST", "/api/academy/admin/ui-texts", `{"texts":{},"revision":1}`, admin), 200)
	// Existing orders retain price/rights after the plan is edited, suspended and removed.
	must(request("POST", "/api/academy/plans", `{"id":"ac-plan","name":"VIP đã sửa","price_vnd":200000,"days":60,"live_enabled":false,"active":false,"revision":0}`, admin), 200)
	must(request("POST", "/api/academy/plans", `{"id":"ac-plan","name":"Sai","price_vnd":300000,"days":30,"active":true,"revision":0}`, admin), 409)
	must(request("POST", "/api/academy/plans", `{"id":"ac-plan","name":"Sai","price_vnd":300000,"days":30,"active":true}`, other), 404)
	plans := request("GET", "/api/academy/plans", "", nil)
	if strings.Contains(plans.Body.String(), "ac-plan") {
		t.Fatal("suspended plan remained for sale")
	}
	var orders int
	_ = db.QueryRow("SELECT COUNT(*) FROM academy_orders WHERE plan_id='ac-plan'").Scan(&orders)
	if orders < 1 {
		t.Fatal("missing historical order fixture")
	}
	must(request("POST", "/api/academy/plans/ac-plan/delete", `{"confirm":"VIP đã sửa","revision":1}`, limited), 403)
	must(request("POST", "/api/academy/plans/ac-plan/delete", `{"confirm":"Sai tên","revision":1}`, admin), 409)
	must(request("POST", "/api/academy/plans/ac-plan/delete", `{"confirm":"VIP đã sửa","revision":1}`, admin), 200)
	var preserved int
	_ = db.QueryRow("SELECT COUNT(*) FROM academy_orders WHERE plan_id='ac-plan'").Scan(&preserved)
	if preserved != orders {
		t.Fatal("plan removal lost order history")
	}
	if strings.Contains(request("GET", "/api/academy/admin/plans", "", admin).Body.String(), "ac-plan") {
		t.Fatal("deleted plan still in admin list")
	}
	// Registration is atomic and does not require an email code. Mail is durable/retryable.
	must(request("POST", "/api/academy/register", `{"email":"new@example.test","password":"secret6","profile":{}}`, nil), 400)
	var photo bytes.Buffer
	_ = png.Encode(&photo, image.NewRGBA(image.Rect(0, 0, 2, 2)))
	avatar := base64.StdEncoding.EncodeToString(photo.Bytes())
	reg := map[string]any{"email": "new@example.test", "password": "secret6", "avatar_data": avatar, "profile": map[string]any{"name": "Học viên mới", "dob": "2010-01-01", "address": "Hà Nội", "school_name": "Trường thử", "phone": "0901234567", "parent_phone": "0912345678"}}
	raw, _ := json.Marshal(reg)
	registered := request("POST", "/api/academy/register", string(raw), nil)
	must(registered, 201)
	var result map[string]any
	_ = json.Unmarshal(registered.Body.Bytes(), &result)
	id := result["id"].(string)
	var verified bool
	if e := db.QueryRow("SELECT email_verified FROM academy_profiles WHERE user_id=?", id).Scan(&verified); e != nil || verified {
		t.Fatal("registration incorrectly required/marked verification", e)
	}
	must(request("POST", "/api/login", `{"email":"new@example.test","password":"secret6"}`, nil), 200)
	avatarResponse := request("GET", "/api/academy/profile/avatar", "", cookie(id, "academy-school", "student"))
	must(avatarResponse, 200)
	if !bytes.Equal(avatarResponse.Body.Bytes(), photo.Bytes()) {
		t.Fatal("avatar not stored safely")
	}
	a.mailer = func(string, string, string) error { return errors.New("temporary SMTP outage") }
	if a.sendNextVerification(ctx) == nil {
		t.Fatal("SMTP error not retained")
	}
	exec("UPDATE academy_email_links SET next_attempt=UTC_TIMESTAMP() WHERE user_id=?", id)
	var mailBody string
	a.mailer = func(to, subject, body string) error {
		if to != "new@example.test" {
			t.Fatal("wrong recipient")
		}
		mailBody = body
		return nil
	}
	if e := a.sendNextVerification(ctx); e != nil {
		t.Fatal(e)
	}
	if !strings.Contains(mailBody, "/dang-nhap#xac-thuc-email=") {
		t.Fatal("mail did not contain a one-click fragment link")
	}
	token := strings.Split(strings.Split(mailBody, "#xac-thuc-email=")[1], "\n")[0]
	verify, _ := json.Marshal(map[string]string{"token": token})
	must(request("POST", "/api/academy/verify-email-link", string(verify), nil), 200)
	must(request("POST", "/api/academy/verify-email-link", string(verify), nil), 200)
	_ = db.QueryRow("SELECT email_verified FROM academy_profiles WHERE user_id=?", id).Scan(&verified)
	if !verified {
		t.Fatal("one-click verification failed")
	}
	var ciphertext string
	_ = db.QueryRow("SELECT token_encrypted FROM academy_email_links WHERE user_id=?", id).Scan(&ciphertext)
	if ciphertext != "" {
		t.Fatal("sent token plaintext/ciphertext retained")
	}
	exec("UPDATE academy_email_links SET expires_at=UTC_TIMESTAMP()-INTERVAL 1 SECOND WHERE user_id=?", id)
	must(request("POST", "/api/academy/verify-email-link", string(verify), nil), 400)
	// Account deletion revokes sessions, removes personal profile, and hides the tombstone.
	must(request("POST", "/api/accounts/ac-admin/delete", `{"confirm":"ac-admin@example.test","revision":0}`, admin), 409)
	exec("INSERT INTO users(id,school_id,name,email,password_hash,role) VALUES('ac-protected','academy-school','Root','protected@example.test','hash','admin')")
	must(request("POST", "/api/accounts/ac-protected/delete", `{"confirm":"protected@example.test","revision":0}`, admin), 403)
	must(request("POST", "/api/accounts/"+id+"/delete", `{"confirm":"new@example.test","revision":0}`, other), 404)
	must(request("POST", "/api/accounts/"+id+"/delete", `{"confirm":"wrong@example.test","revision":0}`, admin), 409)
	oldSession := cookie(id, "academy-school", "student")
	must(request("POST", "/api/accounts/"+id+"/delete", `{"confirm":"new@example.test","revision":0}`, admin), 200)
	must(request("GET", "/api/me", "", oldSession), 401)
	accounts := request("GET", "/api/accounts", "", admin)
	if strings.Contains(accounts.Body.String(), id) || strings.Contains(accounts.Body.String(), "new@example.test") {
		t.Fatal("deleted account visible")
	}
	var count int
	_ = db.QueryRow("SELECT COUNT(*) FROM academy_profiles WHERE user_id=?", id).Scan(&count)
	if count != 0 {
		t.Fatal("personal profile retained")
	}
	must(request("POST", "/api/accounts", `{"id":"`+id+`","state":"active","permissions":[],"revision":1}`, admin), 404)
}
