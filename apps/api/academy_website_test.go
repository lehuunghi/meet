package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAcademyWebsiteDesignAndEscaping(t *testing.T) {
	site := academySite{Headline: "VA Academy", Description: "Khóa học trực tuyến, lớp Live và bài giảng xem lại.", Published: true}
	data := map[string]any{"Site": site, "Courses": []webCourse{}, "Plans": []webPlan{}, "Free": 4, "Canonical": "https://academy.example.test/", "Post": nil}
	var html bytes.Buffer
	if err := academyWeb.Execute(&html, data); err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"Học thử miễn phí", "Khóa học đầu tiên đang được chuẩn bị", "/dang-ky", "Đến nội dung chính"} {
		if !strings.Contains(html.String(), text) {
			t.Fatalf("missing %s", text)
		}
	}
	if dir := os.Getenv("MEET_WEBSITE_PREVIEW_DIR"); dir != "" {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "academy-home-empty.html"), html.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}
		data["Courses"] = []webCourse{{Title: "Khóa học minh họa · Toán nền tảng", Description: "Nội dung minh họa cho kiểm tra giao diện, không phải khóa học đã công bố.", Teacher: "Giáo viên minh họa"}, {Title: "Khóa học minh họa · Tiếng Anh", Description: "Luyện tập theo lộ trình và ôn tập bài học.", Teacher: "Giáo viên minh họa"}, {Title: "Khóa học minh họa · Khoa học", Description: "Khám phá kiến thức trong một không gian học tập.", Teacher: "Giáo viên minh họa"}}
		data["Plans"] = []webPlan{{Name: "Gói minh họa", Price: 299000, Days: 30, Live: true}}
		html.Reset()
		if err := academyWeb.Execute(&html, data); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "academy-home-filled.html"), html.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}
	}
	site.Headline = "<script>alert('xss')</script>"
	data["Site"] = site
	html.Reset()
	if err := academyWeb.Execute(&html, data); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(html.String(), "<script>alert") || !strings.Contains(html.String(), "&lt;script&gt;") {
		t.Fatal("unescaped CMS headline")
	}
	site.Published = false
	data["Site"] = site
	html.Reset()
	if err := academyWeb.Execute(&html, data); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(html.String(), "Học thử miễn phí") || strings.Contains(html.String(), "Khóa học minh họa") {
		t.Fatal("draft website exposed published content")
	}
}

func TestSubjectArtworkDoesNotConfuseKhoaHocWithHoaHoc(t *testing.T) {
	for title, name := range map[string]string{"Khóa Tiếng Anh": "english", "Khóa học minh họa · Khoa học": "learning", "Hóa học – Lớp 10": "chemistry", "Hoá – Lớp 11": "chemistry", "Toán 12": "math", "Ngữ văn 11": "literature", "Vật lí 10": "physics"} {
		if got := academySubjectArt(title); got != "/images/"+name+".svg" {
			t.Errorf("%s: %s", title, got)
		}
	}
}

func TestWebsiteMediaSamplesAndFAQ(t *testing.T) {
	yes := true
	site := academySite{Headline: "VA", Published: true, HeroImage: "/images/va-online-learning-v1.webp", AboutImage: "/images/va-study-desk-v1.webp", FAQs: []academyFAQ{{Question: "VIP dùng cho khóa nào?", Answer: "Toàn bộ danh mục đã xuất bản."}}, Teachers: []academyTeacher{{Name: "Giáo viên mẫu", Image: "/images/teacher-math-v1.webp", Sample: true, Published: &yes}}, Testimonials: []academyTestimonial{{Name: "Học sinh mẫu", Text: "Nội dung minh họa", Image: "/images/review-student-male-v1.webp", Sample: true, Rating: 5, Published: &yes}}, Posts: []academyPost{{Slug: "bai-hoc", Title: "Bài học", Image: "/images/article-math-v1.webp", Published: true}}}
	if !validWebsiteMedia(site) {
		t.Fatal("valid media rejected")
	}
	var out bytes.Buffer
	if e := academyWeb.Execute(&out, map[string]any{"Site": site, "Free": 4, "HasPosts": true}); e != nil {
		t.Fatal(e)
	}
	for _, expected := range []string{"hero-photo", "about-editorial", "post-cover", "VIP dùng cho khóa nào?"} {
		if !strings.Contains(out.String(), expected) {
			t.Fatal("missing media", expected)
		}
	}
	if strings.Contains(out.String(), "5 / 5") || strings.Contains(out.String(), "Học sinh mẫu") || strings.Contains(out.String(), "Giáo viên mẫu") {
		t.Fatal("sample review presented as a real rating")
	}
	for _, bad := range []string{"javascript:alert(1)", "data:image/svg+xml,bad", "//tracking.example/face.jpg", "http://insecure.example/x.jpg", "https://user:pass@example.com/x.jpg", "/images/../private.png"} {
		site.HeroImage = bad
		if validWebsiteMedia(site) {
			t.Fatal("unsafe image", bad)
		}
	}
}
