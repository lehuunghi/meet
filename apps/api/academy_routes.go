package main

import (
	"net/http"
	"regexp"
)

type managedAcademyKey struct{}

func academyManagedPath(method, path string) bool {
	return (method == "GET" && regexp.MustCompile(`^/api/academy/(admin/(courses|plans|orders|students)|site|finance|orders/[a-zA-Z0-9-]{1,36}/receipt)$`).MatchString(path)) || (method == "POST" && regexp.MustCompile(`^/api/academy/(site|courses|plans|finance|orders/[a-zA-Z0-9-]{1,36}/review)$`).MatchString(path))
}

func (a *app) academyRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /website", a.academyWebsite)
	m.HandleFunc("GET /bai-viet/{slug}", a.academyWebsite)
	m.HandleFunc("GET /sitemap.xml", a.academySitemap)
	m.HandleFunc("GET /robots.txt", a.academyRobots)
	public := func(pattern string, h http.HandlerFunc) { m.HandleFunc(pattern, a.academy(h)) }
	member := func(pattern string, h http.HandlerFunc) {
		m.HandleFunc(pattern, a.academy(func(w http.ResponseWriter, r *http.Request) {
			if r.Context().Value(managedAcademyKey{}) == true {
				h(w, r)
			} else {
				a.auth(h)(w, r)
			}
		}))
	}
	public("GET /api/academy/public", a.academyPublic)
	public("GET /api/academy/courses", a.academyCatalog)
	public("GET /api/academy/plans", a.academyPlans)
	public("POST /api/academy/email-code", a.academyEmailCode)
	public("POST /api/academy/register", a.academyRegister)
	public("POST /api/academy/webhooks/payos", a.academyPayOS)
	member("GET /api/academy/me", a.academyMe)
	member("GET /api/academy/teaching", a.academyTeaching)
	member("POST /api/academy/profile", a.academyProfile)
	member("GET /api/academy/site", a.academyAdmin)
	member("POST /api/academy/site", a.academyAdmin)
	member("GET /api/academy/admin/{kind}", a.academyLists)
	member("POST /api/academy/courses", a.academyCourseSave)
	member("POST /api/academy/plans", a.academyPlanSave)
	member("GET /api/academy/orders", a.academyOrder)
	member("POST /api/academy/orders", a.academyOrder)
	member("POST /api/academy/orders/{order}/review", a.academyReview)
	member("GET /api/academy/orders/{order}/receipt", a.academyReceipt)
	member("POST /api/academy/orders/{order}/receipt", a.academyReceipt)
	member("POST /api/academy/uploads", a.academyFileUpload)
	member("POST /api/academy/courses/{course}/enroll", a.academyEnroll)
	member("GET /api/academy/courses/{course}/lessons", a.academyLessons)
	member("POST /api/academy/courses/{course}/lessons", a.academyLessonUpload)
	member("POST /api/academy/lessons/{lesson}/finish", a.academyLessonFinish)
	member("POST /api/academy/lessons/{lesson}/play", a.academyPlay)
	member("POST /api/academy/lessons/{lesson}/progress", a.academyProgress)
	member("GET /api/academy/courses/{course}/assignments", a.academyAssignments)
	member("POST /api/academy/courses/{course}/assignments", a.academyAssignments)
	member("GET /api/academy/assignments/{assignment}/submissions", a.academySubmission)
	member("POST /api/academy/assignments/{assignment}/submissions", a.academySubmission)
	member("POST /api/academy/assignments/{assignment}/grade", a.academyGrade)
	member("GET /api/academy/finance", a.academyFinance)
	member("POST /api/academy/finance", a.academyFinance)
	member("GET /api/academy/export/{kind}", a.academyExport)
}
