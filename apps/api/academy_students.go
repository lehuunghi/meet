package main

import (
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
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
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Chưa lưu được hồ sơ")
		return
	}
	defer tx.Rollback()
	_, e = tx.ExecContext(r.Context(), "INSERT INTO academy_profiles(school_id,user_id,dob,address,school_name,phone,parent_phone,avatar_key,marketing_consent) VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE dob=VALUES(dob),address=VALUES(address),school_name=VALUES(school_name),phone=VALUES(phone),parent_phone=VALUES(parent_phone),avatar_key=VALUES(avatar_key),marketing_consent=VALUES(marketing_consent)", u.School, u.ID, in.DOB, in.Address, in.School, in.Phone, in.Parent, in.Avatar, in.Marketing)
	if e != nil {
		problem(w, 400, "Không lưu được hồ sơ")
		return
	}
	if in.Avatar != "" {
		if _, e = tx.ExecContext(r.Context(), "DELETE FROM academy_registration_avatars WHERE school_id=? AND user_id=?", u.School, u.ID); e != nil {
			problem(w, 503, "Chưa cập nhật được ảnh")
			return
		}
	}
	if tx.Commit() != nil {
		problem(w, 503, "Chưa lưu được hồ sơ")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}
