package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"golang.org/x/crypto/bcrypt"
	"math/big"
	"net"
	"net/http"
	"net/mail"
	"net/smtp"
	"regexp"
	"strings"
	"time"
)

type studentProfile struct {
	Name      string `json:"name"`
	DOB       string `json:"dob"`
	Address   string `json:"address"`
	School    string `json:"school_name"`
	Phone     string `json:"phone"`
	Parent    string `json:"parent_phone"`
	Avatar    string `json:"avatar_key"`
	Marketing bool   `json:"marketing_consent"`
}

func validStudentProfile(p studentProfile) bool {
	dob, e := time.Parse("2006-01-02", p.DOB)
	phone := regexp.MustCompile(`^\+?[0-9]{9,15}$`)
	return e == nil && dob.Before(time.Now()) && dob.After(time.Now().AddDate(-110, 0, 0)) && len(strings.TrimSpace(p.Name)) > 1 && len(p.Name) <= 200 && len(p.Address) > 3 && len(p.Address) <= 500 && len(p.School) > 1 && len(p.School) <= 200 && phone.MatchString(p.Phone) && phone.MatchString(p.Parent)
}
func sendAcademyMail(to, subject, body string) error {
	cfg, e := loadSettings()
	if e != nil {
		return e
	}
	c := cfg.Commerce
	host, _, e := net.SplitHostPort(c.SMTPAddress)
	if e != nil || c.SMTPFrom == "" {
		return fmt.Errorf("Email chưa cấu hình")
	}
	if _, e = mail.ParseAddress(c.SMTPFrom); e != nil {
		return e
	}
	conn, e := net.DialTimeout("tcp", c.SMTPAddress, 10*time.Second)
	if e != nil {
		return e
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(20 * time.Second))
	client, e := smtp.NewClient(conn, host)
	if e != nil {
		return e
	}
	defer client.Close()
	if e = client.StartTLS(&tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}); e != nil {
		return e
	}
	if c.SMTPUser != "" {
		if e = client.Auth(smtp.PlainAuth("", c.SMTPUser, c.SMTPPassword, host)); e != nil {
			return e
		}
	}
	if e = client.Mail(c.SMTPFrom); e != nil {
		return e
	}
	if e = client.Rcpt(to); e != nil {
		return e
	}
	out, e := client.Data()
	if e != nil {
		return e
	}
	_, e = fmt.Fprintf(out, "From: %s\r\nTo: %s\r\nSubject: =?UTF-8?B?%s?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n%s\r\n", c.SMTPFrom, to, base64.StdEncoding.EncodeToString([]byte(subject)), base64.StdEncoding.EncodeToString([]byte(body)))
	if e != nil {
		return e
	}
	if e = out.Close(); e != nil {
		return e
	}
	return client.Quit()
}
func (a *app) academyEmailCode(w http.ResponseWriter, r *http.Request) {
	var in struct{ Email string }
	if !decode(w, r, &in) {
		return
	}
	in.Email = normalizeEmail(in.Email)
	address, e := mail.ParseAddress(in.Email)
	if e != nil || address.Address != in.Email {
		problem(w, 400, "Email không hợp lệ")
		return
	}
	school, e := a.publicSchool(r)
	if e != nil {
		problem(w, 404, "Chưa có trung tâm")
		return
	}
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	global, err := a.cache.Eval(r.Context(), `local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],900) end;return n`, []string{"academy-otp-ip:" + digest(school+ip)}).Int()
	if err != nil || global > 20 {
		problem(w, 429, "Thử lại sau 15 phút")
		return
	}
	key := "academy-otp-send:" + digest(school+in.Email+ip)
	n, e := a.cache.Eval(r.Context(), `local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],900) end;return n`, []string{key}).Int()
	if e != nil || n > 5 {
		problem(w, 429, "Thử lại sau 15 phút")
		return
	}
	number, e := rand.Int(rand.Reader, big.NewInt(1000000))
	if e != nil {
		problem(w, 503, "Không tạo được mã")
		return
	}
	code := fmt.Sprintf("%06d", number.Int64())
	if e = sendAcademyMail(in.Email, "Mã xác thực tài khoản học tập", "Mã xác thực: "+code+". Có hiệu lực 10 phút. Không chia sẻ mã."); e != nil {
		problem(w, 503, "Chưa gửi được email. Kiểm tra cấu hình SMTP tại trung tâm.")
		return
	}
	if a.cache.Set(r.Context(), "academy-otp:"+digest(school+in.Email), digest(code), 10*time.Minute).Err() != nil {
		problem(w, 503, "Không lưu được mã")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}
func (a *app) academyRegister(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email, Password, Code string
		Profile               studentProfile
	}
	if !decode(w, r, &in) {
		return
	}
	in.Email = normalizeEmail(in.Email)
	address, e := mail.ParseAddress(in.Email)
	if e != nil || address.Address != in.Email || !validAccountPassword("student", in.Password) || !validStudentProfile(in.Profile) {
		problem(w, 400, "Điền hồ sơ hợp lệ, email và mật khẩu từ 6 ký tự")
		return
	}
	school, e := a.publicSchool(r)
	if e != nil {
		problem(w, 404, "Chưa có trung tâm")
		return
	}
	key := "academy-otp:" + digest(school+in.Email)
	count, e := a.cache.Eval(r.Context(), `local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],900) end;return n`, []string{"academy-otp-check:" + digest(school+in.Email)}).Int()
	if e != nil || count > 10 {
		problem(w, 429, "Yêu cầu mã mới sau 15 phút")
		return
	}
	expected, e := a.cache.Get(r.Context(), key).Result()
	if e != nil || !hmac.Equal([]byte(expected), []byte(digest(in.Code))) {
		problem(w, 400, "Mã email không đúng hoặc hết hạn")
		return
	}
	hash, e := bcrypt.GenerateFromPassword([]byte(in.Password), 12)
	if e != nil {
		problem(w, 400, "Mật khẩu không hợp lệ")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Database chưa sẵn sàng")
		return
	}
	defer tx.Rollback()
	id := uid()
	if _, e = tx.ExecContext(r.Context(), "INSERT INTO users(id,school_id,email,name,password_hash,role) VALUES(?,?,?,?,?,'student')", id, school, in.Email, in.Profile.Name, string(hash)); e == nil {
		_, e = tx.ExecContext(r.Context(), "INSERT INTO academy_profiles(school_id,user_id,dob,address,school_name,phone,parent_phone,marketing_consent,email_verified) VALUES(?,?,?,?,?,?,?,?,TRUE)", school, id, in.Profile.DOB, in.Profile.Address, in.Profile.School, in.Profile.Phone, in.Profile.Parent, in.Profile.Marketing)
	}
	if e != nil || tx.Commit() != nil {
		problem(w, 409, "Không tạo được tài khoản; email có thể đã tồn tại")
		return
	}
	a.cache.Del(r.Context(), key)
	send(w, 201, map[string]string{"id": id, "message": "Đăng ký thành công. Đăng nhập để học thử và thêm ảnh đại diện."})
}
func (a *app) academyProfile(w http.ResponseWriter, r *http.Request) {
	var in studentProfile
	if !decode(w, r, &in) {
		return
	}
	if !validStudentProfile(in) {
		problem(w, 400, "Hồ sơ không hợp lệ")
		return
	}
	u := who(r)
	prefix := "academy/avatars/" + u.School + "/" + u.ID + "/"
	if in.Avatar != "" && !strings.HasPrefix(in.Avatar, prefix) {
		problem(w, 400, "Ảnh không thuộc tài khoản")
		return
	}
	if in.Avatar != "" {
		store, ok := r2ready(w)
		if !ok {
			return
		}
		head, err := a.s3Client(store).HeadObject(r.Context(), &s3.HeadObjectInput{Bucket: &store.Bucket, Key: &in.Avatar})
		if err != nil || head == nil || aws.ToInt64(head.ContentLength) < 1 || aws.ToInt64(head.ContentLength) > 2<<20 || (aws.ToString(head.ContentType) != "image/png" && aws.ToString(head.ContentType) != "image/jpeg") {
			problem(w, 409, "Ảnh đại diện chưa tải hoàn tất")
			return
		}
	}
	_, e := a.db.ExecContext(r.Context(), "INSERT INTO academy_profiles(school_id,user_id,dob,address,school_name,phone,parent_phone,avatar_key,marketing_consent) VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE dob=VALUES(dob),address=VALUES(address),school_name=VALUES(school_name),phone=VALUES(phone),parent_phone=VALUES(parent_phone),avatar_key=VALUES(avatar_key),marketing_consent=VALUES(marketing_consent)", u.School, u.ID, in.DOB, in.Address, in.School, in.Phone, in.Parent, in.Avatar, in.Marketing)
	if e != nil {
		problem(w, 400, "Không lưu được hồ sơ")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}

func (a *app) academyVerifyEmail(w http.ResponseWriter, r *http.Request) {
	var in struct{ Code string }
	if !decode(w, r, &in) {
		return
	}
	u := who(r)
	var email string
	if a.db.QueryRowContext(r.Context(), "SELECT email FROM users WHERE id=? AND school_id=?", u.ID, u.School).Scan(&email) != nil {
		problem(w, 404, "Không thấy tài khoản")
		return
	}
	key := "academy-otp:" + digest(u.School+email)
	tries, e := a.cache.Incr(r.Context(), "academy-profile-otp:"+u.ID).Result()
	a.cache.Expire(r.Context(), "academy-profile-otp:"+u.ID, 15*time.Minute)
	if e != nil || tries > 10 {
		problem(w, 429, "Thử lại sau 15 phút")
		return
	}
	expected, e := a.cache.Get(r.Context(), key).Result()
	if e != nil || !hmac.Equal([]byte(expected), []byte(digest(in.Code))) {
		problem(w, 400, "Mã email sai hoặc hết hạn")
		return
	}
	var exists int
	if a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM academy_profiles WHERE school_id=? AND user_id=?", u.School, u.ID).Scan(&exists) != nil || exists != 1 {
		problem(w, 409, "Lưu hồ sơ đầy đủ trước khi xác thực email")
		return
	}
	if _, e = a.db.ExecContext(r.Context(), "UPDATE academy_profiles SET email_verified=TRUE WHERE school_id=? AND user_id=?", u.School, u.ID); e != nil {
		problem(w, 503, "Chưa xác thực được email")
		return
	}
	a.cache.Del(r.Context(), key)
	send(w, 200, map[string]bool{"ok": true})
}
