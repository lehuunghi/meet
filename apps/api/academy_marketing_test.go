package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAcademyCourseAndPolicyTemplates(t *testing.T) {
	site := academySite{Headline: "VA Academy", Published: true, Description: "Nội dung minh họa để kiểm tra", About: "Thông tin đơn vị do quản trị nhập", ContactEmail: "support@example.test", Privacy: "Chính sách minh họa <script>không thực thi</script>"}
	course := webCourse{ID: "course-preview", Title: "Toán nền tảng · Minh họa", Description: "Khóa học minh họa cho kiểm tra bố cục, không phải khóa đã công bố.", Teacher: "Giáo viên minh họa", LessonTitles: []string{"Bài 01: Hàm số", "Bài 02: <script>không thực thi</script>"}, Page: academyCoursePage{Audience: "Học sinh lớp 10", Objectives: "Hiểu kiến thức\nVận dụng", Outline: "Phần một\nPhần hai", Schedule: "Lịch do trung tâm công bố", PreviewLesson: "preview-lesson"}}
	data := map[string]any{"Site": site, "Course": course, "Courses": []webCourse{course}, "Plans": []webPlan{}, "Free": 4, "Canonical": "https://academy.example/khoa-hoc/course-preview", "HasPosts": false}
	var out bytes.Buffer
	if err := academyWeb.Execute(&out, data); err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"Danh sách bài giảng", "Bài 01: Hàm số", "Bài 02: &lt;script&gt;không thực thi&lt;/script&gt;", "Khóa học dành cho ai?", "Vận dụng", "/hoc/khoa-hoc/course-preview", "/hoc/bai-giang/preview-lesson", "/chinh-sach/bao-mat"} {
		if !strings.Contains(out.String(), text) {
			t.Fatalf("missing %s", text)
		}
	}
	outline := strings.Split(strings.Split(out.String(), `class="course-lesson-outline"`)[1], "</section>")[0]
	if strings.Contains(outline, "<a ") || strings.Contains(outline, "<video") || strings.Contains(outline, "<script>") {
		t.Fatal("public lesson titles must be inert escaped text")
	}
	if strings.Contains(out.String(), `id="tin-tuc"`) {
		t.Fatal("empty news section should be hidden")
	}
	if dir := os.Getenv("MEET_WEBSITE_PREVIEW_DIR"); dir != "" {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "academy-course.html"), out.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}
	}
	data["Course"] = nil
	data["Policy"] = map[string]string{"Title": "Chính sách minh họa", "Body": site.Privacy}
	out.Reset()
	if err := academyWeb.Execute(&out, data); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.String(), "<script>") || !strings.Contains(out.String(), "&lt;script&gt;") {
		t.Fatal("policy must escape HTML")
	}
}
