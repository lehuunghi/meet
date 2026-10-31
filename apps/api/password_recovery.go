package main

import (
	"encoding/json"
	"golang.org/x/crypto/bcrypt"
	"net"
	"net/http"
	"time"
)

type passwordRecovery struct {
	User, School string
	Version      int
}

func (a *app) issuePasswordRecovery(w http.ResponseWriter, r *http.Request) {
	if !admin(w, r) {
		return
	}
	actor := who(r)
	id := r.PathValue("user")
	var role string
	var grants []byte
	var version int
	if a.db.QueryRowContext(r.Context(), "SELECT u.role,u.session_version,c.permissions FROM users u LEFT JOIN user_controls c ON c.user_id=u.id WHERE u.school_id=? AND u.id=? AND u.active=TRUE", actor.School, id).Scan(&role, &version, &grants) != nil {
		problem(w, 404, "Không tìm thấy tài khoản đang hoạt động")
		return
	}
	if id == actor.ID || (role == "admin" && grants == nil) {
		problem(w, 403, "Không cấp liên kết khôi phục cho bản thân hoặc quản trị gốc")
		return
	}
	token := uid() + uid()
	hash := digest(token)
	raw, _ := json.Marshal(passwordRecovery{id, actor.School, version})
	script := `local old=redis.call('GET',KEYS[1]);if old then redis.call('DEL',string.sub(KEYS[2],1,-65)..old) end;redis.call('SET',KEYS[1],ARGV[1],'EX',1800);redis.call('SET',KEYS[2],ARGV[2],'EX',1800);return 1`
	if a.cache.Eval(r.Context(), script, []string{"password-recovery-user:" + id, "password-recovery:" + hash}, hash, string(raw)).Err() != nil {
		problem(w, 503, "Không cấp được liên kết khôi phục")
		return
	}
	a.audit(r, "account.recovery.issue", id)
	send(w, 200, map[string]string{"url": a.origin + "/reset-password#token=" + token, "expires_at": time.Now().UTC().Add(30 * time.Minute).Format(time.RFC3339)})
}
func (a *app) resetPassword(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Token    string `json:"token"`
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.Token) != 64 || !validAccountPassword("student", in.Password) {
		problem(w, 400, "Liên kết không hợp lệ hoặc mật khẩu chưa đủ độ dài hợp lệ")
		return
	}
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	script := `local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],900) end;return n`
	global, e := a.cache.Eval(r.Context(), script, []string{"password-recovery-ip:" + digest(ip)}).Int()
	if e != nil {
		problem(w, 503, "Khôi phục chưa sẵn sàng")
		return
	}
	if global > 60 {
		problem(w, 429, "Thử lại sau 15 phút")
		return
	}
	n, e := a.cache.Eval(r.Context(), script, []string{"password-recovery-attempt:" + digest(ip+":"+in.Token)}).Int()
	if e != nil {
		problem(w, 503, "Khôi phục chưa sẵn sàng")
		return
	}
	if n > 10 {
		problem(w, 429, "Thử lại sau 15 phút")
		return
	}
	if len(in.Token) != 64 || !validAccountPassword("student", in.Password) {
		problem(w, 400, "Liên kết không hợp lệ hoặc mật khẩu chưa đủ độ dài hợp lệ")
		return
	}
	key := "password-recovery:" + digest(in.Token)
	raw, e := a.cache.Get(r.Context(), key).Result()
	var p passwordRecovery
	if e != nil || json.Unmarshal([]byte(raw), &p) != nil {
		problem(w, 400, "Liên kết không hợp lệ hoặc đã hết hạn")
		return
	}
	var role string
	if a.db.QueryRowContext(r.Context(), "SELECT role FROM users WHERE school_id=? AND id=?", p.School, p.User).Scan(&role) != nil || !validAccountPassword(role, in.Password) {
		problem(w, 400, "Mật khẩu chưa đủ độ dài cho loại tài khoản")
		return
	}
	var enabled int
	if a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM account_security WHERE user_id=?", p.User).Scan(&enabled) != nil {
		problem(w, 503, "Không kiểm tra được 2FA")
		return
	}
	if enabled > 0 && !a.verifyOTP(r, p.User, in.Code) {
		problem(w, 403, "Nhập mã 2FA hợp lệ; khôi phục mật khẩu không bỏ qua 2FA")
		return
	}
	hash, e := bcrypt.GenerateFromPassword([]byte(in.Password), 12)
	if e != nil {
		problem(w, 503, "Không tạo được mật khẩu")
		return
	}
	// GETDEL consumes the bearer token exactly once across concurrent requests.
	consumed, e := a.cache.GetDel(r.Context(), key).Result()
	if e != nil || consumed != raw {
		problem(w, 409, "Liên kết đã được sử dụng; yêu cầu liên kết mới")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Yêu cầu liên kết mới và thử lại")
		return
	}
	defer tx.Rollback()
	res, e := tx.ExecContext(r.Context(), "UPDATE users SET password_hash=?,session_version=session_version+1,revision=revision+1 WHERE school_id=? AND id=? AND session_version=? AND active=TRUE", hash, p.School, p.User, p.Version)
	if e != nil {
		problem(w, 503, "Không đổi được mật khẩu; yêu cầu liên kết mới")
		return
	}
	changed, _ := res.RowsAffected()
	if changed != 1 {
		problem(w, 409, "Tài khoản đã thay đổi; yêu cầu liên kết mới")
		return
	}
	if _, e = tx.ExecContext(r.Context(), "INSERT INTO audit_log(school_id,actor_id,action,target) VALUES(?,?,'account.recovery.complete',?)", p.School, p.User, p.User); e != nil {
		problem(w, 503, "Không lưu được nhật ký; yêu cầu liên kết mới")
		return
	}
	if tx.Commit() != nil {
		problem(w, 503, "Không lưu được mật khẩu; yêu cầu liên kết mới")
		return
	}
	a.cache.Del(r.Context(), "current-session:"+p.User, "password-recovery-user:"+p.User)
	send(w, 200, map[string]bool{"ok": true})
}
