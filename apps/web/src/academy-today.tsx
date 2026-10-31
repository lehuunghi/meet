import {vnDateTime} from "./date-format";
import { useEffect, useState } from "react";
import { api } from "./api";
export function AcademyToday({ demo, role, onMeeting, onCourse }: any) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  async function load() {
    try {
      const v = demo
        ? {
            meetings: [
              {
                id: "demo-live-math",
                title: "Hàm số và đồ thị",
                course: "Toán nền tảng",
                class_name: "10A1",
                status: "live",
                starts_at: "2026-10-26T01:00:00Z",
              },
            ],
            tasks:
              role === "teacher"
                ? [
                    {
                      id: "demo-task",
                      course_id: "demo-course",
                      course: "Toán nền tảng",
                      title: "Ôn tập chương 1",
                      due_at: "2026-10-28T10:00:00Z",
                      ungraded: 2,
                      missing: 3,
                    },
                  ]
                : [],
            resume:
              role === "student"
                ? [
                    {
                      lesson_id: "demo-lesson",
                      course_id: "demo-course",
                      title: "Bài 1 · Bắt đầu từ kiến thức cốt lõi",
                      course: "Toán nền tảng",
                      seconds: 420,
                      duration_seconds: 1800,
                    },
                  ]
                : [],
          }
        : await api("/academy/workspace");
      setData(v);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    let active = true;
    const reload = () => {
      if (active) void load();
    };
    reload();
    const timer = setInterval(reload, 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [demo, role]);
  return (
    <section className="academy-today" aria-label="Hôm nay">
      <div className="academy-today-heading">
        <h2>
          {role === "teacher" ? "Công việc giảng dạy" : "Hôm nay của bạn"}
        </h2>
        <span>{demo ? "Dữ liệu minh họa" : "Lịch 7 ngày tới"}</span>
      </div>
      {error ? (
        <p role="alert">
          {error}{" "}
          <button className="secondary" onClick={() => void load()}>
            Thử tải lại
          </button>
        </p>
      ) : !data ? (
        <p role="status">Đang tải lịch học và việc cần làm…</p>
      ) : (
        <div className="academy-today-grid">
          <section>
            <h3>{role === "teacher" ? "Buổi sắp dạy" : "Lịch học gần nhất"}</h3>
            {data.meetings.map((m: any) => (
              <article key={m.id}>
                <strong>{m.title}</strong>
                <p>
                  {m.class_name} · {m.course}
                </p>
                <small>
                  {m.status === "live"
                    ? "Đang diễn ra"
                    : vnDateTime(m.starts_at)}
                </small>
                <button
                  disabled={role === "student" && m.status !== "live"}
                  onClick={() => onMeeting(m)}
                >
                  {role === "teacher"
                    ? m.status === "live"
                      ? "Vào phòng dạy"
                      : "Chuẩn bị dạy"
                    : m.status === "live"
                      ? "Vào lớp học"
                      : "Đang chờ"}
                </button>
              </article>
            ))}
            {!data.meetings.length && <p>Chưa có lịch học trong 7 ngày tới.</p>}
          </section>
          <section>
            <h3>{role === "teacher" ? "Bài cần xử lý" : "Bài cần nộp"}</h3>
            {data.tasks.map((t: any) => (
              <article key={t.id}>
                <strong>{t.title}</strong>
                <p>{t.course}</p>
                <small>
                  {vnDateTime(t.due_at)}
                  {new Date(t.due_at) < new Date() ? " · Đã quá hạn" : ""}
                </small>
                {role === "teacher" && (
                  <p className="academy-task-counts">
                    <span>{Number(t.ungraded)} bài chưa chấm</span>
                    <span>{Number(t.missing)} học sinh chưa nộp</span>
                  </p>
                )}
                <button
                  className="secondary"
                  onClick={() => onCourse(t.course_id, "", true)}
                >
                  Xem bài tập
                </button>
              </article>
            ))}
            {!data.tasks.length && (
              <p>
                {role === "teacher"
                  ? "Không có bài cần xử lý."
                  : "Chưa có bài tập cần nộp trong các môn được giao. Bài tập áp dụng theo quyền của gói học."}
              </p>
            )}
          </section>
          {role === "student" && (
            <section>
              <h3>Tiếp tục học</h3>
              {data.resume.map((l: any) => (
                <article key={l.lesson_id}>
                  <strong>{l.title}</strong>
                  <p>{l.course}</p>
                  <progress
                    aria-label={"Tiến độ " + l.title}
                    max={Number(l.duration_seconds) || 1}
                    value={Number(l.seconds)}
                  />
                  <small>
                    {Math.floor(Number(l.seconds) / 60)} /{" "}
                    {Math.ceil(Number(l.duration_seconds) / 60)} phút
                  </small>
                  <button
                    className="secondary"
                    onClick={() => onCourse(l.course_id, l.lesson_id, false)}
                  >
                    Tiếp tục bài học
                  </button>
                </article>
              ))}
              {!data.resume.length && (
                <p>Các bài đang xem dở sẽ xuất hiện tại đây.</p>
              )}
            </section>
          )}
        </div>
      )}
    </section>
  );
}
