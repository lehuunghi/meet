package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"net/http"
)

func (a *app) websiteLogoURL(ctx context.Context, school string) string {
	var revision string
	if a.db.QueryRowContext(ctx, "SELECT revision FROM academy_logos WHERE school_id=?", school).Scan(&revision) != nil {
		return ""
	}
	return "/api/academy/logo?v=" + revision
}
func (a *app) academyLogo(w http.ResponseWriter, r *http.Request) {
	school, e := a.publicSchool(r)
	if e != nil {
		http.NotFound(w, r)
		return
	}
	var media, revision string
	var data []byte
	if a.db.QueryRowContext(r.Context(), "SELECT media_type,image_data,revision FROM academy_logos WHERE school_id=?", school).Scan(&media, &data, &revision) != nil {
		http.NotFound(w, r)
		return
	}
	if v := r.URL.Query().Get("v"); v != "" && v != revision {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Header().Set("ETag", `"`+revision+`"`)
	if r.Header.Get("If-None-Match") == `"`+revision+`"` {
		w.WriteHeader(304)
		return
	}
	w.Header().Set("Content-Type", media)
	w.Header().Set("Content-Length", fmt.Sprint(len(data)))
	_, _ = w.Write(data)
}
func (a *app) academyLogoManage(w http.ResponseWriter, r *http.Request) {
	if !a.businessAdmin(w, r, "content") {
		return
	}
	u := who(r)
	if r.Method == "GET" {
		url := a.websiteLogoURL(r.Context(), u.School)
		var revision string
		if url != "" {
			_ = a.db.QueryRowContext(r.Context(), "SELECT revision FROM academy_logos WHERE school_id=?", u.School).Scan(&revision)
		}
		send(w, 200, map[string]any{"url": url, "revision": revision})
		return
	}
	var in struct {
		Data     string `json:"image_data"`
		Revision string `json:"revision"`
		Delete   bool   `json:"delete"`
	}
	if !decode(w, r, &in) {
		return
	}
	var data []byte
	media := ""
	if !in.Delete {
		var e error
		data, e = base64.StdEncoding.DecodeString(in.Data)
		if e != nil || len(data) < 1 || len(data) > 512<<10 {
			problem(w, 400, "Logo PNG/JPG tối đa 512 KB")
			return
		}
		cfg, format, e := image.DecodeConfig(bytes.NewReader(data))
		if e != nil || (format != "png" && format != "jpeg") || cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 2048 || cfg.Height > 2048 {
			problem(w, 400, "Logo phải là PNG/JPG hợp lệ, tối đa 2048 × 2048")
			return
		}
		if _, _, e = image.Decode(bytes.NewReader(data)); e != nil {
			problem(w, 400, "Không đọc được ảnh logo")
			return
		}
		media = "image/" + format
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Chưa lưu được logo")
		return
	}
	defer tx.Rollback()
	var school string
	if tx.QueryRowContext(r.Context(), "SELECT id FROM schools WHERE id=? FOR UPDATE", u.School).Scan(&school) != nil {
		problem(w, 404, "Không thấy đơn vị")
		return
	}
	var previous string
	e = tx.QueryRowContext(r.Context(), "SELECT revision FROM academy_logos WHERE school_id=? FOR UPDATE", u.School).Scan(&previous)
	if e != nil && e != sql.ErrNoRows {
		problem(w, 503, "Chưa tải được logo")
		return
	}
	if previous != in.Revision {
		problem(w, 409, "Logo đã thay đổi. Tải lại trước khi lưu")
		return
	}
	revision := ""
	if in.Delete {
		_, e = tx.ExecContext(r.Context(), "DELETE FROM academy_logos WHERE school_id=?", u.School)
	} else {
		revision = digest(string(data))
		_, e = tx.ExecContext(r.Context(), "INSERT INTO academy_logos(school_id,media_type,image_data,revision) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE media_type=VALUES(media_type),image_data=VALUES(image_data),revision=VALUES(revision)", u.School, media, data, revision)
	}
	if e != nil || tx.Commit() != nil {
		problem(w, 503, "Chưa hoàn tất lưu logo")
		return
	}
	a.audit(r, "academy.logo.save", u.School)
	url := ""
	if revision != "" {
		url = "/api/academy/logo?v=" + revision
	}
	send(w, 200, map[string]string{"url": url, "revision": revision})
}
