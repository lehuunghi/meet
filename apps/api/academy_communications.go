package main

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

type academyMailTemplate struct {
	Kind     string `json:"kind"`
	Subject  string `json:"subject"`
	Body     string `json:"body"`
	Revision int    `json:"revision"`
}

var defaultAcademyTemplates = map[string]academyMailTemplate{
	"verification": {Kind: "verification", Subject: "Xác thực email tài khoản học tập", Body: "Chào {{name}},\n\nTài khoản đã được tạo. Bấm liên kết sau để xác thực email (hiệu lực 24 giờ):\n\n{{verification_link}}\n\nKhông cần nhập mã. Nếu không đăng ký, vui lòng bỏ qua thư này."},
	"notification": {Kind: "notification", Subject: "{{title}}", Body: "Chào {{name}},\n\n{{content}}\n\nXem thông báo: {{notification_link}}"},
}
var mailVariable = regexp.MustCompile(`\{\{[^{}]+\}\}`)

func validAcademyTemplate(t academyMailTemplate) bool {
	if strings.TrimSpace(t.Subject) == "" || len(t.Subject) > 200 || strings.ContainsAny(t.Subject, "\r\n") || strings.TrimSpace(t.Body) == "" || len(t.Body) > 20000 {
		return false
	}
	allowed := map[string]bool{"{{name}}": true, "{{email}}": true, "{{site_url}}": true}
	if t.Kind == "verification" {
		allowed["{{verification_link}}"] = true
		if !strings.Contains(t.Body, "{{verification_link}}") {
			return false
		}
	} else if t.Kind == "notification" {
		allowed["{{title}}"] = true
		allowed["{{content}}"] = true
		allowed["{{notification_link}}"] = true
	} else if t.Kind != "manual" {
		return false
	}
	for _, s := range mailVariable.FindAllString(t.Subject+"\n"+t.Body, -1) {
		if !allowed[s] {
			return false
		}
	}
	return true
}
func renderAcademyMail(text string, values map[string]string) string {
	return mailVariable.ReplaceAllStringFunc(text, func(key string) string {
		if value, ok := values[strings.TrimSuffix(strings.TrimPrefix(key, "{{"), "}}")]; ok {
			return value
		}
		return key
	})
}
func (a *app) academyTemplate(ctx context.Context, school, kind string) (academyMailTemplate, error) {
	t, ok := defaultAcademyTemplates[kind]
	if !ok {
		return t, errors.New("unknown template")
	}
	e := a.db.QueryRowContext(ctx, "SELECT subject,body,revision FROM academy_mail_templates WHERE school_id=? AND kind=?", school, kind).Scan(&t.Subject, &t.Body, &t.Revision)
	if e == sql.ErrNoRows {
		return t, nil
	}
	return t, e
}
func (a *app) academyTemplates(w http.ResponseWriter, r *http.Request) {
	if !a.businessAdmin(w, r, "communications") {
		return
	}
	u := who(r)
	if r.Method == "GET" {
		out := []academyMailTemplate{}
		for _, kind := range []string{"verification", "notification"} {
			t, e := a.academyTemplate(r.Context(), u.School, kind)
			if e != nil {
				problem(w, 503, "Chưa tải được mẫu email")
				return
			}
			out = append(out, t)
		}
		send(w, 200, out)
		return
	}
	var in academyMailTemplate
	if !decode(w, r, &in) {
		return
	}
	if _, ok := defaultAcademyTemplates[in.Kind]; !ok || !validAcademyTemplate(in) {
		problem(w, 400, "Mẫu email không hợp lệ; mẫu xác thực phải giữ {{verification_link}}")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Chưa lưu được email")
		return
	}
	defer tx.Rollback()
	var lock string
	if err := tx.QueryRowContext(r.Context(), "SELECT id FROM schools WHERE id=? FOR UPDATE", u.School).Scan(&lock); err != nil {
		problem(w, 503, "Chưa khóa được yêu cầu. Vui lòng thử lại")
		return
	}
	var revision int
	e = tx.QueryRowContext(r.Context(), "SELECT revision FROM academy_mail_templates WHERE school_id=? AND kind=? FOR UPDATE", u.School, in.Kind).Scan(&revision)
	if e != nil && e != sql.ErrNoRows {
		problem(w, 503, "Chưa tải được mẫu email")
		return
	}
	if in.Revision != revision {
		problem(w, 409, "Mẫu email đã thay đổi. Tải lại trước khi lưu")
		return
	}
	if _, e = tx.ExecContext(r.Context(), "INSERT INTO academy_mail_templates(school_id,kind,subject,body,revision) VALUES(?,?,?,?,1) ON DUPLICATE KEY UPDATE subject=VALUES(subject),body=VALUES(body),revision=revision+1", u.School, in.Kind, in.Subject, in.Body); e != nil || tx.Commit() != nil {
		problem(w, 503, "Chưa lưu được mẫu email")
		return
	}
	a.audit(r, "academy.email.template", in.Kind)
	send(w, 200, map[string]int{"revision": revision + 1})
}

var campaignRequest = regexp.MustCompile(`^[a-f0-9-]{32,36}$`)

// Each campaign snapshots content and recipients; retrying the same request never duplicates jobs.
func queueAcademyCampaign(ctx context.Context, tx *sql.Tx, school, actor, request, broadcast, subject, body, audience, userID, hash string) (string, int, error) {
	var id, previous string
	err := tx.QueryRowContext(ctx, "SELECT id,payload_hash FROM academy_mail_campaigns WHERE school_id=? AND request_id=?", school, request).Scan(&id, &previous)
	if err == nil {
		if previous != hash {
			return "", 0, errors.New("request mismatch")
		}
		var n int
		err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM academy_mail_jobs WHERE school_id=? AND campaign_id=?", school, id).Scan(&n)
		return id, n, err
	}
	if err != sql.ErrNoRows {
		return "", 0, err
	}
	id = uid()
	if _, err = tx.ExecContext(ctx, "INSERT INTO academy_mail_campaigns(id,school_id,request_id,broadcast_id,title,created_by,payload_hash) VALUES(?,?,?,NULLIF(?,''),?,?,?)", id, school, request, broadcast, subject, actor, hash); err != nil {
		return "", 0, err
	}
	filter := ""
	args := []any{school, id, subject, body, school}
	switch audience {
	case "all":
	case "student", "teacher", "admin":
		filter = " AND u.role=?"
		args = append(args, audience)
	case "self":
		filter = " AND u.id=?"
		args = append(args, actor)
	case "user":
		filter = " AND u.id=?"
		args = append(args, userID)
	default:
		return "", 0, errors.New("invalid audience")
	}
	res, err := tx.ExecContext(ctx, `INSERT INTO academy_mail_jobs(id,school_id,campaign_id,user_id,email,subject,body) SELECT REPLACE(UUID(),'-',''),?,?,u.id,u.email,LEFT(REPLACE(REPLACE(?,'{{name}}',u.name),'{{email}}',u.email),200),REPLACE(REPLACE(?,'{{name}}',u.name),'{{email}}',u.email) FROM users u WHERE u.school_id=? AND u.active=TRUE AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.school_id=u.school_id AND d.user_id=u.id)`+filter, args...)
	if err != nil {
		return "", 0, err
	}
	n, _ := res.RowsAffected()
	return id, int(n), nil
}
func (a *app) academyMailCampaigns(w http.ResponseWriter, r *http.Request) {
	if !a.businessAdmin(w, r, "communications") {
		return
	}
	u := who(r)
	if r.Method == "GET" {
		a.query(w, r, `SELECT c.id,c.title,c.created_at,COUNT(j.id) AS recipients,COALESCE(SUM(j.status='sent'),0) AS sent,COALESCE(SUM(j.status IN ('queued','sending')),0) AS pending,COALESCE(SUM(j.status='failed'),0) AS failed,COALESCE(SUM(j.status='cancelled'),0) AS cancelled FROM academy_mail_campaigns c LEFT JOIN academy_mail_jobs j ON j.school_id=c.school_id AND j.campaign_id=c.id WHERE c.school_id=? GROUP BY c.id ORDER BY c.created_at DESC LIMIT 100`, u.School)
		return
	}
	var in struct {
		Request  string `json:"request_id"`
		Subject  string `json:"subject"`
		Body     string `json:"body"`
		Audience string `json:"audience"`
		User     string `json:"user_id"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !campaignRequest.MatchString(in.Request) || !validAcademyTemplate(academyMailTemplate{Kind: "manual", Subject: in.Subject, Body: in.Body}) {
		problem(w, 400, "Nhập tiêu đề và nội dung email hợp lệ")
		return
	}
	cfg, e := loadSettings()
	if e != nil || cfg.Commerce.SMTPAddress == "" || cfg.Commerce.SMTPFrom == "" {
		problem(w, 409, "Cấu hình SMTP trước khi gửi email")
		return
	}
	in.Subject = renderAcademyMail(in.Subject, map[string]string{"site_url": a.origin})
	in.Body = renderAcademyMail(in.Body, map[string]string{"site_url": a.origin})
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Chưa tạo được hàng đợi email")
		return
	}
	defer tx.Rollback()
	var lock string
	if err := tx.QueryRowContext(r.Context(), "SELECT id FROM schools WHERE id=? FOR UPDATE", u.School).Scan(&lock); err != nil {
		problem(w, 503, "Chưa khóa được yêu cầu. Vui lòng thử lại")
		return
	}
	id, n, e := queueAcademyCampaign(r.Context(), tx, u.School, u.ID, in.Request, "", in.Subject, in.Body, in.Audience, in.User, digest(in.Subject+"\x00"+in.Body+"\x00"+in.Audience+"\x00"+in.User))
	if e != nil {
		problem(w, 409, "Yêu cầu gửi không hợp lệ hoặc đã thay đổi")
		return
	}
	if n == 0 {
		problem(w, 400, "Không có tài khoản nhận phù hợp")
		return
	}
	if tx.Commit() != nil {
		problem(w, 503, "Chưa lưu được hàng đợi email")
		return
	}
	a.audit(r, "academy.email.queue", id)
	send(w, 201, map[string]any{"id": id, "recipients": n})
}
func (a *app) academyBroadcasts(w http.ResponseWriter, r *http.Request) {
	if !a.businessAdmin(w, r, "communications") {
		return
	}
	u := who(r)
	if r.Method == "GET" {
		a.query(w, r, "SELECT id,title,body,email_requested,created_at FROM academy_broadcasts WHERE school_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100", u.School)
		return
	}
	var in struct {
		Title   string `json:"title"`
		Body    string `json:"body"`
		Email   bool   `json:"email"`
		Request string `json:"request_id"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !campaignRequest.MatchString(in.Request) || strings.TrimSpace(in.Title) == "" || len(in.Title) > 200 || strings.ContainsAny(in.Title, "\r\n") || strings.TrimSpace(in.Body) == "" || len(in.Body) > 20000 {
		problem(w, 400, "Nhập tiêu đề và nội dung thông báo hợp lệ")
		return
	}
	if in.Email {
		cfg, e := loadSettings()
		if e != nil || cfg.Commerce.SMTPAddress == "" || cfg.Commerce.SMTPFrom == "" {
			problem(w, 409, "Bỏ chọn email hoặc cấu hình SMTP trước khi gửi")
			return
		}
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Chưa gửi được thông báo")
		return
	}
	defer tx.Rollback()
	var lock string
	if err := tx.QueryRowContext(r.Context(), "SELECT id FROM schools WHERE id=? FOR UPDATE", u.School).Scan(&lock); err != nil {
		problem(w, 503, "Chưa khóa được yêu cầu. Vui lòng thử lại")
		return
	}
	var id, title, body string
	var email bool
	var deleted sql.NullTime
	e = tx.QueryRowContext(r.Context(), "SELECT id,title,body,email_requested,deleted_at FROM academy_broadcasts WHERE school_id=? AND request_id=?", u.School, in.Request).Scan(&id, &title, &body, &email, &deleted)
	if e == nil {
		if title != in.Title || body != in.Body || email != in.Email || deleted.Valid {
			problem(w, 409, "Yêu cầu đã được dùng. Tạo thông báo mới")
			return
		}
		send(w, 200, map[string]string{"id": id})
		return
	}
	if e != sql.ErrNoRows {
		problem(w, 503, "Chưa kiểm tra được thông báo")
		return
	}
	id = uid()
	if _, e = tx.ExecContext(r.Context(), "INSERT INTO academy_broadcasts(id,school_id,title,body,created_by,email_requested,request_id) VALUES(?,?,?,?,?,?,?)", id, u.School, in.Title, in.Body, u.ID, in.Email, in.Request); e != nil {
		problem(w, 503, "Chưa lưu được thông báo")
		return
	}
	recipients := 0
	if in.Email {
		t, err := a.academyTemplate(r.Context(), u.School, "notification")
		if err != nil {
			problem(w, 503, "Chưa tải được mẫu email")
			return
		}
		values := map[string]string{"title": in.Title, "content": in.Body, "notification_link": strings.TrimRight(a.origin, "/") + "/hoc/thong-bao", "site_url": a.origin}
		_, recipients, e = queueAcademyCampaign(r.Context(), tx, u.School, u.ID, in.Request, id, renderAcademyMail(t.Subject, values), renderAcademyMail(t.Body, values), "all", "", digest(in.Title+"\x00"+in.Body))
		if e != nil {
			problem(w, 503, "Chưa tạo được hàng đợi email")
			return
		}
	}
	if tx.Commit() != nil {
		problem(w, 503, "Chưa lưu được thông báo")
		return
	}
	a.audit(r, "academy.broadcast.create", id)
	send(w, 201, map[string]any{"id": id, "email_recipients": recipients})
}
func (a *app) academyBroadcastDelete(w http.ResponseWriter, r *http.Request) {
	if !a.businessAdmin(w, r, "communications") {
		return
	}
	u := who(r)
	var in struct {
		Confirm string `json:"confirm"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Confirm != "XOA THONG BAO" {
		problem(w, 400, "Xác nhận xóa thông báo")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Chưa xóa được thông báo")
		return
	}
	defer tx.Rollback()
	id := r.PathValue("broadcast")
	res, e := tx.ExecContext(r.Context(), "UPDATE academy_broadcasts SET deleted_at=UTC_TIMESTAMP(6) WHERE school_id=? AND id=? AND deleted_at IS NULL", u.School, id)
	if e != nil {
		problem(w, 503, "Chưa xóa được thông báo")
		return
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		problem(w, 404, "Không thấy thông báo")
		return
	}
	_, e = tx.ExecContext(r.Context(), "UPDATE academy_mail_jobs j JOIN academy_mail_campaigns c ON c.school_id=j.school_id AND c.id=j.campaign_id SET j.status='cancelled',j.body='',j.subject='' WHERE c.school_id=? AND c.broadcast_id=? AND j.status IN ('queued','failed')", u.School, id)
	if e != nil || tx.Commit() != nil {
		problem(w, 503, "Chưa hoàn tất xóa")
		return
	}
	a.audit(r, "academy.broadcast.delete", id)
	send(w, 200, map[string]bool{"ok": true})
}
func (a *app) sendNextAcademyMail(ctx context.Context) error {
	tx, e := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var id, school, user, email, subject, body, campaign string
	var attempts int
	e = tx.QueryRowContext(ctx, `SELECT id,school_id,user_id,email,subject,body,campaign_id,attempts FROM academy_mail_jobs WHERE ((attempts<5 AND status IN ('queued','failed') AND next_attempt<=UTC_TIMESTAMP(6)) OR (status='sending' AND lease_until<UTC_TIMESTAMP(6))) ORDER BY next_attempt LIMIT 1 FOR UPDATE SKIP LOCKED`).Scan(&id, &school, &user, &email, &subject, &body, &campaign, &attempts)
	if e == sql.ErrNoRows {
		return nil
	}
	if e != nil {
		return e
	}
	if attempts >= 5 {
		if _, e = tx.ExecContext(ctx, "UPDATE academy_mail_jobs SET status='failed',error_code='DELIVERY_UNKNOWN',lease=NULL,lease_until=NULL WHERE id=?", id); e != nil {
			return e
		}
		return tx.Commit()
	}
	lease := uid()
	if _, e = tx.ExecContext(ctx, "UPDATE academy_mail_jobs SET status='sending',attempts=attempts+1,lease=?,lease_until=UTC_TIMESTAMP()+INTERVAL 2 MINUTE WHERE id=?", lease, id); e != nil {
		return e
	}
	if e = tx.Commit(); e != nil {
		return e
	}
	var allowed int
	e = a.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM academy_mail_campaigns c JOIN users u ON u.school_id=c.school_id AND u.id=? LEFT JOIN academy_broadcasts b ON b.school_id=c.school_id AND b.id=c.broadcast_id WHERE c.school_id=? AND c.id=? AND u.active=TRUE AND u.email=? AND (c.broadcast_id IS NULL OR (b.id IS NOT NULL AND b.deleted_at IS NULL)) AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.school_id=u.school_id AND d.user_id=u.id)`, user, school, campaign, email).Scan(&allowed)
	if e != nil {
		return e
	}
	if allowed != 1 {
		_, e = a.db.ExecContext(ctx, "UPDATE academy_mail_jobs SET status='cancelled',body='',subject='',lease=NULL,lease_until=NULL WHERE id=? AND lease=?", id, lease)
		return e
	}
	sender := a.mailer
	if sender == nil {
		sender = sendAcademyMail
	}
	e = sender(email, subject, body)
	if e != nil {
		_, err := a.db.ExecContext(ctx, "UPDATE academy_mail_jobs SET status='failed',error_code='SMTP_UNAVAILABLE',next_attempt=DATE_ADD(UTC_TIMESTAMP(),INTERVAL attempts*5 MINUTE),lease=NULL,lease_until=NULL WHERE id=? AND lease=?", id, lease)
		if err != nil {
			return err
		}
		return e
	}
	_, e = a.db.ExecContext(ctx, "UPDATE academy_mail_jobs SET status='sent',sent_at=UTC_TIMESTAMP(6),error_code='',lease=NULL,lease_until=NULL WHERE id=? AND lease=?", id, lease)
	return e
}
func (a *app) academyGeneralMailLoop(ctx context.Context) {
	timer := time.NewTicker(2 * time.Second)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			if !academyEnabled() || schoolSuspended() {
				continue
			}
			if func() bool { _, err := os.Stat(configPath("maintenance")); return os.IsNotExist(err) }() {
				job, cancel := context.WithTimeout(ctx, 35*time.Second)
				_ = a.sendNextAcademyMail(job)
				cancel()
			}
		}
	}
}

func (a *app) academyMailRetry(w http.ResponseWriter, r *http.Request) {
	if !a.businessAdmin(w, r, "communications") {
		return
	}
	u := who(r)
	res, e := a.db.ExecContext(r.Context(), `UPDATE academy_mail_jobs j JOIN academy_mail_campaigns c ON c.school_id=j.school_id AND c.id=j.campaign_id LEFT JOIN academy_broadcasts b ON b.school_id=c.school_id AND b.id=c.broadcast_id SET j.status='queued',j.attempts=0,j.next_attempt=UTC_TIMESTAMP(6),j.error_code='' WHERE c.school_id=? AND c.id=? AND j.status='failed' AND (c.broadcast_id IS NULL OR (b.id IS NOT NULL AND b.deleted_at IS NULL))`, u.School, r.PathValue("campaign"))
	if e != nil {
		problem(w, 503, "Chưa gửi lại được email")
		return
	}
	n, _ := res.RowsAffected()
	a.audit(r, "academy.email.retry", r.PathValue("campaign"))
	send(w, 200, map[string]int64{"queued": n})
}
