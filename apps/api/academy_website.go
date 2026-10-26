package main

import (
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

var academyWeb = template.Must(template.New("site").Funcs(template.FuncMap{"price": func(v int64) string { return fmt.Sprintf("%d đ", v) }}).Parse(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{if .Post}}{{.Post.Title}}{{else}}{{.Site.Headline}}{{end}}</title><meta name="description" content="{{if .Post}}{{.Post.Summary}}{{else}}{{.Site.Description}}{{end}}"><link rel="canonical" href="{{.Canonical}}"><link rel="stylesheet" href="/academy-site.css"><meta property="og:title" content="{{.Site.Headline}}"><meta property="og:description" content="{{.Site.Description}}"></head><body><nav><a class="brand" href="/">HỌC ACADEMY</a><div><a href="/#khoa-hoc">Khóa học</a><a href="/#bang-gia">Học phí</a><a href="/#tin-tuc">Góc học tập</a><a class="button" href="/hoc">Đăng nhập</a></div></nav>{{if .Post}}<main class="article"><a href="/">← Trang chủ</a><h1>{{.Post.Title}}</h1><p>{{.Post.Summary}}</p><div class="article-body">{{.Post.Body}}</div></main>{{else}}<main><section class="hero"><small>HỌC CÓ LỘ TRÌNH · GIÁO VIÊN ĐỒNG HÀNH</small><h1>{{.Site.Headline}}</h1><p>{{.Site.Description}}</p>{{if .Site.Published}}<div class="actions"><a class="button primary" href="/hoc?register=1">Học thử miễn phí</a><a class="button" href="#bang-gia">Đăng ký VIP</a></div>{{else}}<p>Trung tâm đang hoàn thiện nội dung. Vui lòng quay lại sau.</p>{{end}}</section>{{if .Site.Published}}<section id="khoa-hoc"><div class="section-title"><small>KHÓA HỌC</small><h2>Chọn hành trình học của bạn</h2></div><div class="cards">{{range .Courses}}<article><span class="course-symbol">◈</span><h3>{{.Title}}</h3><p>{{.Description}}</p><small>{{.Teacher}}</small><a href="/hoc">Khám phá khóa học →</a></article>{{else}}<p>Các khóa học sẽ được công bố sớm.</p>{{end}}</div></section><section id="bang-gia"><div class="section-title"><small>HỌC PHÍ MINH BẠCH</small><h2>Bắt đầu miễn phí, nâng cấp khi sẵn sàng</h2></div><div class="cards"><article><h3>Học thử</h3><strong class="price">Miễn phí</strong><p>{{.Free}} bài học khác nhau mỗi tháng. Xem lại các bài đã chọn trong tháng.</p><p>Chưa bao gồm lớp Live và bài tập VIP.</p><a class="button" href="/hoc?register=1">Tạo tài khoản</a></article>{{range .Plans}}<article class="plan"><h3>{{.Name}}</h3><strong class="price">{{price .Price}}</strong><p>{{.Days}} ngày học · {{if .Live}}Có lớp Live{{else}}Kho bài giảng xem lại{{end}}</p><p>Xem video trong danh mục trung tâm, theo dõi tiến độ và làm bài tập.</p><a class="button primary" href="/hoc">Chọn gói học</a></article>{{end}}</div></section>{{if .Site.Teachers}}<section><div class="section-title"><small>ĐỘI NGŨ GIÁO VIÊN</small><h2>Người đồng hành trên hành trình học</h2></div><div class="cards">{{range .Site.Teachers}}<article><h3>{{.Name}}</h3><small>{{.Subject}}</small><p>{{.Bio}}</p></article>{{end}}</div></section>{{end}}{{if .Site.Testimonials}}<section><h2>Chia sẻ từ học viên</h2><div class="cards">{{range .Site.Testimonials}}<article><blockquote>{{.Text}}</blockquote><strong>{{.Name}}</strong><p>{{.Rating}} / 5</p></article>{{end}}</div></section>{{end}}<section id="tin-tuc"><div class="section-title"><small>GÓC HỌC TẬP</small><h2>Kiến thức và lịch khai giảng</h2></div><div class="cards">{{range .Site.Posts}}{{if .Published}}<article><h3><a href="/bai-viet/{{.Slug}}">{{.Title}}</a></h3><p>{{.Summary}}</p></article>{{end}}{{else}}<p>Bài viết mới sẽ được cập nhật tại đây.</p>{{end}}</div></section>{{end}}</main>{{end}}<footer>Học tập chủ động, tiến bộ bền vững. <a href="/hoc">Cổng học viên</a></footer></body></html>`))

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
