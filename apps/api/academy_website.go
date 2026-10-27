package main

import (
	_ "embed"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"html/template"
	"io"
	"net/http"
	"regexp"
	"strings"
)

type academyCoursePage struct {
	Audience      string `json:"audience"`
	Objectives    string `json:"objectives"`
	Outline       string `json:"outline"`
	Schedule      string `json:"schedule"`
	PreviewLesson string `json:"preview_lesson"`
}
type academySite struct {
	About            string                       `json:"about"`
	ContactEmail     string                       `json:"contact_email"`
	ContactPhone     string                       `json:"contact_phone"`
	Address          string                       `json:"address"`
	Terms            string                       `json:"terms"`
	Privacy          string                       `json:"privacy"`
	Refund           string                       `json:"refund"`
	CoursePages      map[string]academyCoursePage `json:"course_pages"`
	Headline         string                       `json:"headline"`
	Description      string                       `json:"description"`
	Published        bool                         `json:"published"`
	ShowTeachers     bool                         `json:"show_teachers"`
	ShowTestimonials bool                         `json:"show_testimonials"`
	Teachers         []academyTeacher             `json:"teachers"`
	Testimonials     []academyTestimonial         `json:"testimonials"`
	Posts            []academyPost                `json:"posts"`
}
type academyTeacher struct {
	Name, Subject, Bio string
	Published          *bool
}
type academyTestimonial struct {
	Name, Text, Audience string
	Rating               int
	Published            *bool
}

func visibleProfile(published *bool) bool { return published == nil || *published }
func (s academySite) PublicTeachers() []academyTeacher {
	out := []academyTeacher{}
	for _, t := range s.Teachers {
		if s.Published && visibleProfile(t.Published) && strings.TrimSpace(t.Name) != "" {
			out = append(out, t)
		}
	}
	return out
}
func (s academySite) PublicTestimonials() []academyTestimonial {
	out := []academyTestimonial{}
	for _, t := range s.Testimonials {
		if s.Published && visibleProfile(t.Published) && strings.TrimSpace(t.Name) != "" && strings.TrimSpace(t.Text) != "" {
			out = append(out, t)
		}
	}
	return out
}

type academyPost struct {
	Slug, Title, Summary, Body string
	Published                  bool
}
type webCourse struct {
	ID, Title, Description, Teacher, Subject string
	Page                                     academyCoursePage
	LessonTitles                             []string
}
type webPlan struct {
	ID    string
	Name  string
	Price int64
	Days  int
	Live  bool
}

//go:embed academy_site.html
var academySiteHTML string

type localizedWebsite struct{ base *template.Template }

func (t localizedWebsite) Execute(w io.Writer, data any) error {
	c, e := t.base.Clone()
	if e != nil {
		return e
	}
	var texts map[string]string
	if d, ok := data.(map[string]any); ok {
		texts, _ = d["UITexts"].(map[string]string)
	}
	c = c.Funcs(template.FuncMap{"ui": func(s string) string {
		if v, ok := texts[s]; ok {
			return v
		}
		return s
	}})
	return c.Execute(w, data)
}

var academyWeb = localizedWebsite{template.Must(template.New("site").Funcs(template.FuncMap{"ui": func(s string) string { return s }, "courseGroups": academyCourseGroups, "lines": func(s string) []string {
	out := []string{}
	for _, v := range strings.Split(s, "\n") {
		if v = strings.TrimSpace(v); v != "" {
			out = append(out, v)
		}
	}
	return out
}, "price": func(v int64) string {
	text := fmt.Sprintf("%d", v)
	for i := len(text) - 3; i > 0; i -= 3 {
		text = text[:i] + "." + text[i:]
	}
	return text + " ₫"
}}).Parse(academySiteHTML))}

func (a *app) websiteData(r *http.Request) (string, academySite, error) {
	school, e := a.publicSchool(r)
	var site academySite
	if e != nil {
		return "", site, e
	}
	var raw string
	if a.db.QueryRowContext(r.Context(), "SELECT content FROM academy_site WHERE school_id=?", school).Scan(&raw) == nil {
		_ = json.Unmarshal([]byte(raw), &site)
	}
	if site.Headline == "" {
		site.Headline = "Học trực tuyến cùng giáo viên"
	}
	if !site.Published {
		site.Teachers = nil
		site.Testimonials = nil
		site.Posts = nil
	}
	return school, site, nil
}
func (a *app) academyWebsite(w http.ResponseWriter, r *http.Request) {
	if !academyEnabled() {
		w.WriteHeader(418)
		return
	}
	school, site, e := a.websiteData(r)
	if e != nil {
		problem(w, 503, "Trung tâm đang khởi tạo")
		return
	}
	var post *academyPost
	canonical := a.origin + "/"
	if slug := r.PathValue("slug"); slug != "" {
		if !regexp.MustCompile(`^[a-z0-9-]{1,100}$`).MatchString(slug) {
			http.NotFound(w, r)
			return
		}
		for i := range site.Posts {
			if site.Posts[i].Slug == slug && site.Posts[i].Published {
				post = &site.Posts[i]
			}
		}
		if post == nil {
			http.NotFound(w, r)
			return
		}
		canonical = a.origin + "/bai-viet/" + slug
	}
	courses := []webCourse{}
	plans := []webPlan{}
	if site.Published {
		rows, e := a.db.QueryContext(r.Context(), "SELECT id,title,description,teacher_name FROM academy_courses WHERE school_id=? AND published=TRUE ORDER BY created_at DESC LIMIT 200", school)
		if e != nil {
			problem(w, 503, "Chưa tải được nội dung")
			return
		}
		for rows.Next() {
			var c webCourse
			if rows.Scan(&c.ID, &c.Title, &c.Description, &c.Teacher) == nil {
				courses = append(courses, c)
			}
		}
		rows.Close()
		prices, e := a.db.QueryContext(r.Context(), "SELECT id,name,price_vnd,days,live_enabled FROM academy_plans WHERE school_id=? AND active=TRUE ORDER BY price_vnd LIMIT 12", school)
		if e == nil {
			for prices.Next() {
				var p webPlan
				if prices.Scan(&p.ID, &p.Name, &p.Price, &p.Days, &p.Live) == nil {
					plans = append(plans, p)
				}
			}
			prices.Close()
		}
	}
	var course *webCourse
	if id := r.PathValue("course"); id != "" {
		if !site.Published {
			http.NotFound(w, r)
			return
		}
		var c webCourse
		if a.db.QueryRowContext(r.Context(), "SELECT id,title,description,teacher_name FROM academy_courses WHERE school_id=? AND id=? AND published=TRUE", school, id).Scan(&c.ID, &c.Title, &c.Description, &c.Teacher) != nil {
			http.NotFound(w, r)
			return
		}
		c.Page = site.CoursePages[c.ID]
		if c.Page.PreviewLesson != "" {
			var n int
			if a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM academy_lessons WHERE school_id=? AND course_id=? AND id=? AND status='ready'", school, c.ID, c.Page.PreviewLesson).Scan(&n) != nil || n != 1 {
				c.Page.PreviewLesson = ""
			}
		}
		c.LessonTitles, e = a.publicLessonTitles(r, school, c.ID)
		if e != nil {
			problem(w, 503, "Chưa tải được danh sách bài giảng")
			return
		}
		course = &c
		canonical = a.origin + "/khoa-hoc/" + c.ID
	}
	var policy map[string]string
	if kind := r.PathValue("policy"); kind != "" {
		body, title := "", ""
		switch kind {
		case "dieu-khoan":
			body, title = site.Terms, "Điều khoản sử dụng"
		case "bao-mat":
			body, title = site.Privacy, "Chính sách bảo mật"
		case "thanh-toan-hoan-phi":
			body, title = site.Refund, "Thanh toán và hoàn phí"
		}
		if !site.Published || strings.TrimSpace(body) == "" {
			http.NotFound(w, r)
			return
		}
		policy = map[string]string{"Title": title, "Body": body}
		canonical = a.origin + "/chinh-sach/" + kind
	}
	cfg, _ := loadSettings()
	free := cfg.Commerce.FreeVideos
	if free == 0 {
		free = 4
	}
	hasPosts := false
	for _, v := range site.Posts {
		if v.Published {
			hasPosts = true
		}
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=60")
	_ = academyWeb.Execute(w, map[string]any{"UITexts": a.uiTexts(r.Context(), school), "Site": site, "Courses": courses, "Plans": plans, "Free": free, "Canonical": canonical, "Post": post, "Course": course, "Policy": policy, "HasPosts": hasPosts})
}
func (a *app) academySitemap(w http.ResponseWriter, r *http.Request) {
	if !academyEnabled() {
		http.NotFound(w, r)
		return
	}
	school, site, e := a.websiteData(r)
	if e != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`))
	locations := []string{a.origin + "/"}
	if site.Published {
		rows, err := a.db.QueryContext(r.Context(), "SELECT id FROM academy_courses WHERE school_id=? AND published=TRUE ORDER BY created_at DESC LIMIT 1000", school)
		if err == nil {
			for rows.Next() {
				var id string
				if rows.Scan(&id) == nil {
					locations = append(locations, a.origin+"/khoa-hoc/"+id)
				}
			}
			rows.Close()
		}
		for _, p := range []struct{ key, body string }{{"dieu-khoan", site.Terms}, {"bao-mat", site.Privacy}, {"thanh-toan-hoan-phi", site.Refund}} {
			if strings.TrimSpace(p.body) != "" {
				locations = append(locations, a.origin+"/chinh-sach/"+p.key)
			}
		}
		for _, post := range site.Posts {
			if post.Published && regexp.MustCompile(`^[a-z0-9-]{1,100}$`).MatchString(post.Slug) {
				locations = append(locations, a.origin+"/bai-viet/"+post.Slug)
			}
		}
	}
	for _, location := range locations {
		_, _ = w.Write([]byte("<url><loc>"))
		_ = xml.EscapeText(w, []byte(location))
		_, _ = w.Write([]byte("</loc></url>"))
	}
	_, _ = w.Write([]byte("</urlset>"))
}
func (a *app) academyRobots(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte("User-agent: *\nDisallow: /api/\nDisallow: /hoc\nSitemap: " + strings.TrimRight(a.origin, "/") + "/sitemap.xml\n"))
}

// Public outlines contain titles only; playback identifiers and storage data stay authenticated.
func (a *app) publicLessonTitles(r *http.Request, school, course string) ([]string, error) {
	rows, err := a.db.QueryContext(r.Context(), "SELECT title FROM academy_lessons WHERE school_id=? AND course_id=? AND status='ready' ORDER BY position,created_at,id", school, course)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	titles := []string{}
	for rows.Next() {
		var title string
		if err = rows.Scan(&title); err != nil {
			return nil, err
		}
		titles = append(titles, title)
	}
	return titles, rows.Err()
}
