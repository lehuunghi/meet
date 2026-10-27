package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestAcademyProfileDraftsAndEmptySections(t *testing.T) {
	no := false
	yes := true
	site := academySite{Published: true, ShowTeachers: true, ShowTestimonials: true,
		Teachers:     []academyTeacher{{Name: "PRIVATE-DRAFT-TEACHER", Published: &no}},
		Testimonials: []academyTestimonial{{Name: "PRIVATE-DRAFT-REVIEW", Text: "PRIVATE-DRAFT-TEXT", Published: &no}}}
	data := map[string]any{"Site": site, "Free": 4}
	var html bytes.Buffer
	if e := academyWeb.Execute(&html, data); e != nil {
		t.Fatal(e)
	}
	for _, text := range []string{`id="giao-vien"`, `id="cam-nhan"`, "Hồ sơ giáo viên đang được cập nhật"} {
		if strings.Contains(html.String(), text) {
			t.Fatal("empty profile section exposed", text)
		}
	}
	if strings.Contains(html.String(), "PRIVATE-DRAFT") {
		t.Fatal("draft leaked")
	}
	site.Teachers = append(site.Teachers, academyTeacher{Name: "Giáo viên <script>minh họa</script>", Published: &yes})
	site.Testimonials = append(site.Testimonials, academyTestimonial{Name: "Phụ huynh minh họa", Text: "Nhận xét thử <script>không thực thi</script>", Audience: "parent", Published: &yes})
	data["Site"] = site
	html.Reset()
	if e := academyWeb.Execute(&html, data); e != nil {
		t.Fatal(e)
	}
	if strings.Contains(html.String(), "PRIVATE-DRAFT") || strings.Contains(html.String(), "<script>") || strings.Contains(html.String(), "0 / 5") {
		t.Fatal("draft, unescaped HTML or invented rating")
	}
	if !strings.Contains(html.String(), "Phụ huynh minh họa") || !strings.Contains(html.String(), "&lt;script&gt;") {
		t.Fatal("missing approved content")
	}
	site.Published = false
	data["Site"] = site
	html.Reset()
	if e := academyWeb.Execute(&html, data); e != nil {
		t.Fatal(e)
	}
	if strings.Contains(html.String(), `id="giao-vien"`) || strings.Contains(html.String(), `id="cam-nhan"`) {
		t.Fatal("unpublished website showed profile sections")
	}
}
