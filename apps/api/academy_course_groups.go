package main

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
)

type academyCourseGroup struct {
	Title   string
	Grade   int
	Courses []webCourse
}

var academyGradeSuffix = regexp.MustCompile(`(?i)\s*(?:[–—-]\s*)?(?:lớp|khối)\s+([0-9]{1,2})\s*$`)

func academyCourseGroups(courses []webCourse) []academyCourseGroup {
	groups := map[int][]webCourse{}
	for _, c := range courses {
		grade := 0
		c.Subject = c.Title
		if match := academyGradeSuffix.FindStringSubmatchIndex(c.Title); match != nil {
			n, _ := strconv.Atoi(c.Title[match[2]:match[3]])
			subject := strings.TrimSpace(c.Title[:match[0]])
			if n >= 1 && n <= 12 && subject != "" {
				grade = n
				c.Subject = subject
			}
		}
		groups[grade] = append(groups[grade], c)
	}
	result := []academyCourseGroup{}
	order := map[string]int{"toán": 0, "vật lí": 1, "vật lý": 1, "lý": 1, "hóa học": 2, "hoá học": 2, "hóa": 2, "ngữ văn": 3, "văn": 3, "tiếng anh": 4, "anh": 4}
	for grade := 1; grade <= 12; grade++ {
		if list := groups[grade]; len(list) > 0 {
			sort.SliceStable(list, func(i, j int) bool {
				a, ok := order[strings.ToLower(list[i].Subject)]
				if !ok {
					a = 99
				}
				b, ok := order[strings.ToLower(list[j].Subject)]
				if !ok {
					b = 99
				}
				if a != b {
					return a < b
				}
				if list[i].Subject != list[j].Subject {
					return list[i].Subject < list[j].Subject
				}
				return list[i].ID < list[j].ID
			})
			result = append(result, academyCourseGroup{Title: "Khối " + strconv.Itoa(grade), Grade: grade, Courses: list})
		}
	}
	if list := groups[0]; len(list) > 0 {
		result = append(result, academyCourseGroup{Title: "Khóa học khác", Courses: list})
	}
	return result
}
