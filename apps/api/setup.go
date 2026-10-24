package main

import (
	"context"
	"database/sql"
	"net/http"
	"net/mail"
	"os"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func (a *app) setupStatus(w http.ResponseWriter, r *http.Request) {
	var n int
	if a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM schools").Scan(&n) != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	_, tokenErr := os.Stat(configPath("setup-token"))
	send(w, 200, map[string]any{"initialized": n > 0, "available": tokenErr == nil, "retention_days": configuredRetention()})
}
func (a *app) setupUnlock(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Token string `json:"token"`
	}
	if !decode(w, r, &in) {
		return
	}
	n, e := a.cache.Eval(r.Context(), `local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],300) end;return n`, []string{"setup-attempts"}).Int()
	if e != nil {
		problem(w, 503, "Operator session unavailable")
		return
	}
	if n > 20 {
		problem(w, 429, "Thử lại sau 5 phút")
		return
	}
	if !setupTokenMatches(in.Token) {
		problem(w, 403, "Mã cài đặt không đúng")
		return
	}
	token := uid() + uid()
	if a.cache.Set(r.Context(), "operator:"+digest(token), "operator", 15*time.Minute).Err() != nil {
		problem(w, 503, "Operator session unavailable")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "meet_operator", Value: token, Path: "/api/setup", HttpOnly: true, Secure: a.secure, SameSite: http.SameSiteStrictMode, MaxAge: 900})
	send(w, 200, map[string]bool{"ok": true})
}
func (a *app) operator(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, e := r.Cookie("meet_operator")
		if e != nil || a.cache.Get(r.Context(), "operator:"+digest(c.Value)).Val() != "operator" {
			problem(w, 401, "Mở khóa cấu hình hệ thống trước")
			return
		}
		next(w, r)
	}
}
func (a *app) setupLock(w http.ResponseWriter, r *http.Request) {
	c, _ := r.Cookie("meet_operator")
	if a.cache.Del(r.Context(), "operator:"+digest(c.Value)).Err() != nil {
		problem(w, 503, "Operator session unavailable")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "meet_operator", Value: "", Path: "/api/setup", MaxAge: -1, HttpOnly: true, Secure: a.secure, SameSite: http.SameSiteStrictMode})
	send(w, 200, map[string]bool{"ok": true})
}
func (a *app) setupGet(w http.ResponseWriter, r *http.Request) {
	c, e := loadSettings()
	if e != nil {
		problem(w, 500, "Không đọc được cấu hình")
		return
	}
	var n int
	if a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM schools").Scan(&n) != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	counts := map[string]int{}
	rows, e := a.db.QueryContext(r.Context(), "SELECT provider_id,COUNT(*) FROM class_sfu_bindings GROUP BY provider_id")
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var count int
		if rows.Scan(&id, &count) != nil {
			problem(w, 500, "Allocation read failed")
			return
		}
		counts[id] = count
	}
	if rows.Err() != nil {
		problem(w, 500, "Allocation read failed")
		return
	}
	send(w, 200, map[string]any{"settings": redactSettings(c), "initialized": n > 0, "allocations": counts, "origin": a.origin, "backup_status": backupStatus()})
}

type firstSchool struct {
	Slug     string `json:"slug"`
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

func validateFirstSchool(s firstSchool) bool {
	addr, e := mail.ParseAddress(s.Email)
	return e == nil && addr.Address == s.Email && s.Email == strings.ToLower(s.Email) && len(s.Email) <= 190 && len(s.Name) > 0 && len(s.Name) <= 200 && len(s.Password) >= 12 && len(s.Password) <= 72 && schoolSlug.MatchString(s.Slug)
}
func (a *app) setupSave(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Settings systemSettings `json:"settings"`
		School   firstSchool    `json:"school"`
	}
	if !decode(w, r, &in) {
		return
	}
	if configPath("settings.json") == "" {
		problem(w, 503, "CONFIG_DIR chưa được cấu hình")
		return
	}
	// Serialize operator saves across replicas, including upstream bucket changes.
	nonce := uid()
	ok, e := a.cache.SetNX(r.Context(), "setup-save", nonce, 100*time.Second).Result()
	if e != nil || !ok {
		problem(w, 409, "Đang lưu cấu hình, vui lòng thử lại")
		return
	}
	defer a.cache.Eval(context.Background(), `if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`, []string{"setup-save"}, nonce)
	old, e := loadSettings()
	if e != nil {
		problem(w, 500, "Không đọc được cấu hình cũ")
		return
	}
	if e = validateSettings(&in.Settings, old); e != nil {
		problem(w, 400, e.Error())
		return
	}
	var schools int
	if a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM schools").Scan(&schools) != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	if schools == 0 && !validateFirstSchool(in.School) {
		problem(w, 400, "Điền mã trường hợp lệ, tên trường, email viết thường và mật khẩu admin 12–72 byte")
		return
	}
	// Check immutable pinned app IDs before any external bucket mutation.
	conn, release, e := lockAllocation(r.Context(), a.db)
	if e != nil {
		problem(w, 409, "Đang cấp SFU, thử lại sau")
		return
	}
	defer release()
	rows, e := conn.QueryContext(r.Context(), "SELECT DISTINCT provider_id,app_id FROM class_sfu_bindings UNION SELECT DISTINCT provider_id,app_id FROM meeting_sfu_bindings")
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	for rows.Next() {
		var id, app string
		if rows.Scan(&id, &app) != nil {
			rows.Close()
			problem(w, 500, "Allocation read failed")
			return
		}
		if _, e = providerByID(in.Settings.SFU, id, app); e != nil {
			rows.Close()
			problem(w, 409, "Không được xóa/đổi App ID đã gán lớp; hãy giữ credential và tắt nhận lớp mới")
			return
		}
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		problem(w, 500, "Allocation read failed")
		return
	}
	var recordings int
	if conn.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM recordings").Scan(&recordings) != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	if recordings > 0 && (old.R2.Account != in.Settings.R2.Account || old.R2.Bucket != in.Settings.R2.Bucket || !in.Settings.R2.Enabled) {
		problem(w, 409, "Đang có metadata bản ghi; giữ nguyên account/bucket và bật R2 để dọn đúng kho")
		return
	}
	// Legacy active rooms also need their original app while the first binding is being adopted.
	var legacy int
	if conn.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM media_sessions s JOIN meetings m ON m.id=s.meeting_id AND m.school_id=s.school_id LEFT JOIN meeting_sfu_bindings b ON b.meeting_id=m.id AND b.school_id=m.school_id WHERE m.status='live' AND b.meeting_id IS NULL").Scan(&legacy) != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	if legacy > 0 {
		found := false
		for _, p := range in.Settings.SFU {
			if p.AppID == secret("CF_SFU_APP_ID") {
				found = true
			}
		}
		if !found {
			problem(w, 409, "Giữ SFU App cũ cho các phòng đang kết nối")
			return
		}
	}
	if in.Settings.R2.Enabled {
		ctx, cancel := context.WithTimeout(r.Context(), 40*time.Second)
		e = a.configureBucket(ctx, in.Settings.R2, in.Settings.Retention)
		cancel()
		if e != nil {
			problem(w, 502, "Không cấu hình được R2: kiểm tra bucket có sẵn, quyền CORS/lifecycle/đọc/ghi/xóa object và rule cũ có thể xóa bản ghi trước thời hạn đã chọn. Cấu hình cục bộ chưa lưu; kiểm tra lại bucket nếu thao tác từ xa chỉ hoàn tất một phần.")
			return
		}
		in.Settings.R2.Lifecycle = true
	}
	var tx *sql.Tx
	if schools == 0 {
		tx, e = a.db.BeginTx(r.Context(), nil)
		if e != nil {
			problem(w, 503, "Database unavailable")
			return
		}
		defer tx.Rollback()
		hash, err := bcrypt.GenerateFromPassword([]byte(in.School.Password), 12)
		if err != nil {
			problem(w, 500, "Password hashing failed")
			return
		}
		school := uid()
		if _, e = tx.ExecContext(r.Context(), "INSERT INTO schools(id,slug,name) VALUES(?,?,?)", school, in.School.Slug, in.School.Name); e == nil {
			_, e = tx.ExecContext(r.Context(), "INSERT INTO users(id,school_id,email,name,password_hash,role) VALUES(?,?,?,?,?,'admin')", uid(), school, in.School.Email, "Administrator", hash)
		}
		if e != nil {
			problem(w, 409, "Không tạo được trường/admin")
			return
		}
	}
	if e = saveSettings(in.Settings); e != nil {
		problem(w, 500, "Không lưu được file cấu hình; kiểm tra quyền CONFIG_DIR")
		return
	}
	if _, e = a.db.ExecContext(r.Context(), "UPDATE recordings SET expires_at=DATE_ADD(created_at,INTERVAL ? DAY) WHERE deleted_at IS NULL", in.Settings.Retention); e != nil {
		problem(w, 500, "Cấu hình đã lưu; chưa cập nhật hạn bản ghi, lưu lại để thử lại")
		return
	}
	if tx != nil {
		if tx.Commit() != nil {
			problem(w, 500, "Chưa tạo được trường; cấu hình đã lưu, hãy thử lại bước khởi tạo")
			return
		}
	}
	if schools == 0 {
		if err := migrate(a.db); err != nil {
			problem(w, 500, "Đã khởi tạo; cần chạy lại migrate để cấp ID ngắn")
			return
		}
	}
	send(w, 200, map[string]any{"ok": true, "retention_days": in.Settings.Retention, "lifecycle_applied": in.Settings.R2.Lifecycle, "initialized": true})
}
func (a *app) setupCheckSFU(w http.ResponseWriter, r *http.Request) {
	var p sfuProvider
	if !decode(w, r, &p) {
		return
	}
	cfg, e := loadSettings()
	if e != nil {
		problem(w, 500, "Không đọc được cấu hình")
		return
	}
	if p.Secret == "" {
		for _, v := range cfg.SFU {
			if v.ID == p.ID && v.AppID == p.AppID {
				p.Secret = v.Secret
			}
		}
	}
	if !cfID.MatchString(p.AppID) || len(p.Secret) < 8 {
		problem(w, 400, "Nhập App ID và Secret trước")
		return
	}
	out, e := a.cloud(r, "POST", "apps/"+p.AppID+"/sessions/new", p.Secret, map[string]any{})
	if e != nil || out["sessionId"] == nil {
		problem(w, 502, "Cloudflare từ chối credential hoặc không truy cập được")
		return
	}
	send(w, 200, map[string]string{"status": "ok", "note": "Đã tạo session kiểm tra; cần thử cuộc gọi hai phía để nghiệm thu media"})
}
