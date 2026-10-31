package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"golang.org/x/crypto/bcrypt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

func securityCipher() (cipher.AEAD, error) {
	p := configPath("account-key")
	if p == "" {
		return nil, errors.New("CONFIG_DIR required")
	}
	b, e := os.ReadFile(p)
	if os.IsNotExist(e) {
		key := make([]byte, 32)
		if _, e = rand.Read(key); e != nil {
			return nil, e
		}
		f, err := os.OpenFile(p, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err == nil {
			_, err = f.WriteString(hex.EncodeToString(key))
			f.Close()
		}
		b, e = os.ReadFile(p)
	}
	if e != nil {
		return nil, e
	}
	key, e := hex.DecodeString(strings.TrimSpace(string(b)))
	if e != nil {
		return nil, e
	}
	block, e := aes.NewCipher(key)
	if e != nil {
		return nil, e
	}
	return cipher.NewGCM(block)
}
func encryptOTP(s string) (string, error) {
	c, e := securityCipher()
	if e != nil {
		return "", e
	}
	n := make([]byte, c.NonceSize())
	if _, e = rand.Read(n); e != nil {
		return "", e
	}
	return base64.StdEncoding.EncodeToString(c.Seal(n, n, []byte(s), []byte("meet-totp-v1"))), nil
}
func decryptOTP(s string) (string, error) {
	c, e := securityCipher()
	if e != nil {
		return "", e
	}
	b, e := base64.StdEncoding.DecodeString(s)
	if e != nil || len(b) < c.NonceSize() {
		return "", errors.New("invalid secret")
	}
	v, e := c.Open(nil, b[:c.NonceSize()], b[c.NonceSize():], []byte("meet-totp-v1"))
	return string(v), e
}
func otpStep(secret, code string, now time.Time) int64 {
	if len(code) != 6 {
		return 0
	}
	key, e := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secret)
	if e != nil {
		return 0
	}
	for delta := int64(-1); delta <= 1; delta++ {
		step := now.Unix()/30 + delta
		var b [8]byte
		binary.BigEndian.PutUint64(b[:], uint64(step))
		m := hmac.New(sha1.New, key)
		m.Write(b[:])
		h := m.Sum(nil)
		o := h[len(h)-1] & 15
		n := (binary.BigEndian.Uint32(h[o:o+4]) & 0x7fffffff) % 1000000
		if subtle.ConstantTimeCompare([]byte(fmt.Sprintf("%06d", n)), []byte(code)) == 1 {
			return step
		}
	}
	return 0
}
func (a *app) verifyOTP(r *http.Request, user, code string) bool {
	var enc string
	var last int64
	if a.db.QueryRowContext(r.Context(), "SELECT secret,last_step FROM account_security WHERE user_id=?", user).Scan(&enc, &last) != nil {
		return false
	}
	s, e := decryptOTP(enc)
	if e != nil {
		return false
	}
	step := otpStep(s, code, time.Now())
	if step <= last {
		return false
	}
	res, e := a.db.ExecContext(r.Context(), "UPDATE account_security SET last_step=? WHERE user_id=? AND last_step<?", step, user, step)
	if e != nil {
		return false
	}
	n, _ := res.RowsAffected()
	return n == 1
}
func (a *app) profile(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	a.query(w, r, "SELECT u.id,u.short_id,u.email,u.student_code,u.name,u.role,u.active,s.name AS school_name,EXISTS(SELECT 1 FROM account_security x WHERE x.user_id=u.id) AS two_factor FROM users u JOIN schools s ON s.id=u.school_id WHERE u.id=? AND u.school_id=?", u.ID, u.School)
}
func (a *app) twoFactor(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Action   string `json:"action"`
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if !decode(w, r, &in) {
		return
	}
	u := who(r)
	var hash string
	if a.db.QueryRowContext(r.Context(), "SELECT password_hash FROM users WHERE id=? AND school_id=?", u.ID, u.School).Scan(&hash) != nil || bcrypt.CompareHashAndPassword([]byte(hash), []byte(in.Password)) != nil {
		problem(w, 403, "Mật khẩu không đúng")
		return
	}
	var enabled int
	if a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM account_security WHERE user_id=?", u.ID).Scan(&enabled) != nil {
		problem(w, 503, "Security unavailable")
		return
	}
	key := "totp-pending:" + u.ID
	switch in.Action {
	case "setup":
		if enabled > 0 {
			problem(w, 409, "2FA đã bật")
			return
		}
		b := make([]byte, 20)
		if _, e := rand.Read(b); e != nil {
			problem(w, 503, "Security unavailable")
			return
		}
		s := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b)
		enc, e := encryptOTP(s)
		if e != nil || a.cache.Set(r.Context(), key, enc, 5*time.Minute).Err() != nil {
			problem(w, 503, "Không lưu được khóa bảo mật")
			return
		}
		send(w, 200, map[string]string{"secret": s, "uri": "otpauth://totp/" + url.PathEscape("Meet:"+u.Name) + "?secret=" + s + "&issuer=Meet&algorithm=SHA1&digits=6&period=30"})
		return
	case "enable":
		enc, e := a.cache.Get(r.Context(), key).Result()
		if e != nil {
			problem(w, 400, "Mã thiết lập hết hạn")
			return
		}
		s, e := decryptOTP(enc)
		step := otpStep(s, in.Code, time.Now())
		if e != nil || step == 0 {
			problem(w, 400, "Mã xác thực không đúng")
			return
		}
		if _, e = a.db.ExecContext(r.Context(), "INSERT INTO account_security(user_id,secret,last_step) VALUES(?,?,?)", u.ID, enc, step); e != nil {
			problem(w, 409, "2FA đã bật hoặc không lưu được")
			return
		}
		a.cache.Del(r.Context(), key)
	case "disable":
		if !a.verifyOTP(r, u.ID, in.Code) {
			problem(w, 403, "Mã xác thực không đúng hoặc đã sử dụng")
			return
		}
		if _, e := a.db.ExecContext(r.Context(), "DELETE FROM account_security WHERE user_id=?", u.ID); e != nil {
			problem(w, 503, "Security unavailable")
			return
		}
	default:
		problem(w, 400, "Thao tác không hợp lệ")
		return
	}
	a.db.ExecContext(r.Context(), "UPDATE users SET session_version=session_version+1 WHERE id=?", u.ID)
	a.audit(r, "account.2fa."+in.Action, u.ID)
	send(w, 200, map[string]bool{"ok": true})
}
