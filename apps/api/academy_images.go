package main

import (
	"bytes"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"path/filepath"
	"strings"
)

func normalizedWebsitePhoto(data []byte) ([]byte, string, error) {
	cfg, format, e := image.DecodeConfig(bytes.NewReader(data))
	if e != nil || (format != "png" && format != "jpeg") || cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 4096 || cfg.Height > 4096 {
		return nil, "", fmt.Errorf("Chọn ảnh PNG/JPG hợp lệ, tối đa 4096 × 4096")
	}
	img, _, e := image.Decode(bytes.NewReader(data))
	if e != nil {
		return nil, "", fmt.Errorf("Không đọc được ảnh")
	}
	var out bytes.Buffer
	if format == "jpeg" {
		e = jpeg.Encode(&out, img, &jpeg.Options{Quality: 88})
	} else {
		e = png.Encode(&out, img)
	}
	if e != nil || out.Len() > 5<<20 {
		return nil, "", fmt.Errorf("Ảnh sau xử lý vượt quá 5 MB")
	}
	return out.Bytes(), "image/" + format, nil
}
func (a *app) academyImageUpload(w http.ResponseWriter, r *http.Request) {
	if !a.businessAdmin(w, r, "content") {
		return
	}
	u := who(r)
	if r.Method == "GET" {
		a.query(w, r, "SELECT id,filename,CONCAT('/api/academy/images/',id) AS url FROM academy_images WHERE school_id=? ORDER BY created_at DESC LIMIT 200", u.School)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, (5<<20)+(64<<10))
	if e := r.ParseMultipartForm(1 << 20); e != nil {
		problem(w, 400, "Chọn một ảnh PNG/JPG tối đa 5 MB")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	file, header, e := r.FormFile("image")
	if e != nil {
		problem(w, 400, "Chưa chọn ảnh")
		return
	}
	defer file.Close()
	data, e := io.ReadAll(io.LimitReader(file, (5<<20)+1))
	if e != nil || len(data) > 5<<20 {
		problem(w, 400, "Ảnh tối đa 5 MB")
		return
	}
	normalized, media, e := normalizedWebsitePhoto(data)
	if e != nil {
		problem(w, 400, e.Error())
		return
	}
	name := strings.TrimSpace(filepath.Base(strings.ReplaceAll(header.Filename, "\\", "/")))
	if len(name) > 200 {
		name = "website-image"
	}
	id := uid()
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Chưa lưu được ảnh")
		return
	}
	defer tx.Rollback()
	var lock string
	if tx.QueryRowContext(r.Context(), "SELECT id FROM schools WHERE id=? FOR UPDATE", u.School).Scan(&lock) != nil {
		problem(w, 404, "Không thấy đơn vị")
		return
	}
	var total int64
	if tx.QueryRowContext(r.Context(), "SELECT COALESCE(SUM(OCTET_LENGTH(image_data)),0) FROM academy_images WHERE school_id=?", u.School).Scan(&total) != nil || total+int64(len(normalized)) > 300<<20 {
		problem(w, 409, "Thư viện ảnh đạt giới hạn 300 MB")
		return
	}
	if _, e = tx.ExecContext(r.Context(), "INSERT INTO academy_images(id,school_id,media_type,image_data,filename) VALUES(?,?,?,?,?)", id, u.School, media, normalized, name); e != nil || tx.Commit() != nil {
		problem(w, 503, "Chưa lưu được ảnh")
		return
	}
	a.audit(r, "academy.image.upload", id)
	send(w, 201, map[string]string{"id": id, "url": "/api/academy/images/" + id})
}
func (a *app) academyImage(w http.ResponseWriter, r *http.Request) {
	school, e := a.publicSchool(r)
	if e != nil {
		http.NotFound(w, r)
		return
	}
	var media string
	var data []byte
	if a.db.QueryRowContext(r.Context(), "SELECT media_type,image_data FROM academy_images WHERE school_id=? AND id=?", school, r.PathValue("image")).Scan(&media, &data) != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", media)
	w.Header().Set("Content-Length", fmt.Sprint(len(data)))
	w.Header().Set("Cache-Control", "public,max-age=86400,immutable")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(data)
}
