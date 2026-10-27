package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

func paySignature(data map[string]any, key string) (string, error) {
	names := make([]string, 0, len(data))
	for k := range data {
		names = append(names, k)
	}
	sort.Strings(names)
	parts := []string{}
	for _, k := range names {
		var v string
		switch x := data[k].(type) {
		case nil:
			v = ""
		case string:
			if x != "null" && x != "undefined" {
				v = x
			}
		case json.Number:
			v = x.String()
		case bool:
			v = strconv.FormatBool(x)
		default:
			return "", errors.New("unsupported signed value")
		}
		parts = append(parts, k+"="+v)
	}
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(strings.Join(parts, "&")))
	return hex.EncodeToString(mac.Sum(nil)), nil
}
func (a *app) academyOrder(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	if u.Role != "student" {
		problem(w, 403, "Chỉ học sinh mua gói")
		return
	}
	if r.Method == "GET" {
		a.query(w, r, "SELECT o.id,o.code,o.price_vnd,o.days,o.live_enabled,o.status,o.created_at,o.paid_at,i.number AS invoice_number FROM academy_orders o LEFT JOIN academy_invoices i ON i.school_id=o.school_id AND i.order_id=o.id WHERE o.school_id=? AND o.user_id=? ORDER BY o.created_at DESC LIMIT 100", u.School, u.ID)
		return
	}
	var in struct {
		Plan string `json:"plan_id"`
	}
	if !decode(w, r, &in) {
		return
	}
	var verified bool
	if a.db.QueryRowContext(r.Context(), "SELECT email_verified FROM academy_profiles WHERE school_id=? AND user_id=?", u.School, u.ID).Scan(&verified) != nil || !verified {
		problem(w, 409, "Xác thực email và hoàn thiện hồ sơ trước khi mua")
		return
	}
	var pending int
	if a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM academy_orders WHERE school_id=? AND user_id=? AND status='pending'", u.School, u.ID).Scan(&pending) != nil || pending >= 5 {
		problem(w, 409, "Đang có đơn chờ xử lý")
		return
	}
	id := uid()
	res, e := a.db.ExecContext(r.Context(), "INSERT INTO academy_orders(id,school_id,user_id,plan_id,price_vnd,days,live_enabled) SELECT ?,?,?,id,price_vnd,days,live_enabled FROM academy_plans WHERE school_id=? AND id=? AND active=TRUE", id, u.School, u.ID, u.School, in.Plan)
	if e != nil {
		problem(w, 400, "Không tạo được đơn")
		return
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		problem(w, 404, "Gói đã ngừng bán")
		return
	}
	a.academyCheckout(w, r, id)
}
func (a *app) academyCheckout(w http.ResponseWriter, r *http.Request, id string) {
	var code, amount int64
	var status string
	if a.db.QueryRowContext(r.Context(), "SELECT code,price_vnd,status FROM academy_orders WHERE id=? AND school_id=? AND user_id=?", id, who(r).School, who(r).ID).Scan(&code, &amount, &status) != nil {
		problem(w, 404, "Không thấy đơn")
		return
	}
	cfg, _ := loadSettings()
	memo := "NAPVIP " + strconv.FormatInt(code, 10)
	params := url.Values{"amount": {strconv.FormatInt(amount, 10)}, "addInfo": {memo}, "accountName": {cfg.Commerce.BankName}}
	qr := ""
	if cfg.Commerce.BankBIN != "" && cfg.Commerce.BankAccount != "" {
		qr = "https://img.vietqr.io/image/" + url.PathEscape(cfg.Commerce.BankBIN) + "-" + url.PathEscape(cfg.Commerce.BankAccount) + "-compact2.png?" + params.Encode()
	}
	out := map[string]any{"id": id, "code": code, "amount": amount, "status": status, "description": memo, "bank_account": cfg.Commerce.BankAccount, "bank_name": cfg.Commerce.BankName, "qr_url": qr}
	if cfg.Commerce.ClientID != "" && cfg.Commerce.APIKey != "" && cfg.Commerce.ChecksumKey != "" && status == "pending" {
		data := map[string]any{"amount": json.Number(strconv.FormatInt(amount, 10)), "cancelUrl": a.origin + "/hoc/thanh-toan/" + id, "description": memo, "orderCode": json.Number(strconv.FormatInt(code, 10)), "returnUrl": a.origin + "/hoc/thanh-toan/" + id}
		signature, _ := paySignature(data, cfg.Commerce.ChecksumKey)
		data["signature"] = signature
		raw, _ := json.Marshal(data)
		req, _ := http.NewRequestWithContext(r.Context(), "POST", "https://api-merchant.payos.vn/v2/payment-requests", bytes.NewReader(raw))
		req.Header.Set("x-client-id", cfg.Commerce.ClientID)
		req.Header.Set("x-api-key", cfg.Commerce.APIKey)
		req.Header.Set("Content-Type", "application/json")
		res, e := a.client.Do(req)
		if e == nil {
			defer res.Body.Close()
			var response struct {
				Code string
				Data struct {
					CheckoutURL string `json:"checkoutUrl"`
				}
			}
			if json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&response) == nil && res.StatusCode == 200 && response.Code == "00" {
				if validCheckoutURL(response.Data.CheckoutURL) {
					out["checkout_url"] = response.Data.CheckoutURL
					_, _ = a.db.ExecContext(r.Context(), "INSERT INTO academy_order_links(school_id,order_id,checkout_url) VALUES(?,?,?) ON DUPLICATE KEY UPDATE checkout_url=VALUES(checkout_url)", who(r).School, id, response.Data.CheckoutURL)
				}
			}
		}
	}
	send(w, 201, out)
}
func extendVIP(now, previous time.Time, days int) time.Time {
	if previous.After(now) {
		now = previous
	}
	return now.AddDate(0, 0, days)
}
func (a *app) payOrder(r *http.Request, school, id, ref, reviewer string, amount int64) error {
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var user, status string
	var price int64
	var days int
	var live bool
	if e = tx.QueryRowContext(r.Context(), "SELECT user_id,status,price_vnd,days,live_enabled FROM academy_orders WHERE school_id=? AND id=? FOR UPDATE", school, id).Scan(&user, &status, &price, &days, &live); e != nil {
		return e
	}
	if status == "paid" {
		return nil
	}
	if status != "pending" || price != amount {
		return errors.New("order mismatch")
	}
	var lock string
	if e = tx.QueryRowContext(r.Context(), "SELECT id FROM users WHERE school_id=? AND id=? AND active=TRUE FOR UPDATE", school, user).Scan(&lock); e != nil {
		return e
	}
	var previous time.Time
	var previousLive bool
	e = tx.QueryRowContext(r.Context(), "SELECT expires_at,live_enabled FROM academy_memberships WHERE school_id=? AND user_id=?", school, user).Scan(&previous, &previousLive)
	if e != nil && e != sql.ErrNoRows {
		return e
	}
	var now time.Time
	if e = tx.QueryRowContext(r.Context(), "SELECT UTC_TIMESTAMP(6)").Scan(&now); e != nil {
		return e
	}
	var liveUntil time.Time
	e = tx.QueryRowContext(r.Context(), "SELECT expires_at FROM academy_live_memberships WHERE school_id=? AND user_id=?", school, user).Scan(&liveUntil)
	if e != nil && e != sql.ErrNoRows {
		return e
	}
	if e == sql.ErrNoRows && previousLive {
		liveUntil = previous
	}
	if live {
		liveUntil = extendVIP(now, liveUntil, days)
	} else if liveUntil.IsZero() {
		liveUntil = now
	}
	until := extendVIP(now, previous, days)
	if e = createAcademyInvoice(r.Context(), tx, school, id); e != nil {
		return e
	}
	if _, e = tx.ExecContext(r.Context(), "UPDATE academy_orders SET status='paid',provider_ref=?,reviewer=NULLIF(?,''),paid_at=? WHERE school_id=? AND id=?", ref, reviewer, now, school, id); e != nil {
		return e
	}
	if _, e = tx.ExecContext(r.Context(), "INSERT INTO academy_memberships(school_id,user_id,expires_at,live_enabled) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE expires_at=VALUES(expires_at),live_enabled=VALUES(live_enabled)", school, user, until, liveUntil.After(now)); e != nil {
		return e
	}
	if _, e = tx.ExecContext(r.Context(), "INSERT INTO academy_live_memberships(school_id,user_id,expires_at) VALUES(?,?,?) ON DUPLICATE KEY UPDATE expires_at=VALUES(expires_at)", school, user, liveUntil); e != nil {
		return e
	}
	return tx.Commit()
}
func (a *app) academyReview(w http.ResponseWriter, r *http.Request) {
	if !a.businessAdmin(w, r, "finance") {
		return
	}
	var in struct{ Action, Note string }
	if !decode(w, r, &in) {
		return
	}
	u := who(r)
	id := r.PathValue("order")
	if len(in.Note) > 500 {
		problem(w, 400, "Ghi chú quá dài")
		return
	}
	if in.Action == "approve" {
		var amount int64
		if a.db.QueryRowContext(r.Context(), "SELECT price_vnd FROM academy_orders WHERE school_id=? AND id=?", u.School, id).Scan(&amount) != nil {
			problem(w, 404, "Không thấy đơn")
			return
		}
		if a.payOrder(r, u.School, id, "manual:"+id, u.ID, amount) != nil {
			problem(w, 409, "Không duyệt được đơn")
			return
		}
	} else if in.Action == "reject" {
		res, e := a.db.ExecContext(r.Context(), "UPDATE academy_orders SET status='rejected',reviewer=?,review_note=? WHERE school_id=? AND id=? AND status='pending'", u.ID, in.Note, u.School, id)
		if e != nil {
			problem(w, 500, "Không từ chối được đơn")
			return
		}
		n, _ := res.RowsAffected()
		if n != 1 {
			problem(w, 409, "Đơn đã được xử lý")
			return
		}
	} else {
		problem(w, 400, "Thao tác không hợp lệ")
		return
	}
	a.audit(r, "academy.order."+in.Action, id)
	send(w, 200, map[string]bool{"ok": true})
}
func (a *app) academyPayOS(w http.ResponseWriter, r *http.Request) {
	cfg, _ := loadSettings()
	if cfg.Commerce.ChecksumKey == "" {
		problem(w, 503, "Chưa cấu hình webhook")
		return
	}
	var in struct {
		Code      string
		Success   bool
		Data      map[string]any
		Signature string
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.UseNumber()
	if decoder.Decode(&in) != nil {
		problem(w, 400, "Webhook không hợp lệ")
		return
	}
	sig, e := paySignature(in.Data, cfg.Commerce.ChecksumKey)
	expected, err := hex.DecodeString(in.Signature)
	actual, _ := hex.DecodeString(sig)
	if e != nil || err != nil || !hmac.Equal(expected, actual) {
		problem(w, 403, "Chữ ký không hợp lệ")
		return
	}
	text := func(k string) string { return fmt.Sprint(in.Data[k]) }
	if !in.Success || in.Code != "00" || text("code") != "00" || text("currency") != "VND" || text("accountNumber") != cfg.Commerce.BankAccount {
		problem(w, 400, "Giao dịch không khớp")
		return
	}
	code, e := strconv.ParseInt(text("orderCode"), 10, 64)
	amount, e2 := strconv.ParseInt(text("amount"), 10, 64)
	ref := text("reference")
	if e != nil || e2 != nil || code <= 0 || ref == "" || len(ref) > 120 {
		problem(w, 400, "Giao dịch không hợp lệ")
		return
	}
	school, e := a.publicSchool(r)
	if e != nil {
		problem(w, 404, "Không tìm thấy trung tâm")
		return
	}
	var id string
	if a.db.QueryRowContext(r.Context(), "SELECT id FROM academy_orders WHERE school_id=? AND code=?", school, code).Scan(&id) != nil {
		problem(w, 404, "Không thấy đơn")
		return
	}
	if a.payOrder(r, school, id, "payos:"+ref, "", amount) != nil {
		problem(w, 409, "Không khớp đơn hoặc giao dịch trùng")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}
