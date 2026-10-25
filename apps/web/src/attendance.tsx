import { ClassSubjectPicker } from "./class-subject-picker";
import { useEffect, useState } from "react";
import { AttendancePolicy, LessonTiming } from "./attendance-admin";
import { api } from "./api";
export type ReportCourse = {
  id: string;
  name: string;
  class_id: string;
  class_name: string;
  teacher: string;
};
type ReportRow = {
  course?: string;
  class_name?: string;
  lesson_start?: string;
  lesson_end?: string;
  meeting_id?: string;
  meeting_title?: string;
  starts_at?: string;
  attendance_result?: string;
  adjustment_reason?: string;
  id: string;
  name: string;
  email: string;
  seconds: number | string;
  session_count: number | string;
  participated_sessions: number | string;
  joined_at: string | null;
  last_seen: string | null;
  online: number;
};
type Lesson = { id: string; title: string; starts_at: string; status: string };
export function duration(value: number | string) {
  const s = Math.max(0, Number(value) || 0);
  return `${Math.floor(s / 3600) ? Math.floor(s / 3600) + " giờ " : ""}${Math.floor((s % 3600) / 60)} phút ${s % 60} giây`;
}
export function availableClasses(courses: ReportCourse[]) {
  return [
    ...new Map(
      courses.map((c) => [c.class_id, { id: c.class_id, name: c.class_name }]),
    ).values(),
  ];
}
function mockLessons(course: string): Lesson[] {
  return [
    {
      id: course + "-1",
      title: course.startsWith("math") ? "Hàm số và đồ thị" : "Bài học số 1",
      starts_at: "2026-10-23T01:00:00Z",
      status: "ended",
    },
    {
      id: course + "-2",
      title: "Ôn tập và thực hành",
      starts_at: "2026-10-24T01:00:00Z",
      status: "ended",
    },
  ];
}
function mockRows(
  role: string,
  course: ReportCourse,
  lesson: string,
): ReportRow[] {
  if (!lesson)
    return mockLessons(course.id).flatMap((l) =>
      mockRows(role, course, l.id).map((r) => ({
        ...r,
        meeting_id: l.id,
        meeting_title: l.title,
        starts_at: l.starts_at,
      })),
    );
  const names =
    course.class_name === "10A1"
      ? ["Nguyễn Hoàng An", "Lê Thanh Bình", "Phạm Mai Chi"]
      : ["Trần Gia Huy", "Võ Ngọc Mai"];
  const firstDay = lesson.endsWith("-2") ? "24" : "23";
  const emails =
    course.class_name === "10A1"
      ? ["hoangan", "thanhbinh", "maichi"]
      : ["giahuy", "ngocmai"];
  return (role === "student" ? names.slice(0, 1) : names).map((name, i) => ({
    id: String(i),
    name,
    email: emails[i] + "@example.test",
    seconds:
      i === 2
        ? 0
        : (lesson ? 2500 : 5100) -
          i * 230 -
          (course.id === "physics" ? 370 : 0),
    meeting_id: lesson,
    meeting_title: mockLessons(course.id).find((l) => l.id === lesson)?.title,
    starts_at: mockLessons(course.id).find((l) => l.id === lesson)?.starts_at,
    session_count: 1,
    participated_sessions: i === 2 ? 0 : lesson ? 1 : 2,
    joined_at: i === 2 ? null : `2026-10-${firstDay}T01:00:00Z`,
    last_seen: i === 2 ? null : `2026-10-${lesson ? firstDay : "24"}T01:45:00Z`,
    online: 0,
  }));
}
export function AttendanceReport({
  role,
  courses,
  demo = false,
  preferredCourseId,
  preferredMeetingId = "",
}: {
  role: string;
  courses: ReportCourse[];
  demo?: boolean;
  preferredCourseId?: string;
  preferredMeetingId?: string;
}) {
  const [revision, setRevision] = useState(0);
  const [classChoice, setClass] = useState(""),
    [courseChoice, setCourse] = useState(""),
    [meeting, setMeeting] = useState(preferredMeetingId),
    [page, setPage] = useState(0),
    [rows, setRows] = useState<ReportRow[]>([]),
    [lessons, setLessons] = useState<Lesson[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const teacherDefault =
    courses.find((c) => c.id === preferredCourseId) || courses[0];
  const classes = availableClasses(courses),
    classId = classes.some((c) => c.id === classChoice)
      ? classChoice
      : preferredCourseId || role === "teacher"
        ? teacherDefault?.class_id || ""
        : "";
  const subjects = courses.filter((c) => c.class_id === classId),
    course =
      subjects.find((c) => c.id === courseChoice) ||
      (preferredCourseId || role === "teacher"
        ? subjects.find((c) => c.id === preferredCourseId) || subjects[0]
        : undefined),
    courseId = course?.id || "";
  useEffect(() => {
    setMeeting(preferredMeetingId);
    setPage(0);
  }, [courseId]);
  useEffect(() => {
    let active = true;
    setLessons([]);
    if (!courseId) return;
    const request = demo
      ? Promise.resolve(mockLessons(courseId))
      : api<Lesson[]>(`/meetings?course_id=${encodeURIComponent(courseId)}`);
    request
      .then((v) => {
        if (active) setLessons(v.filter((x) => x.status !== "scheduled"));
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [courseId, demo]);
  useEffect(() => {
    let active = true;
    setRows([]);
    setError("");
    if (!course && role !== "student") {
      setLoading(false);
      return;
    }
    setLoading(true);
    const params = new URLSearchParams({
      course_id: courseId,
      class_id: classId,
      meeting_id: meeting,
      page: String(page),
    });
    const request = demo
      ? Promise.resolve(
          (course
            ? [course]
            : classId
              ? courses.filter((c) => c.class_id === classId)
              : courses
          )
            .flatMap((c) =>
              mockRows(role, c, meeting).map((r) => ({
                ...r,
                course: c.name,
                class_name: c.class_name,
              })),
            )
            .sort(
              (a, b) =>
                new Date(b.starts_at || 0).getTime() -
                new Date(a.starts_at || 0).getTime(),
            ),
        )
      : api<ReportRow[]>(`/attendance/report?${params}`);
    request
      .then((v) => {
        if (active) setRows(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [courseId, classId, meeting, page, role, demo, revision]);
  const shown = rows.slice(0, 50),
    scope =
      role === "admin"
        ? "Xem các lớp và môn học trong trường."
        : role === "teacher"
          ? "Chỉ xem các lớp và môn bạn được phân công giảng dạy."
          : "Chỉ xem lớp được phân học và kết quả của riêng bạn.";
  const time = (v: string | null) =>
    v
      ? new Intl.DateTimeFormat("vi-VN", {
          dateStyle: "short",
          timeStyle: "short",
        }).format(new Date(v))
      : "Chưa ghi nhận";
  return (
    <section
      className="section attendance-report"
      aria-label="Báo cáo theo lớp và môn"
    >
      <div className="section-title">
        <div>
          <h2>
            {role === "student" ? "Điểm danh của tôi" : "Báo cáo điểm danh"}
          </h2>
          <p>{scope}</p>
        </div>
        <span className="pill">
          {demo ? "Dữ liệu minh họa" : "Dữ liệu máy chủ"}
        </span>
      </div>
      {!courses.length ? (
        <p>Chưa có lớp hoặc môn học trong phạm vi tài khoản của bạn.</p>
      ) : (
        <>
          <details className="scope-filter-details" open={role === "admin"}>
            <summary>
              {role === "teacher"
                ? `Lớp ${course?.class_name || ""} · ${course?.name || ""}`
                : role === "student"
                  ? classId
                    ? `Lớp ${classes.find((c) => c.id === classId)?.name} · ${course?.name || "Tất cả môn"}`
                    : "Tất cả môn học của bạn"
                  : "Lớp / môn"}
              <span>Bộ lọc</span>
            </summary>
            <ClassSubjectPicker
              courses={courses}
              classId={classId}
              courseId={courseId}
              onClass={(id) => {
                setRows([]);
                setLessons([]);
                setClass(id);
                setCourse("");
                setMeeting(preferredMeetingId);
                setPage(0);
              }}
              onCourse={(id) => {
                setRows([]);
                setLessons([]);
                setCourse(id);
                setMeeting(preferredMeetingId);
                setPage(0);
              }}
            />
          </details>
          {!course && role !== "student" ? (
            <div className="scope-empty">
              {classId
                ? "Chọn môn học để xem điểm danh riêng của môn trong lớp này."
                : "Chọn lớp học, sau đó chọn môn để xem báo cáo điểm danh."}
            </div>
          ) : (
            <>
              <div className="report-toolbar">
                {courseId && (
                  <div className="attendance-filters">
                    <label>
                      Buổi học
                      <select
                        aria-label="Buổi học"
                        value={meeting}
                        onChange={(e) => {
                          setMeeting(e.target.value);
                          setPage(0);
                        }}
                      >
                        <option value="">Tất cả buổi đã bắt đầu</option>
                        {lessons.map((l) => (
                          <option key={l.id} value={l.id}>
                            {new Date(l.starts_at).toLocaleDateString("vi-VN")}{" "}
                            · {l.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                {!demo && (courseId || role === "student") && (
                  <a
                    className="button secondary"
                    href={
                      "/api/attendance/report?" +
                      new URLSearchParams({
                        class_id: classId,
                        course_id: courseId,
                        meeting_id: meeting,
                        format: "xlsx",
                      })
                    }
                  >
                    Xuất Excel (.xlsx, tiếng Việt)
                  </a>
                )}
              </div>
              {role === "admin" && (
                <>
                  <AttendancePolicy demo={demo} />
                  {
                    <LessonTiming
                      meeting={meeting}
                      classId={classId}
                      courseId={courseId}
                      start={lessons.find((l) => l.id === meeting)?.starts_at}
                      title={lessons.find((l) => l.id === meeting)?.title}
                      demo={demo}
                      onSaved={() => setRevision((v) => v + 1)}
                    />
                  }
                </>
              )}
              <div className="report-context">
                <strong>
                  {course
                    ? `Lớp ${course.class_name} · ${course.name}`
                    : classId
                      ? `Các môn lớp ${classes.find((c) => c.id === classId)?.name}`
                      : "Toàn bộ kết quả của bạn"}
                </strong>
                {course && <small>Giáo viên: {course.teacher}</small>}
              </div>
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              {loading ? (
                <p role="status">Đang tải báo cáo…</p>
              ) : (
                <>
                  <div className="report-counts">
                    <span>
                      <strong>{shown.length}</strong> dòng trên trang
                    </span>
                    <span>
                      <strong>
                        {
                          shown.filter(
                            (r) => Number(r.participated_sessions) > 0,
                          ).length
                        }
                      </strong>{" "}
                      có kết nối
                    </span>
                    <span>
                      <strong>
                        {
                          shown.filter(
                            (r) => Number(r.participated_sessions) === 0,
                          ).length
                        }
                      </strong>{" "}
                      chưa ghi nhận
                    </span>
                  </div>
                  {!error && shown.length === 0 ? (
                    <div className="report-empty">
                      Chưa có dữ liệu điểm danh cho lựa chọn này. Buổi chưa bắt
                      đầu chưa được tính.
                    </div>
                  ) : (
                    shown.length > 0 && (
                      <>
                        <div
                          className="comparison-scroll"
                          role="region"
                          aria-label="Bảng đối chiếu điểm danh"
                          tabIndex={0}
                        >
                          <table className="attendance-table comparison-table">
                            <caption className="sr-only">
                              {course
                                ? `Điểm danh lớp ${course.class_name}, môn ${course.name}`
                                : "Lịch sử điểm danh của bạn"}
                            </caption>
                            <thead>
                              <tr>
                                {role !== "student" && (
                                  <th scope="col" className="identity-col">
                                    Học sinh
                                  </th>
                                )}
                                {(role === "student" || !meeting) && (
                                  <th
                                    scope="col"
                                    className={
                                      role === "student"
                                        ? "identity-col"
                                        : "lesson-col"
                                    }
                                  >
                                    Buổi học
                                  </th>
                                )}
                                {!meeting && <th scope="col">Ngày học</th>}
                                {!course && (
                                  <>
                                    <th scope="col">Lớp</th>
                                    <th scope="col">Môn học</th>
                                  </>
                                )}
                                <th scope="col" className="clock-col">
                                  Giờ vào
                                </th>
                                <th scope="col" className="clock-col">
                                  Giờ ra
                                </th>
                                <th scope="col" className="numeric-col">
                                  Thời gian
                                </th>
                                <th scope="col">Kết quả</th>
                              </tr>
                            </thead>
                            <tbody>
                              {shown.map((r) => (
                                <tr key={(r.meeting_id || meeting) + r.id}>
                                  {role !== "student" && (
                                    <td className="identity-col">
                                      <strong title={r.name}>{r.name}</strong>
                                      <small>{r.email}</small>
                                    </td>
                                  )}
                                  {(role === "student" || !meeting) && (
                                    <td
                                      className={
                                        role === "student"
                                          ? "identity-col"
                                          : "lesson-col"
                                      }
                                    >
                                      <strong
                                        title={r.meeting_title || "Buổi học"}
                                      >
                                        {r.meeting_title || "Buổi học"}
                                      </strong>
                                    </td>
                                  )}
                                  {!meeting && (
                                    <td className="date-col">
                                      {r.starts_at
                                        ? new Date(
                                            r.starts_at,
                                          ).toLocaleDateString("vi-VN")
                                        : "—"}
                                    </td>
                                  )}
                                  {!course && (
                                    <>
                                      <td>{r.class_name || "—"}</td>
                                      <td>{r.course || "—"}</td>
                                    </>
                                  )}
                                  <td
                                    className="clock-col"
                                    title={time(r.joined_at)}
                                  >
                                    {r.joined_at
                                      ? new Date(
                                          r.joined_at,
                                        ).toLocaleTimeString("vi-VN", {
                                          hour: "2-digit",
                                          minute: "2-digit",
                                        })
                                      : "—"}
                                  </td>
                                  <td
                                    className="clock-col"
                                    title={time(r.last_seen)}
                                  >
                                    {r.last_seen
                                      ? new Date(
                                          r.last_seen,
                                        ).toLocaleTimeString("vi-VN", {
                                          hour: "2-digit",
                                          minute: "2-digit",
                                        })
                                      : "—"}
                                  </td>
                                  <td className="numeric-col">
                                    {duration(r.seconds)}
                                  </td>
                                  <td>
                                    <span
                                      className={
                                        "report-badge " +
                                        (r.attendance_result === "Đạt"
                                          ? "connected"
                                          : "")
                                      }
                                    >
                                      {r.attendance_result ||
                                        (Number(r.participated_sessions) > 0
                                          ? "Có kết nối"
                                          : "Chưa vào")}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <p className="table-scroll-hint">
                          Vuốt ngang để đối chiếu các cột · Cột đầu luôn được
                          giữ lại.
                        </p>
                      </>
                    )
                  )}
                  <div className="report-pagination">
                    <button
                      className="secondary"
                      disabled={page === 0}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      ← Trang trước
                    </button>
                    <span>Trang {page + 1}</span>
                    <button
                      className="secondary"
                      disabled={rows.length <= 50}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Trang sau →
                    </button>
                  </div>
                </>
              )}
              <p className="report-note">
                Chỉ tính các buổi đang học hoặc đã kết thúc. “Có kết nối” không
                đồng nghĩa với đủ điều kiện chuyên cần; thời gian được ghi nhận
                theo kết nối ứng dụng.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}
