package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"fmt"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"golang.org/x/crypto/bcrypt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"net/http"
	"net/mail"
	"os"
	"strings"
	"time"
)

// Reverse proxies share a backend peer address; rate-limit the email and tenant instead.
func (a *app) verificationRate(r *http.Request, school, email string) bool {
	n, e := a.cache.Eval(r.Context(), `local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],900) end;local g=redis.call('INCR',KEYS[2]);if g==1 then redis.call('EXPIRE',KEYS[2],900) end;if g>1000 then return -1 end;return n`, []string{"academy-registration-email:" + digest(school+":"+normalizeEmail(email)), "academy-registration-tenant:" + digest(school)}).Int()
	return e == nil && n > 0 && n <= 8
}
func verificationToken() (string, string, error) {
	token := uid() + uid()
	encrypted, e := encryptOTP(token)
	return token, encrypted, e
}
func (a *app) academyRegister(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email, Password string
		Avatar          string `json:"avatar_data"`
		Profile         studentProfile
	}
	if !decode(w, r, &in) {
		return
	}
	in.Email = normalizeEmail(in.Email)
	fields := map[string]string{}
	addr, e := mail.ParseAddress(in.Email)
	if e != nil || addr.Address != in.Email || len(in.Email) > 190 {
		fields["email"] = "Email không hợp lệ"
	}
	if !validAccountPassword("student", in.Password) {
		fields["password"] = "Mật khẩu tối thiểu 6 ký tự và tối đa 72 byte"
	}
	p := &in.Profile
	p.Name = strings.TrimSpace(p.Name)
	p.Address = strings.TrimSpace(p.Address)
	p.School = strings.TrimSpace(p.School)
	p.Phone = strings.TrimSpace(p.Phone)
	p.Parent = strings.TrimSpace(p.Parent)
	if !validStudentProfile(*p) {
		fields["profile"] = "Điền đủ họ tên, ngày sinh hợp lệ, địa chỉ, trường học và hai số điện thoại 9–15 chữ số"
	}
	photo, e := base64.StdEncoding.DecodeString(in.Avatar)
	mime := http.DetectContentType(photo)
	if e != nil || len(photo) < 1 || len(photo) > 256<<10 || (mime != "image/png" && mime != "image/jpeg") {
		fields["avatar_data"] = "Chọn ảnh đại diện PNG/JPEG hợp lệ"
	} else {
		im, _, err := image.DecodeConfig(bytes.NewReader(photo))
		if err != nil || im.Width > 512 || im.Height > 512 {
			fields["avatar_data"] = "Ảnh đại diện tối đa 512 × 512"
		} else if _, _, err = image.Decode(bytes.NewReader(photo)); err != nil {
			fields["avatar_data"] = "Ảnh đại diện không đọc được"
		}
	}
	if len(fields) > 0 {
		send(w, 400, map[string]any{"error": "Hồ sơ chưa đầy đủ hoặc không hợp lệ", "fields": fields})
		return
	}
	school, e := a.publicSchool(r)
	if e != nil {
		problem(w, 404, "Chưa có trung tâm")
		return
	}
	if !a.verificationRate(r, school, in.Email) {
		problem(w, 429, "Đăng ký quá nhiều lần; thử lại sau 15 phút")
		return
	}
	token, encrypted, e := verificationToken()
	if e != nil {
		problem(w, 503, "Chưa tạo được liên kết xác thực")
		return
	}
	hash, e := bcrypt.GenerateFromPassword([]byte(in.Password), 12)
	if e != nil {
		problem(w, 400, "Mật khẩu không hợp lệ")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Chưa tạo được tài khoản")
		return
	}
	defer tx.Rollback()
	id := uid()
	code, e := shortCode(tx, "SV", id)
	if e == nil {
		_, e = tx.ExecContext(r.Context(), "INSERT INTO users(id,school_id,email,name,password_hash,role,short_id) VALUES(?,?,?,?,?,'student',?)", id, school, in.Email, p.Name, string(hash), code)
	}
	if e == nil {
		_, e = tx.ExecContext(r.Context(), "INSERT INTO academy_profiles(school_id,user_id,dob,address,school_name,phone,parent_phone,marketing_consent,email_verified) VALUES(?,?,?,?,?,?,?,?,FALSE)", school, id, p.DOB, p.Address, p.School, p.Phone, p.Parent, p.Marketing)
	}
	if e == nil {
		_, e = tx.ExecContext(r.Context(), "INSERT INTO academy_registration_avatars(school_id,user_id,media_type,image_data) VALUES(?,?,?,?)", school, id, mime, photo)
	}
	if e == nil {
		_, e = tx.ExecContext(r.Context(), "INSERT INTO academy_email_links(token_hash,school_id,user_id,email,token_encrypted,expires_at) VALUES(?,?,?,?,?,UTC_TIMESTAMP()+INTERVAL 1 DAY)", digest(token), school, id, in.Email, encrypted)
	}
	if e != nil || tx.Commit() != nil {
		problem(w, 409, "Chưa tạo được tài khoản; email có thể đã tồn tại")
		return
	}
	send(w, 201, map[string]any{"id": id, "verification_email_queued": true, "message": "Tài khoản đã tạo. Liên kết xác thực sẽ được gửi qua email; chỉ cần bấm liên kết, không nhập mã."})
}
func (a *app) academyVerifyEmailLink(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	var in struct{ Token string }
	if !decode(w, r, &in) {
		return
	}
	if len(in.Token) != 64 {
		problem(w, 400, "Liên kết xác thực không hợp lệ")
		return
	}
	school, e := a.publicSchool(r)
	if e != nil {
		problem(w, 404, "Chưa có trung tâm")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Chưa xác thực được email")
		return
	}
	defer tx.Rollback()
	var user, email string
	var verified sql.NullTime
	var valid bool
	if tx.QueryRowContext(r.Context(), "SELECT user_id,email,verified_at,expires_at>UTC_TIMESTAMP(6) FROM academy_email_links WHERE token_hash=? AND school_id=? FOR UPDATE", digest(in.Token), school).Scan(&user, &email, &verified, &valid) != nil || !valid {
		problem(w, 400, "Liên kết sai hoặc đã hết hạn")
		return
	}
	var current string
	var active bool
	if tx.QueryRowContext(r.Context(), "SELECT email,active FROM users WHERE school_id=? AND id=? FOR UPDATE", school, user).Scan(&current, &active) != nil || current != email || !active {
		problem(w, 400, "Liên kết không còn hợp lệ")
		return
	}
	if !verified.Valid {
		res, err := tx.ExecContext(r.Context(), "UPDATE academy_profiles SET email_verified=TRUE WHERE school_id=? AND user_id=?", school, user)
		if err != nil {
			problem(w, 503, "Chưa xác thực được email")
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			var n int
			if tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM academy_profiles WHERE school_id=? AND user_id=?", school, user).Scan(&n) != nil || n != 1 {
				problem(w, 409, "Hồ sơ không còn tồn tại")
				return
			}
		}
		if _, e = tx.ExecContext(r.Context(), "UPDATE academy_email_links SET verified_at=UTC_TIMESTAMP(6),token_encrypted='' WHERE token_hash=?", digest(in.Token)); e != nil {
			problem(w, 503, "Chưa lưu được xác thực")
			return
		}
	}
	if tx.Commit() != nil {
		problem(w, 503, "Chưa lưu được xác thực")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}
func (a *app) academyResendVerification(w http.ResponseWriter, r *http.Request) {
	var in struct{ Email string }
	if !decode(w, r, &in) {
		return
	}
	school, e := a.publicSchool(r)
	if e != nil {
		problem(w, 404, "Chưa có trung tâm")
		return
	}
	if !a.verificationRate(r, school, in.Email) {
		problem(w, 429, "Thử lại sau 15 phút")
		return
	}
	email := normalizeEmail(in.Email)
	var id string
	if a.db.QueryRowContext(r.Context(), "SELECT u.id FROM users u JOIN academy_profiles p ON p.school_id=u.school_id AND p.user_id=u.id WHERE u.school_id=? AND u.email=? AND u.active=TRUE AND p.email_verified=FALSE", school, email).Scan(&id) == nil {
		var recent int
		if a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM academy_email_links WHERE school_id=? AND user_id=? AND expires_at>UTC_TIMESTAMP()+INTERVAL 23 HOUR", school, id).Scan(&recent) != nil {
			problem(w, 503, "Chưa kiểm tra được email")
			return
		}
		if recent == 0 {
			token, encrypted, err := verificationToken()
			if err != nil {
				problem(w, 503, "Chưa tạo được liên kết")
				return
			}
			if _, err = a.db.ExecContext(r.Context(), "INSERT INTO academy_email_links(token_hash,school_id,user_id,email,token_encrypted,expires_at) VALUES(?,?,?,?,?,UTC_TIMESTAMP()+INTERVAL 1 DAY)", digest(token), school, id, email, encrypted); err != nil {
				problem(w, 503, "Chưa gửi được yêu cầu")
				return
			}
		}
	}
	send(w, 200, map[string]string{"message": "Nếu tài khoản đang chờ xác thực, hệ thống sẽ gửi liên kết qua email. Vui lòng kiểm tra cả thư rác."})
}
func (a *app) sendNextVerification(ctx context.Context) error {
	tx, e := a.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var hash, email, encrypted, school, name string
	e = tx.QueryRowContext(ctx, "SELECT l.token_hash,l.email,l.token_encrypted,l.school_id,u.name FROM academy_email_links l JOIN users u ON u.school_id=l.school_id AND u.id=l.user_id JOIN academy_profiles p ON p.school_id=l.school_id AND p.user_id=l.user_id WHERE l.sent_at IS NULL AND l.verified_at IS NULL AND l.expires_at>UTC_TIMESTAMP(6) AND l.next_attempt<=UTC_TIMESTAMP(6) AND u.active=TRUE AND u.email=l.email AND p.email_verified=FALSE ORDER BY l.next_attempt LIMIT 1 FOR UPDATE SKIP LOCKED").Scan(&hash, &email, &encrypted, &school, &name)
	if e == sql.ErrNoRows {
		return nil
	}
	if e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, "UPDATE academy_email_links SET next_attempt=UTC_TIMESTAMP()+INTERVAL 5 MINUTE,attempts=attempts+1 WHERE token_hash=?", hash); e != nil {
		return e
	}
	if e = tx.Commit(); e != nil {
		return e
	}
	token, e := decryptOTP(encrypted)
	if e != nil {
		return e
	}
	sender := a.mailer
	if sender == nil {
		sender = sendAcademyMail
	}
	t, err := a.academyTemplate(ctx, school, "verification")
	if err != nil {
		return err
	}
	values := map[string]string{"name": name, "email": email, "site_url": a.origin, "verification_link": strings.TrimRight(a.origin, "/") + "/dang-nhap#xac-thuc-email=" + token}
	if e = sender(email, renderAcademyMail(t.Subject, values), renderAcademyMail(t.Body, values)); e != nil {
		_, _ = a.db.ExecContext(ctx, "UPDATE academy_email_links SET error_code='SMTP_UNAVAILABLE' WHERE token_hash=?", hash)
		return e
	}
	_, e = a.db.ExecContext(ctx, "UPDATE academy_email_links SET sent_at=UTC_TIMESTAMP(6),token_encrypted='',error_code='' WHERE token_hash=?", hash)
	return e
}
func (a *app) academyVerificationMailLoop(ctx context.Context) {
	timer := time.NewTicker(10 * time.Second)
	defer timer.Stop()
	for {
		if _, err := os.Stat(configPath("maintenance")); os.IsNotExist(err) && academyEnabled() {
			jobCtx, cancel := context.WithTimeout(ctx, 40*time.Second)
			_ = a.sendNextVerification(jobCtx)
			_ = a.cleanupDeletedAvatar(jobCtx)
			_, _ = a.db.ExecContext(jobCtx, "DELETE FROM academy_email_links WHERE expires_at<UTC_TIMESTAMP()-INTERVAL 7 DAY")
			cancel()
		}
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
	}
}
func (a *app) academyRegistrationAvatar(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	var key string
	_ = a.db.QueryRowContext(r.Context(), "SELECT avatar_key FROM academy_profiles WHERE school_id=? AND user_id=?", u.School, u.ID).Scan(&key)
	if key != "" {
		if !strings.HasPrefix(key, "academy/avatars/"+u.School+"/"+u.ID+"/") || strings.Contains(key, "..") {
			http.NotFound(w, r)
			return
		}
		store, ok := r2ready(w)
		if !ok {
			return
		}
		url, e := s3.NewPresignClient(a.s3Client(store)).PresignGetObject(r.Context(), &s3.GetObjectInput{Bucket: &store.Bucket, Key: &key}, s3.WithPresignExpires(2*time.Minute))
		if e != nil {
			problem(w, 503, "Chưa tải được ảnh đại diện")
			return
		}
		w.Header().Set("Cache-Control", "private, no-store")
		http.Redirect(w, r, url.URL, http.StatusTemporaryRedirect)
		return
	}
	var media string
	var photo []byte
	if a.db.QueryRowContext(r.Context(), "SELECT media_type,image_data FROM academy_registration_avatars WHERE school_id=? AND user_id=?", u.School, u.ID).Scan(&media, &photo) != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Type", media)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Length", fmt.Sprint(len(photo)))
	_, _ = w.Write(photo)
}

func (a *app) academyMailStatus(w http.ResponseWriter, r *http.Request) {
	if !a.businessAdmin(w, r, "finance") {
		return
	}
	u := who(r)
	if r.Method == "POST" {
		if _, e := a.db.ExecContext(r.Context(), "UPDATE academy_email_links SET next_attempt=UTC_TIMESTAMP(6) WHERE school_id=? AND sent_at IS NULL AND verified_at IS NULL AND expires_at>UTC_TIMESTAMP(6)", u.School); e != nil {
			problem(w, 503, "Chưa gửi lại được email đang chờ")
			return
		}
		a.audit(r, "academy.email.retry", u.School)
		send(w, 200, map[string]bool{"ok": true})
		return
	}
	cfg, e := loadSettings()
	if e != nil {
		problem(w, 503, "Chưa đọc được cấu hình email")
		return
	}
	var pending, failed int
	if a.db.QueryRowContext(r.Context(), "SELECT COALESCE(SUM(sent_at IS NULL AND verified_at IS NULL AND expires_at>UTC_TIMESTAMP()),0),COALESCE(SUM(sent_at IS NULL AND verified_at IS NULL AND expires_at>UTC_TIMESTAMP() AND error_code<>''),0) FROM academy_email_links WHERE school_id=?", u.School).Scan(&pending, &failed) != nil {
		problem(w, 503, "Chưa đọc được hàng đợi email")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	send(w, 200, map[string]any{"smtp_configured": academySMTPConfigured(cfg.Commerce), "pending": pending, "failed": failed})
}
