import { useEffect, useState } from "react";
import {
  AttendancePolicy,
  AttendanceEdit,
  LessonTiming,
} from "./attendance-admin";
import { api } from "./api";
export type ReportCourse = {
  id: string;
  name: string;
  class_id: string;
  class_name: string;
  teacher: string;
};
type ReportRow = {
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
}: {
  role: string;
  courses: ReportCourse[];
  demo?: boolean;
}) {
  const [revision, setRevision] = useState(0);
  const [classChoice, setClass] = useState(""),
    [courseChoice, setCourse] = useState(""),
    [meeting, setMeeting] = useState(""),
    [page, setPage] = useState(0),
    [rows, setRows] = useState<ReportRow[]>([]),
    [lessons, setLessons] = useState<Lesson[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const classes = availableClasses(courses),
    classId = classes.some((c) => c.id === classChoice)
      ? classChoice
      : classes[0]?.id || "";
  const subjects = courses.filter((c) => c.class_id === classId),
    course = subjects.find((c) => c.id === courseChoice) || subjects[0],
    courseId = course?.id || "";
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
    if (!course) return;
    setLoading(true);
    const params = new URLSearchParams({
      course_id: courseId,
      class_id: classId,
      meeting_id: meeting,
      page: String(page),
    });
    const request = demo
      ? Promise.resolve(mockRows(role, course, meeting))
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
          <div className="attendance-filters">
            <label>
              Lớp học
              <select
                aria-label="Lớp học"
                value={classId}
                onChange={(e) => {
                  setClass(e.target.value);
                  setCourse("");
                  setMeeting("");
                  setPage(0);
                }}
              >
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Môn học
              <select
                aria-label="Môn học"
                value={courseId}
                onChange={(e) => {
                  setCourse(e.target.value);
                  setMeeting("");
                  setPage(0);
                }}
              >
                {subjects.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
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
                    {new Date(l.starts_at).toLocaleDateString("vi-VN")} ·{" "}
                    {l.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!demo && courseId && (
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
          {role === "admin" && (
            <>
              <AttendancePolicy demo={demo} />
              {meeting && (
                <LessonTiming
                  meeting={meeting}
                  demo={demo}
                  onSaved={() => setRevision((v) => v + 1)}
                />
              )}
            </>
          )}
          <div className="report-context">
            <strong>
              Lớp {course?.class_name} <span>·</span> {course?.name}
            </strong>
            <small>Giáo viên: {course?.teacher}</small>
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
              <div className="attendance-summary">
                <article>
                  <strong>
                    {role === "student" ? shown.length : shown.length}
                  </strong>
                  <small>
                    {role === "student"
                      ? "Dòng điểm danh trên trang"
                      : "Dòng điểm danh trên trang"}
                  </small>
                </article>
                <article>
                  <strong>
                    {role === "student"
                      ? shown.filter((r) => Number(r.participated_sessions) > 0)
                          .length
                      : shown.filter((r) => Number(r.participated_sessions) > 0)
                          .length}
                  </strong>
                  <small>Có ghi nhận tham gia</small>
                </article>
                <article>
                  <strong>
                    {role === "student"
                      ? Math.floor(Number(shown[0]?.seconds || 0) / 60)
                      : shown.filter(
                          (r) => Number(r.participated_sessions) === 0,
                        ).length}
                  </strong>
                  <small>
                    {role === "student"
                      ? "Phút kết nối dòng đầu"
                      : "Chưa ghi nhận tham gia"}
                  </small>
                </article>
              </div>
              {!error && shown.length === 0 ? (
                <div className="report-empty">
                  Chưa có dữ liệu điểm danh cho lựa chọn này. Buổi chưa bắt đầu
                  chưa được tính.
                </div>
              ) : (
                shown.length > 0 && (
                  <table className="attendance-table">
                    <caption className="sr-only">
                      Điểm danh lớp {course?.class_name}, môn {course?.name}
                    </caption>
                    <thead>
                      <tr>
                        <th>Buổi học</th>
                        <th>Học sinh</th>
                        <th>Buổi có kết nối</th>
                        <th>Tổng thời gian</th>
                        <th>Vào lớp lần đầu</th>
                        <th>Ghi nhận gần nhất</th>
                        <th>Kết quả</th>
                        {role === "admin" && <th>Điều chỉnh</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((r) => (
                        <tr key={(r.meeting_id || meeting) + r.id}>
                          <td data-label="Buổi học">
                            <strong>
                              {r.meeting_title ||
                                lessons.find((l) => l.id === meeting)?.title ||
                                "Buổi học"}
                            </strong>
                            <small>
                              {r.starts_at ? time(r.starts_at) : ""}
                            </small>
                          </td>
                          <td data-label="Học sinh">
                            <strong>{r.name}</strong>
                            <small>{r.email}</small>
                          </td>
                          <td data-label="Buổi có kết nối">
                            <span
                              className={
                                Number(r.participated_sessions) > 0
                                  ? "report-badge connected"
                                  : "report-badge"
                              }
                            >
                              {r.participated_sessions}/{r.session_count} buổi
                            </span>
                          </td>
                          <td data-label="Tổng thời gian">
                            <strong>{duration(r.seconds)}</strong>
                          </td>
                          <td data-label="Vào lớp lần đầu">
                            {time(r.joined_at)}
                          </td>
                          <td data-label="Ghi nhận gần nhất">
                            {time(r.last_seen)}
                          </td>
                          <td data-label="Kết quả">
                            {r.attendance_result || "Chưa đánh giá"}
                            {r.adjustment_reason && (
                              <small>
                                Đã điều chỉnh: {r.adjustment_reason}
                              </small>
                            )}
                          </td>
                          {role === "admin" && (
                            <td data-label="Điều chỉnh">
                              <AttendanceEdit
                                row={r}
                                demo={demo}
                                onSaved={() => setRevision((v) => v + 1)}
                              />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
            Chỉ tính các buổi đang học hoặc đã kết thúc. “Có kết nối” không đồng
            nghĩa với đủ điều kiện chuyên cần; thời gian được ghi nhận theo kết
            nối ứng dụng.
          </p>
        </>
      )}
    </section>
  );
}
