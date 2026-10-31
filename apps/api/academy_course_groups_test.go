package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAcademyGradeRows(t *testing.T) {
	courses := []webCourse{}
	subjects := []string{"Toán", "Vật lí", "Hóa học", "Ngữ văn", "Tiếng Anh"}
	for grade := 12; grade >= 10; grade-- {
		for i := 4; i >= 0; i-- {
			courses = append(courses, webCourse{ID: fmt.Sprintf("grade-%d-subject-%d", grade, i), Title: fmt.Sprintf("%s – Lớp %d", subjects[i], grade), Description: "Nội dung minh họa dành riêng cho kiểm thử bố cục. Bài giảng và lịch được công bố theo từng lớp."})
		}
	}
	groups := academyCourseGroups(courses)
	if len(groups) != 3 {
		t.Fatal("missing grade groups")
	}
	for i, g := range groups {
		if g.Grade != i+10 || len(g.Courses) != 5 {
			t.Fatal("wrong grade/order/count")
		}
		for n, c := range g.Courses {
			if c.Subject != subjects[n] {
				t.Fatal("wrong subject order", c.Subject)
			}
		}
	}
	if courses[0].Subject != "" {
		t.Fatal("grouping mutated input")
	}
	data := map[string]any{"Site": academySite{Headline: "VA Academy", Published: true}, "Courses": courses, "Free": 4}
	var html bytes.Buffer
	if e := academyWeb.Execute(&html, data); e != nil {
		t.Fatal(e)
	}
	if strings.Count(html.String(), `class="grade-course-group"`) != 3 || strings.Count(html.String(), `role="listitem"`) != 15 {
		t.Fatal("wrong rendered group/card count")
	}
	if !strings.Contains(html.String(), `tabindex="0"`) || !strings.Contains(html.String(), "Vuốt ngang để xem thêm môn") {
		t.Fatal("missing carousel accessibility/hint")
	}
	for _, c := range courses {
		if !strings.Contains(html.String(), `/khoa-hoc/`+c.ID) {
			t.Fatal("lost course link")
		}
	}
	if dir := os.Getenv("MEET_WEBSITE_PREVIEW_DIR"); dir != "" {
		if e := os.MkdirAll(dir, 0755); e != nil {
			t.Fatal(e)
		}
		if e := os.WriteFile(filepath.Join(dir, "academy-grade-rows.html"), html.Bytes(), 0644); e != nil {
			t.Fatal(e)
		}
	}
	other := academyCourseGroups([]webCourse{{Title: "Nội dung khác"}, {Title: "Toán — Khối 6"}, {Title: "Lớp 13"}})
	if len(other) != 2 || other[0].Grade != 6 || len(other[1].Courses) != 2 {
		t.Fatal("lost ungrouped/future courses")
	}
}
