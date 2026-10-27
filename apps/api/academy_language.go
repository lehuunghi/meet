package main

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"net/http"
	"strings"
)

//go:embed ui_catalog.json
var uiCatalogJSON []byte
var uiCatalog = []struct {
	Key  string `json:"key"`
	Area string `json:"area"`
}{}

func init() {
	if json.Unmarshal(uiCatalogJSON, &uiCatalog) != nil {
		panic("invalid UI catalog")
	}
}
func (a *app) uiTexts(ctx context.Context, school string) map[string]string {
	var raw string
	out := map[string]string{}
	if a.db.QueryRowContext(ctx, "SELECT content FROM academy_ui_texts WHERE school_id=?", school).Scan(&raw) == nil {
		_ = json.Unmarshal([]byte(raw), &out)
	}
	return out
}
func (a *app) academyUITextPublic(w http.ResponseWriter, r *http.Request) {
	school, e := a.publicSchool(r)
	if e != nil {
		problem(w, 404, "Chưa có trung tâm")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	send(w, 200, map[string]any{"texts": a.uiTexts(r.Context(), school)})
}
func (a *app) academyUITextAdmin(w http.ResponseWriter, r *http.Request) {
	if !a.businessAdmin(w, r, "content") {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	u := who(r)
	if r.Method == "GET" {
		var raw string
		var revision int
		e := a.db.QueryRowContext(r.Context(), "SELECT content,revision FROM academy_ui_texts WHERE school_id=?", u.School).Scan(&raw, &revision)
		if e != nil && e != sql.ErrNoRows {
			problem(w, 503, "Chưa tải được ngôn ngữ")
			return
		}
		texts := map[string]string{}
		if raw != "" {
			_ = json.Unmarshal([]byte(raw), &texts)
		}
		send(w, 200, map[string]any{"catalog": uiCatalog, "texts": texts, "revision": revision})
		return
	}
	var in struct {
		Texts    map[string]string
		Revision int
	}
	if !decode(w, r, &in) {
		return
	}
	allowed := map[string]bool{}
	for _, row := range uiCatalog {
		allowed[row.Key] = true
	}
	if len(in.Texts) > 3000 {
		problem(w, 400, "Quá nhiều câu chữ tùy chỉnh")
		return
	}
	for key, value := range in.Texts {
		if !allowed[key] || len(value) > 8000 || strings.TrimSpace(value) == "" || strings.ContainsRune(value, 0) {
			problem(w, 400, "Câu chữ không hợp lệ hoặc không có trong danh mục")
			return
		}
	}
	if in.Texts == nil {
		in.Texts = map[string]string{}
	}
	raw, e := json.Marshal(in.Texts)
	if e != nil || len(raw) > 700000 {
		problem(w, 400, "Cấu hình ngôn ngữ quá lớn")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Chưa lưu được ngôn ngữ")
		return
	}
	defer tx.Rollback()
	var school string
	if tx.QueryRowContext(r.Context(), "SELECT id FROM schools WHERE id=? FOR UPDATE", u.School).Scan(&school) != nil {
		problem(w, 404, "Không tìm thấy đơn vị")
		return
	}
	var revision int
	e = tx.QueryRowContext(r.Context(), "SELECT revision FROM academy_ui_texts WHERE school_id=?", u.School).Scan(&revision)
	if e != nil && e != sql.ErrNoRows {
		problem(w, 503, "Chưa đọc được phiên bản ngôn ngữ")
		return
	}
	if revision != in.Revision {
		problem(w, 409, "Ngôn ngữ đã thay đổi; tải lại trước khi lưu")
		return
	}
	if _, e = tx.ExecContext(r.Context(), "INSERT INTO academy_ui_texts(school_id,revision,content) VALUES(?,1,?) ON DUPLICATE KEY UPDATE content=VALUES(content),revision=revision+1", u.School, string(raw)); e != nil || tx.Commit() != nil {
		problem(w, 503, "Chưa lưu được ngôn ngữ")
		return
	}
	a.audit(r, "academy.ui-texts.save", u.School)
	send(w, 200, map[string]int{"revision": revision + 1})
}
