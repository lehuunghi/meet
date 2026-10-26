package main

import (
	_ "embed"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"html/template"
	"net/http"
	"regexp"
	"strings"
)

type academySite struct {
	Headline     string                                `json:"headline"`
	Description  string                                `json:"description"`
	Published    bool                                  `json:"published"`
	Teachers     []struct{ Name, Subject, Bio string } `json:"teachers"`
	Testimonials []struct {
		Name, Text string
		Rating     int
	} `json:"testimonials"`
	Posts []academyPost `json:"posts"`
}
type academyPost struct {
	Slug, Title, Summary, Body string
	Published                  bool
}
type webCourse struct{ ID, Title, Description, Teacher string }
type webPlan struct {
	Name  string
	Price int64
	Days  int
	Live  bool
}

//go:embed academy_site.html
var academySiteHTML string

var academyWeb = template.Must(template.New("site").Funcs(template.FuncMap{"price": func(v int64) string {
	text := fmt.Sprintf("%d", v)
	for i := len(text) - 3; i > 0; i -= 3 {
		text = text[:i] + "." + text[i:]
	}
	return text + " ₫"
}}).Parse(academySiteHTML))

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
		rows, e := a.db.QueryContext(r.Context(), "SELECT id,title,description,teacher_name FROM academy_courses WHERE school_id=? AND published=TRUE ORDER BY created_at DESC LIMIT 24", school)
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
		prices, e := a.db.QueryContext(r.Context(), "SELECT name,price_vnd,days,live_enabled FROM academy_plans WHERE school_id=? AND active=TRUE ORDER BY price_vnd LIMIT 12", school)
		if e == nil {
			for prices.Next() {
				var p webPlan
				if prices.Scan(&p.Name, &p.Price, &p.Days, &p.Live) == nil {
					plans = append(plans, p)
				}
			}
			prices.Close()
		}
	}
	cfg, _ := loadSettings()
	free := cfg.Commerce.FreeVideos
	if free == 0 {
		free = 4
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=60")
	_ = academyWeb.Execute(w, map[string]any{"Site": site, "Courses": courses, "Plans": plans, "Free": free, "Canonical": canonical, "Post": post})
}
func (a *app) academySitemap(w http.ResponseWriter, r *http.Request) {
	if !academyEnabled() {
		http.NotFound(w, r)
		return
	}
	_, site, e := a.websiteData(r)
	if e != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`))
	locations := []string{a.origin + "/"}
	if site.Published {
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
