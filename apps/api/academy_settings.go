package main

import (
	"context"
	"net"
	"net/http"
	"net/mail"
	"strings"
	"time"
)

// The website's finance administrators own commerce settings; no SFU, R2 or
// infrastructure secrets are exposed through this endpoint.
func (a *app) academySettings(w http.ResponseWriter, r *http.Request) {
	if !a.businessAdmin(w, r, "finance") {
		return
	}
	if r.Method == "GET" {
		c, e := loadSettings()
		if e != nil {
			problem(w, 503, "Không đọc được cấu hình")
			return
		}
		send(w, 200, map[string]any{"settings": redactSettings(c).Commerce, "revision": c.CommerceRevision, "secrets": map[string]bool{"api_key": c.Commerce.APIKey != "", "checksum_key": c.Commerce.ChecksumKey != "", "smtp_password": c.Commerce.SMTPPassword != ""}})
		return
	}
	var in struct {
		Settings commerceSettings `json:"settings"`
		Revision int              `json:"revision"`
	}
	if !decode(w, r, &in) {
		return
	}
	nonce := uid()
	ok, e := a.cache.SetNX(r.Context(), "setup-save", nonce, 100*time.Second).Result()
	if e != nil || !ok {
		problem(w, 409, "Đang lưu cấu hình, vui lòng thử lại")
		return
	}
	defer a.cache.Eval(context.Background(), `if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`, []string{"setup-save"}, nonce)
	c, e := loadSettings()
	if e != nil {
		problem(w, 503, "Không đọc được cấu hình")
		return
	}
	if in.Revision != c.CommerceRevision {
		problem(w, 409, "Cấu hình đã thay đổi. Tải lại trước khi lưu.")
		return
	}
	n := in.Settings
	if n.FreeVideos < 1 || n.FreeVideos > 100 {
		problem(w, 400, "Hạn mức video từ 1 đến 100")
		return
	}
	if n.SMTPAddress != "" {
		host, port, err := net.SplitHostPort(n.SMTPAddress)
		if err != nil || host == "" || port != "587" {
			problem(w, 400, "SMTP cần địa chỉ host:587 dùng STARTTLS")
			return
		}
		address, err := mail.ParseAddress(n.SMTPFrom)
		if err != nil || address.Address != n.SMTPFrom {
			problem(w, 400, "Email gửi không hợp lệ")
			return
		}
	}
	for _, v := range []string{n.SMTPAddress, n.SMTPFrom, n.SMTPUser, n.SMTPPassword, n.BankBIN, n.BankAccount, n.BankName, n.ClientID, n.APIKey, n.ChecksumKey} {
		if len(v) > 1000 || strings.ContainsAny(v, "\r\n") {
			problem(w, 400, "Thông tin quá dài hoặc chứa xuống dòng")
			return
		}
	}
	if n.APIKey == "" {
		n.APIKey = c.Commerce.APIKey
	}
	if n.ChecksumKey == "" {
		n.ChecksumKey = c.Commerce.ChecksumKey
	}
	if n.SMTPPassword == "" {
		n.SMTPPassword = c.Commerce.SMTPPassword
	}
	c.Commerce = n
	c.CommerceRevision++
	if saveSettings(c) != nil {
		problem(w, 500, "Không lưu được cấu hình")
		return
	}
	a.audit(r, "academy.settings.save", "website")
	send(w, 200, map[string]any{"ok": true, "revision": c.CommerceRevision})
}
