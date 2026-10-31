package main

import (
	"net/http"
	"strconv"
	"strings"
)

func (a *app) auditReport(w http.ResponseWriter, r *http.Request) {
	if !admin(w, r) {
		return
	}
	before := int64(0)
	var e error
	if value := r.URL.Query().Get("before"); value != "" {
		before, e = strconv.ParseInt(value, 10, 64)
		if e != nil || before < 1 {
			problem(w, 400, "Mốc nhật ký không hợp lệ")
			return
		}
	}
	action := strings.TrimSpace(r.URL.Query().Get("action"))
	if len(action) > 80 {
		problem(w, 400, "Tên thao tác quá dài")
		return
	}
	a.query(w, r, `SELECT l.id,l.actor_id,COALESCE(u.name,'Tài khoản đã xóa') AS actor_name,COALESCE(u.short_id,'') AS actor_code,l.action,l.target,l.at FROM audit_log l LEFT JOIN users u ON u.school_id=l.school_id AND u.id=l.actor_id WHERE l.school_id=? AND (?=0 OR l.id<?) AND (?='' OR l.action=?) ORDER BY l.id DESC LIMIT 51`, who(r).School, before, before, action, action)
}
