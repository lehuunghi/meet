import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { ClassSubjectPicker, type ScopedCourse } from "./class-subject-picker";

type Row = {
  course?: string;
  class_name?: string;
  id: string;
  meeting_id: string;
  meeting_title: string;
  starts_at: string;
  size_bytes: number;
  expires_at: string;
};
type Lesson = { id: string; title: string; starts_at: string };
export function RecordingLibrary({
  courses,
  demo = false,
  role,
}: {
  courses: ScopedCourse[];
  demo?: boolean;
  role: string;
}) {
  const [classChoice, setClass] = useState(""),
    [courseChoice, setCourse] = useState(""),
    [meeting, setMeeting] = useState(""),
    [page, setPage] = useState(0),
    [rows, setRows] = useState<Row[]>([]),
    [lessons, setLessons] = useState<Lesson[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [player, setPlayer] = useState<{ url: string; title: string } | null>(null),
    [notice, setNotice] = useState(""),
    [opening, setOpening] = useState(false);
  const playRequest = useRef(0),
    classId = courses.some((c) => c.class_id === classChoice)
      ? classChoice
      : "",
    course = courses.find(
      (c) => c.class_id === classId && c.id === courseChoice,
    ),
    courseId = course?.id || "";
  useEffect(() => {
    let active = true;
    setLessons([]);
    if (!courseId) return;
    const request = demo
      ? Promise.resolve(
          [1, 2].map((i) => ({
            id: courseId + "-" + i,
            title: i === 1 ? "Bài học số 1" : "Ôn tập và thực hành",
            starts_at: `2026-10-${22 + i}T01:00:00Z`,
          })),
        )
      : api<Lesson[]>(`/meetings?course_id=${encodeURIComponent(courseId)}`);
    request
      .then((v) => {
        if (active) setLessons(v);
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
    setPlayer(null);
    setNotice("");
    playRequest.current++;
    setOpening(false);
    if (!courseId && role === "admin") {
      setLoading(false);
      return;
    }
    setLoading(true);
    const params = new URLSearchParams({
      class_id: classId,
      course_id: courseId,
      meeting_id: meeting,
      page: String(page),
    });
    const scopeCourses = course
      ? [course]
      : classId
        ? courses.filter((c) => c.class_id === classId)
        : courses;
    const sample = scopeCourses.flatMap((c) =>
      [1, 2].map((i) => ({
        id: c.id + "-recording-" + i,
        meeting_id: c.id + "-" + i,
        meeting_title: i === 1 ? "Bài học số 1" : "Ôn tập và thực hành",
        course: c.name,
        class_name: c.class_name,
        starts_at: `2026-10-${22 + i}T01:00:00Z`,
        size_bytes: (i === 1 ? 214 : 168) * 1024 * 1024,
        expires_at: `2026-11-${22 + i}T01:00:00Z`,
      })),
    );
    const request = demo
      ? Promise.resolve(
          sample
            .filter((r) => !meeting || r.meeting_id === meeting)
            .sort(
              (a, b) =>
                new Date(b.starts_at).getTime() -
                new Date(a.starts_at).getTime(),
            ),
        )
      : api<Row[]>(`/recordings?${params}`);
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
      playRequest.current++;
    };
  }, [classId, courseId, meeting, page, demo, role, courses]);
  async function watch(row: Row) {
    const seq = ++playRequest.current;
    setError("");
    setPlayer(null);
    if (demo) {
      setNotice(
        "Bản mẫu minh họa theo lớp và môn; chưa có video thật để phát.",
      );
      return;
    }
    setOpening(true);
    try {
      const result = await api(
        `/meetings/${encodeURIComponent(row.meeting_id)}/recordings/${encodeURIComponent(row.id)}/download`,
      );
      if (seq === playRequest.current)
        setPlayer({ url: result.url, title: row.meeting_title });
    } catch (e) {
      if (seq === playRequest.current) setError((e as Error).message);
    } finally {
      if (seq === playRequest.current) setOpening(false);
    }
  }
  const time = (value: string) =>
    new Date(value).toLocaleString("vi-VN", {
      dateStyle: "short",
      timeStyle: "short",
    });
  return (
    <section
      className="section recording-library"
      aria-label="Bản ghi theo lớp và môn"
    >
      <div className="section-title">
        <div>
          <h2>Bản ghi bài học</h2>
          <p>
            Các bản ghi được phép xem, đã lưu và còn hạn. Buổi mới nhất hiển thị
            trước.
          </p>
        </div>
        <span className="pill">
          {demo ? "Dữ liệu minh họa" : "Kho riêng tư"}
        </span>
      </div>
      {!courses.length ? (
        <p>Chưa có lớp hoặc môn học trong phạm vi tài khoản của bạn.</p>
      ) : (
        <>
          <details className="scope-filter-details" open={role === "admin"}>
            <summary>
              {classId
                ? `Lớp ${courses.find((c) => c.class_id === classId)?.class_name} · ${course?.name || "Tất cả môn"}`
                : role === "admin"
                  ? "Lớp / môn"
                  : "Tất cả bản ghi của bạn"}
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
                setMeeting("");
                setPage(0);
              }}
              onCourse={(id) => {
                setRows([]);
                setLessons([]);
                setCourse(id);
                setMeeting("");
                setPage(0);
              }}
            />
          </details>
          {!course && role === "admin" ? (
            <div className="scope-empty">
              {classId
                ? "Chọn môn học để xem bản ghi riêng của môn trong lớp này."
                : "Chọn lớp học, sau đó chọn môn để mở thư viện bản ghi."}
            </div>
          ) : (
            <>
              {courseId && (
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
                    <option value="">Tất cả buổi của môn</option>
                    {lessons.map((l) => (
                      <option key={l.id} value={l.id}>
                        {time(l.starts_at)} · {l.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              {notice && (
                <p className="banner" role="status">
                  {notice}
                </p>
              )}
              {player && (
                <div className="recording-player">
                  <h3>{player.title}</h3>
                  <video
                    key={player.url}
                    controls
                    autoPlay
                    playsInline
                    src={player.url}
                  />
                  <button
                    className="secondary"
                    onClick={() => {
                      playRequest.current++;
                      setPlayer(null);
                    }}
                  >
                    Đóng video
                  </button>
                </div>
              )}
              {loading ? (
                <p role="status">Đang tải bản ghi…</p>
              ) : !rows.length ? (
                <div className="scope-empty">
                  Chưa có bản ghi còn hạn cho môn/buổi đã chọn.
                </div>
              ) : (
                <table className="recordings-table">
                  <caption className="sr-only">
                    {course
                      ? `Bản ghi lớp ${course.class_name}, môn ${course.name}`
                      : "Bản ghi trong các lớp/môn của bạn"}
                  </caption>
                  <thead>
                    <tr>
                      <th>Buổi học</th>
                      <th>Dung lượng</th>
                      <th>Hạn lưu</th>
                      <th>Xem bản ghi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 50).map((r) => (
                      <tr key={r.id}>
                        <td data-label="Buổi học">
                          <strong>{r.meeting_title}</strong>
                          {!course && (
                            <small>
                              {r.course} · Lớp {r.class_name}
                            </small>
                          )}
                          <small>{time(r.starts_at)}</small>
                        </td>
                        <td data-label="Dung lượng">
                          {Math.round(Number(r.size_bytes) / 1024 / 1024)} MB
                        </td>
                        <td data-label="Hạn lưu">{time(r.expires_at)}</td>
                        <td data-label="Xem bản ghi">
                          <button
                            className="secondary"
                            disabled={opening}
                            onClick={() => void watch(r)}
                          >
                            Xem bản ghi
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="report-pagination">
                <button
                  className="secondary"
                  disabled={!page || loading}
                  onClick={() => setPage((v) => v - 1)}
                >
                  ← Trang trước
                </button>
                <span>Trang {page + 1}</span>
                <button
                  className="secondary"
                  disabled={rows.length <= 50 || loading}
                  onClick={() => setPage((v) => v + 1)}
                >
                  Trang sau →
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
