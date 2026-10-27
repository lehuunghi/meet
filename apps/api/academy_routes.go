package main

import (
	"net/http"
	"regexp"
)

type managedAcademyKey struct{}

func academyManagedPath(method, path string) bool {
	if method == "GET" && regexp.MustCompile(`^/api/academy/courses/[a-zA-Z0-9-]{1,36}/lessons$`).MatchString(path) {
		return true
	}
	if method == "POST" && regexp.MustCompile(`^/api/academy/(courses/[a-zA-Z0-9-]{1,36}/lessons|lessons/[a-zA-Z0-9-]{1,36}/(finish|play))$`).MatchString(path) {
		return true
	}
	if method == "GET" && regexp.MustCompile(`^/api/academy/control/(people|classes|catalog|meetings)$`).MatchString(path) {
		return true
	}
	if method == "POST" && regexp.MustCompile(`^/api/academy/control/(people|classes|teachers|students|assignments|subjects/[a-zA-Z0-9-]{1,36})$`).MatchString(path) {
		return true
	}
	return (method == "GET" && regexp.MustCompile(`^/api/academy/(admin/(courses|plans|orders|students)|site|finance|orders/[a-zA-Z0-9-]{1,36}/receipt)$`).MatchString(path)) || (method == "POST" && regexp.MustCompile(`^/api/academy/(site|courses|plans|finance|orders/[a-zA-Z0-9-]{1,36}/review)$`).MatchString(path))
}

func (a *app) academyRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /website", a.academyWebsite)
	m.HandleFunc("GET /khoa-hoc/{course}", a.academyWebsite)
	m.HandleFunc("GET /chinh-sach/{policy}", a.academyWebsite)
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
	public("GET /api/academy/ui-texts", a.academyUITextPublic)
	member("GET /api/academy/admin/ui-texts", a.academyUITextAdmin)
	member("POST /api/academy/admin/ui-texts", a.academyUITextAdmin)
	public("GET /api/academy/courses", a.academyCatalog)
	public("GET /api/academy/plans", a.academyPlans)
	public("POST /api/academy/verification-link", a.academyResendVerification)
	public("POST /api/academy/verify-email-link", a.academyVerifyEmailLink)
	public("POST /api/academy/register", a.academyRegister)
	public("POST /api/academy/webhooks/payos", a.academyPayOS)
	control := func(pattern, permission string, h http.HandlerFunc) {
		member(pattern, func(w http.ResponseWriter, r *http.Request) {
			if a.businessAdmin(w, r, permission) {
				h(w, r)
			}
		})
	}
	member("GET /api/academy/me", a.academyMe)
	member("GET /api/academy/mail-status", a.academyMailStatus)
	member("POST /api/academy/mail-status", a.academyMailStatus)
	member("GET /api/academy/workspace", a.academyWorkspace)
	member("GET /api/academy/notifications", a.academyNotifications)
	member("POST /api/academy/notifications/read", a.academyNotifications)
	member("GET /api/academy/lessons/{lesson}", a.academyResolve)
	member("GET /api/academy/assignments/{assignment}", a.academyResolve)
	member("GET /api/academy/orders/{order}", a.academyOrderDetail)
	member("GET /api/academy/settings", a.academySettings)
	member("POST /api/academy/settings", a.academySettings)
	control("GET /api/academy/control/people", "accounts", a.accounts)
	control("POST /api/academy/control/people", "accounts", a.accountSave)
	control("POST /api/academy/control/teachers", "academic", a.teacherBatch)
	control("POST /api/academy/control/students", "accounts", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Rows []accountRow `json:"rows"`
		}
		if decode(w, r, &in) {
			a.saveAccounts(w, r, in.Rows, "student", "")
		}
	})
	control("GET /api/academy/control/catalog", "academic", a.catalog)
	control("GET /api/academy/control/meetings", "meetings", a.meetings)
	control("GET /api/academy/control/classes", "academic", func(w http.ResponseWriter, r *http.Request) {
		a.query(w, r, "SELECT id,short_id,name FROM classes WHERE school_id=? ORDER BY name LIMIT 1000", who(r).School)
	})
	control("POST /api/academy/control/classes", "academic", a.createClass)
	control("POST /api/academy/control/subjects/{id}", "academic", a.courseBatch)
	control("POST /api/academy/control/assignments", "academic", a.assignTeachers)
	member("GET /api/academy/teaching", a.academyTeaching)
	member("POST /api/academy/profile", a.academyProfile)
	member("GET /api/academy/profile/avatar", a.academyRegistrationAvatar)
	member("GET /api/academy/site", a.academyAdmin)
	member("POST /api/academy/site", a.academyAdmin)
	member("POST /api/academy/site/preview", a.academySitePreview)
	member("GET /api/academy/admin/{kind}", a.academyLists)
	member("POST /api/academy/courses", a.academyCourseSave)
	member("POST /api/academy/courses/{course}/delete", a.academyCourseDelete)
	member("POST /api/academy/plans", a.academyPlanSave)
	member("POST /api/academy/plans/{plan}/delete", a.academyPlanDelete)
	member("GET /api/academy/orders", a.academyOrder)
	member("POST /api/academy/orders", a.academyOrder)
	member("POST /api/academy/orders/{order}/review", a.academyReview)
	member("GET /api/academy/orders/{order}/receipt", a.academyReceipt)
	member("POST /api/academy/orders/{order}/receipt", a.academyReceipt)
	member("POST /api/academy/uploads", a.academyFileUpload)
	member("POST /api/academy/courses/{course}/enroll", a.academyEnroll)
	member("GET /api/academy/courses/{course}/classroom", a.academyClassroom)
	member("GET /api/academy/classrooms/{subject}/courses", a.academyClassCourses)
	member("GET /api/academy/courses/{course}/lessons", a.academyLessons)
	member("POST /api/academy/courses/{course}/lessons", a.academyLessonUpload)
	member("POST /api/academy/courses/{course}/recordings", a.academyRecordingImport)
	member("POST /api/academy/courses/{course}/lesson-order", a.academyLessonOrder)
	member("POST /api/academy/lessons/{lesson}/edit", a.academyLessonEdit)
	member("POST /api/academy/lessons/{lesson}/retry-import", a.academyRetryRecordingImport)
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
