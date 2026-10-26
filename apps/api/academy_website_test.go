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
	for _, text := range []string{"Học thử miễn phí", "Minh họa giao diện", "Khóa học đầu tiên đang được chuẩn bị", "/hoc?register=1", "Đến nội dung chính"} {
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
