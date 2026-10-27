package main

import (
	"bytes"
	"encoding/json"
	"net/http"
)

// Render unsaved content only for an authenticated content administrator. No
// preview token, public draft URL, storage write or publication side effect.
func (a *app) academySitePreview(w http.ResponseWriter, r *http.Request) {
	if !a.businessAdmin(w, r, "content") {
		return
	}
	var in struct {
		Content json.RawMessage `json:"content"`
		Post    *int            `json:"post"`
		Course  string          `json:"course"`
		Policy  string          `json:"policy"`
	}
	if !decode(w, r, &in) {
		return
	}
	var site academySite
	if len(in.Content) > 100000 || json.Unmarshal(in.Content, &site) != nil {
		problem(w, 400, "Nội dung xem trước không hợp lệ")
		return
	}
	site.Published = true
	for i := range site.Teachers {
		site.Teachers[i].Published = nil
	}
	for i := range site.Testimonials {
		site.Testimonials[i].Published = nil
	}
	hasPosts := false
	for i := range site.Posts {
		site.Posts[i].Published = true
		hasPosts = true
	}
	u := who(r)
	courses := []webCourse{}
	plans := []webPlan{}
	rows, e := a.db.QueryContext(r.Context(), "SELECT id,title,description,teacher_name FROM academy_courses WHERE school_id=? ORDER BY created_at DESC LIMIT 200", u.School)
	if e != nil {
		problem(w, 503, "Chưa tải được khóa học để xem trước")
		return
	}
	for rows.Next() {
		var c webCourse
		if e = rows.Scan(&c.ID, &c.Title, &c.Description, &c.Teacher); e != nil {
			rows.Close()
			problem(w, 503, "Chưa đọc được khóa học")
			return
		}
		c.Page = site.CoursePages[c.ID]
		courses = append(courses, c)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		problem(w, 503, "Chưa đọc xong khóa học")
		return
	}
	prices, e := a.db.QueryContext(r.Context(), "SELECT id,name,price_vnd,days,live_enabled FROM academy_plans WHERE school_id=? AND active=TRUE ORDER BY price_vnd LIMIT 12", u.School)
	if e != nil {
		problem(w, 503, "Chưa tải được gói học")
		return
	}
	for prices.Next() {
		var p webPlan
		if e = prices.Scan(&p.ID, &p.Name, &p.Price, &p.Days, &p.Live); e != nil {
			prices.Close()
			problem(w, 503, "Chưa đọc được gói học")
			return
		}
		plans = append(plans, p)
	}
	e = prices.Err()
	prices.Close()
	if e != nil {
		problem(w, 503, "Chưa đọc xong gói học")
		return
	}
	cfg, _ := loadSettings()
	free := cfg.Commerce.FreeVideos
	if free == 0 {
		free = 4
	}
	data := map[string]any{"Site": site, "Courses": courses, "Plans": plans, "Free": free, "Canonical": a.origin + "/", "HasPosts": hasPosts}
	if in.Post != nil {
		if *in.Post < 0 || *in.Post >= len(site.Posts) {
			problem(w, 400, "Không tìm thấy bài viết trong bản nháp")
			return
		}
		data["Post"] = &site.Posts[*in.Post]
	}
	if in.Course != "" {
		var chosen *webCourse
		for i := range courses {
			if courses[i].ID == in.Course {
				chosen = &courses[i]
				break
			}
		}
		if chosen == nil {
			problem(w, 404, "Không tìm thấy khóa học của đơn vị")
			return
		}
		chosen.LessonTitles, e = a.publicLessonTitles(r, u.School, chosen.ID)
		if e != nil {
			problem(w, 503, "Chưa tải được danh sách bài giảng")
			return
		}
		chosen.Page.PreviewLesson = ""
		data["Course"] = chosen
	}
	if in.Policy != "" {
		titles := map[string]string{"terms": "Điều khoản sử dụng", "privacy": "Chính sách bảo mật", "refund": "Thanh toán & hoàn phí"}
		bodies := map[string]string{"terms": site.Terms, "privacy": site.Privacy, "refund": site.Refund}
		title, ok := titles[in.Policy]
		if !ok {
			problem(w, 400, "Không tìm thấy trang chính sách")
			return
		}
		data["Policy"] = map[string]string{"Title": title, "Body": bodies[in.Policy]}
	}
	var html bytes.Buffer
	if e = academyWeb.Execute(&html, data); e != nil {
		problem(w, 503, "Chưa dựng được bản xem trước")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")
	send(w, 200, map[string]string{"html": html.String()})
}
