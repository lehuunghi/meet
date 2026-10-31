package main

import (
	"context"
	"database/sql"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"net/http"
)

func createAcademyInvoice(ctx context.Context, tx *sql.Tx, school, order string) error {
	_, e := tx.ExecContext(ctx, `INSERT IGNORE INTO academy_invoices(school_id,order_id,number,buyer_name,buyer_email,plan_name,amount_vnd,days) SELECT o.school_id,o.id,CONCAT('HD',o.code),u.name,u.email,p.name,o.price_vnd,o.days FROM academy_orders o JOIN users u ON u.school_id=o.school_id AND u.id=o.user_id JOIN academy_plans p ON p.school_id=o.school_id AND p.id=o.plan_id WHERE o.school_id=? AND o.id=?`, school, order)
	if e != nil {
		return e
	}
	var number string
	return tx.QueryRowContext(ctx, "SELECT number FROM academy_invoices WHERE school_id=? AND order_id=?", school, order).Scan(&number)
}
func (a *app) academyConfirmTransfer(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	if u.Role != "student" {
		problem(w, 403, "Chỉ học sinh xác nhận đơn của mình")
		return
	}
	var in struct {
		Confirm bool `json:"confirm"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !in.Confirm {
		problem(w, 400, "Xác nhận đã chuyển khoản trước khi tạo hóa đơn")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Chưa tạo được hóa đơn")
		return
	}
	defer tx.Rollback()
	var status, key string
	id := r.PathValue("order")
	if tx.QueryRowContext(r.Context(), "SELECT status,COALESCE(receipt_key,'') FROM academy_orders WHERE school_id=? AND user_id=? AND id=? FOR UPDATE", u.School, u.ID, id).Scan(&status, &key) != nil {
		problem(w, 404, "Không tìm thấy đơn")
		return
	}
	var number string
	if tx.QueryRowContext(r.Context(), "SELECT number FROM academy_invoices WHERE school_id=? AND order_id=?", u.School, id).Scan(&number) == nil {
		send(w, 200, map[string]string{"number": number})
		return
	}
	if status != "pending" {
		problem(w, 409, "Đơn đã được xử lý")
		return
	}
	if key == "" {
		problem(w, 409, "Tải biên lai chuyển khoản trước khi xác nhận")
		return
	}
	store, ok := r2ready(w)
	if !ok {
		return
	}
	head, err := a.s3Client(store).HeadObject(r.Context(), &s3.HeadObjectInput{Bucket: &store.Bucket, Key: &key})
	if err != nil || head == nil || aws.ToInt64(head.ContentLength) < 1 || aws.ToInt64(head.ContentLength) > 2<<20 || (aws.ToString(head.ContentType) != "image/jpeg" && aws.ToString(head.ContentType) != "image/png") {
		problem(w, 409, "Biên lai chưa tải hoàn tất. Vui lòng tải lại")
		return
	}
	if e = createAcademyInvoice(r.Context(), tx, u.School, id); e != nil || tx.Commit() != nil {
		problem(w, 503, "Chưa tạo được hóa đơn")
		return
	}
	a.audit(r, "academy.invoice.submit", id)
	send(w, 201, map[string]bool{"ok": true})
}
func (a *app) academyInvoice(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	id := r.PathValue("order")
	filter := " AND o.user_id=?"
	args := []any{u.School, id, u.ID}
	if u.Role == "admin" && permitted(u, "finance") {
		filter = ""
		args = args[:2]
	} else if u.Role != "student" {
		problem(w, 403, "Chưa được cấp quyền hóa đơn")
		return
	}
	rows, e := a.workspaceRows(r.Context(), `SELECT i.number,i.order_id,i.buyer_name,i.buyer_email,i.plan_name,i.amount_vnd,i.days,i.created_at,o.status,o.paid_at,COALESCE(o.review_note,'') AS review_note,s.name AS school_name FROM academy_invoices i JOIN academy_orders o ON o.school_id=i.school_id AND o.id=i.order_id JOIN schools s ON s.id=i.school_id WHERE i.school_id=? AND i.order_id=?`+filter, args...)
	if e != nil {
		problem(w, 503, "Chưa tải được hóa đơn")
		return
	}
	if len(rows) != 1 {
		problem(w, 404, "Đơn chưa có hóa đơn")
		return
	}
	w.Header().Set("Cache-Control", "private,no-store")
	send(w, 200, rows[0])
}
