import { useEffect, useState } from "react";
import { api } from "./api";
import {
  academyHref,
  academyClick,
  goAcademy,
  subjectPath,
} from "./academy-route";
export function CourseClassroomLink({
  course,
  demo,
  role,
  perform,
  notice,
}: any) {
  const [info, setInfo] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setInfo(null);
    setError("");
    if (!course.academic_course_id) return;
    void (
      demo
        ? Promise.resolve({
            linked: true,
            class_id: "demo-class",
            subject_id: course.academic_course_id,
            class_name: "10A1",
            subject: "Toán",
            teacher: "Giáo viên minh họa",
            state: "active",
            can_live: true,
            enrolled: true,
          })
        : api(`/academy/courses/${course.id}/classroom`)
    )
      .then((v) => {
        if (active) setInfo(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [course.id, course.academic_course_id, demo]);
  if (!course.academic_course_id)
    return (
      <p className="academy-class-link">
        Khóa học video — chưa liên kết lớp trực tuyến.
      </p>
    );
  return (
    <div className="academy-class-link">
      {error && <p role="alert">{error}</p>}
      {info?.linked && (
        <>
          <small>
            Lớp trực tuyến: {info.class_name} · {info.subject} · {info.teacher}
          </small>
          <button
            disabled={
              busy ||
              info.state !== "active" ||
              (role === "student" && !info.can_live)
            }
            onClick={() => {
              setBusy(true);
              void perform(async () => {
                if (role === "student" && !demo) {
                  const v = await api(
                    `/academy/courses/${course.id}/enroll`,
                    {},
                  );
                  notice("Đã kết nối khóa học với lớp trực tuyến.");
                  goAcademy(subjectPath(v.subject_id, "lessons"));
                } else goAcademy(subjectPath(info.subject_id, "lessons"));
              }).finally(() => setBusy(false));
            }}
          >
            {info.state === "deleted"
              ? "Lớp đã xóa"
              : info.state !== "active"
                ? "Lớp đang tạm ngưng"
                : role === "student"
                  ? !info.can_live
                    ? "Gói hiện tại chưa có Live"
                    : info.enrolled
                      ? "Mở lớp trực tuyến"
                      : "Đăng ký & mở lớp Live"
                  : "Mở lớp giảng dạy"}
          </button>
          {role === "student" && !info.can_live && (
            <small>
              Video bài giảng vẫn xem theo quyền của gói VIP. Chọn gói có Live
              để vào lớp trực tuyến.
            </small>
          )}
        </>
      )}
    </div>
  );
}
export function ClassroomCourseLinks({ subject, demo, role }: any) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    let active = true;
    void (
      demo
        ? Promise.resolve([{ id: "demo-course", title: "Toán nền tảng" }])
        : api(`/academy/classrooms/${subject}/courses`)
    )
      .then((v) => {
        if (active) setRows(v);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [subject, demo]);
  if (!rows.length) return null;
  return (
    <div className="classroom-course-links">
      <strong>Khóa học & bài giảng</strong>
      {rows.map((c) => (
        <a
          key={c.id}
          role="button"
          href={academyHref("/hoc/khoa-hoc/" + c.id)}
          onClick={(e) => academyClick(e, "/hoc/khoa-hoc/" + c.id)}
        >
          {c.title} ·{" "}
          {role === "teacher" ? "Bài giảng & bài tập" : "Xem bài giảng"}
        </a>
      ))}
    </div>
  );
}
