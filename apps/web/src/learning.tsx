import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { AttendanceReport } from "./attendance";

type Course = {
  id: string;
  name: string;
  class_id: string;
  class_name: string;
  teacher: string;
  lesson_count?: number;
  ready_meeting_id?: string;
  ready_status?: string;
};
type Lesson = {
  id: string;
  course_id?: string;
  title: string;
  course?: string;
  class_name?: string;
  starts_at: string;
  status: string;
  recording_allowed?: boolean | number;
  short_code?: string;
};
export function LearningWorkspace({
  role,
  courses,
  meetings,
  demo = false,
  reports = false,
  onOpen,
  onRefresh,
  canTeach = true,
  canVideo = true,
}: {
  role: string;
  courses: Course[];
  meetings: Lesson[];
  demo?: boolean;
  reports?: boolean;
  onOpen: (m: any) => void;
  onRefresh: () => Promise<void>;
  canTeach?: boolean;
  canVideo?: boolean;
}) {
  const [classId, setClassId] = useState(""),
    [expanded, setExpanded] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const classes = [
    ...new Map(
      courses.map((c) => [c.class_id, { id: c.class_id, name: c.class_name }]),
    ).values(),
  ];
  const active = (c: Course) =>
    meetings.find((m) => m.course_id === c.id && m.status === "live") ||
    meetings.find((m) => m.course_id === c.id && m.status === "scheduled") ||
    (c.ready_meeting_id
      ? {
          id: c.ready_meeting_id,
          status: c.ready_status,
          title: c.name,
          course: c.name,
          class_name: c.class_name,
          course_id: c.id,
          starts_at: new Date().toISOString(),
        }
      : undefined);
  const score = (c: Course) =>
    active(c)?.status === "live" ? 2 : active(c) ? 1 : 0;
  const shown = courses
    .filter((c) => role === "student" || !classId || c.class_id === classId)
    .sort(
      (a, b) =>
        score(b) - score(a) ||
        a.class_name.localeCompare(b.class_name, "vi") ||
        a.name.localeCompare(b.name, "vi"),
    );
  async function prepare(c: Course) {
    setBusy(c.id);
    setError("");
    try {
      if (demo) {
        const m = active(c) || {
          id: "preview-" + c.id,
          status: "scheduled",
          title: c.name,
          course: c.name,
          class_name: c.class_name,
          course_id: c.id,
          starts_at: new Date().toISOString(),
        };
        onOpen(m);
        return;
      }
      const m = await api<Lesson>(`/courses/${c.id}/prepare`, {});
      await onRefresh();
      onOpen(m);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const selected = courses.find((c) => c.id === expanded);
  return (
    <section className="section learning-workspace">
      <div className="section-title">
        <div>
          <h2>
            {reports
              ? "Điểm danh & video theo môn"
              : role === "student"
                ? "Môn học của tôi"
                : "Lớp học & môn được phân công"}
          </h2>
          <p>
            {role === "student"
              ? "Môn đang học hoặc giáo viên đã chuẩn bị được đưa lên đầu."
              : "Chọn lớp, mở môn học để chuẩn bị dạy hoặc xem từng buổi."}
          </p>
        </div>
        <span className="pill">{shown.length} môn</span>
      </div>
      {role !== "student" && (
        <label className="learning-filter">
          Lớp học
          <select
            value={classId}
            onChange={(e) => {
              setClassId(e.target.value);
              setExpanded("");
            }}
          >
            <option value="">Tất cả lớp được phân công</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
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
      {role !== "student" && !classId ? (
        <div className="learning-table-scroll">
          <table className="learning-table">
            <thead>
              <tr>
                <th>Lớp học</th>
                <th>Môn được phân công</th>
                <th>Tổng số buổi</th>
                <th>Đang học / chuẩn bị</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {classes.map((cl) => {
                const list = courses.filter((c) => c.class_id === cl.id);
                return (
                  <tr key={cl.id}>
                    <td>
                      <strong>{cl.name}</strong>
                    </td>
                    <td>{list.length}</td>
                    <td>
                      {list.reduce(
                        (n, c) =>
                          n +
                          Number(
                            c.lesson_count ??
                              meetings.filter((m) => m.course_id === c.id)
                                .length,
                          ),
                        0,
                      )}
                    </td>
                    <td>{list.filter((c) => active(c)).length} môn</td>
                    <td>
                      <button
                        className="secondary"
                        onClick={() => {
                          setClassId(cl.id);
                          setExpanded("");
                        }}
                      >
                        Xem môn học
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!classes.length && (
                <tr>
                  <td colSpan={5}>Chưa có lớp được phân công.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="learning-table-scroll">
            <table className="learning-table">
              <thead>
                <tr>
                  {role !== "student" && <th>Lớp</th>}
                  <th>Môn học</th>
                  <th>Giáo viên</th>
                  <th>Trạng thái</th>
                  <th>Số buổi</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => {
                  const m = active(c),
                    live = m?.status === "live";
                  return (
                    <tr key={c.id} className={live ? "learning-live" : ""}>
                      {role !== "student" && <td>{c.class_name}</td>}
                      <td>
                        <strong>{c.name}</strong>
                        {role === "student" && (
                          <small>Lớp {c.class_name}</small>
                        )}
                      </td>
                      <td>{c.teacher || "Chưa phân công"}</td>
                      <td>
                        <span className={"status " + (m?.status || "")}>
                          {live
                            ? "Đang học"
                            : m
                              ? "Giáo viên đang chuẩn bị"
                              : "Chưa bắt đầu"}
                        </span>
                      </td>
                      <td>
                        {c.lesson_count ??
                          meetings.filter((m) => m.course_id === c.id).length}
                      </td>
                      <td>
                        <div className="learning-actions">
                          {!reports &&
                            (role === "student" ? (
                              <button
                                disabled={!live}
                                onClick={() => onOpen(m)}
                              >
                                {live ? "Vào lớp học" : "Đang chờ"}
                              </button>
                            ) : (
                              canTeach && (
                                <button
                                  disabled={busy === c.id}
                                  onClick={() => void prepare(c)}
                                >
                                  {busy === c.id
                                    ? "Đang chuẩn bị…"
                                    : live
                                      ? "Vào phòng dạy"
                                      : "Chuẩn bị dạy"}
                                </button>
                              )
                            ))}
                          <button
                            className="secondary"
                            aria-expanded={expanded === c.id}
                            onClick={() =>
                              setExpanded(expanded === c.id ? "" : c.id)
                            }
                          >
                            {reports
                              ? "Xem thống kê & video"
                              : "Các buổi học & video"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!shown.length && (
                  <tr>
                    <td colSpan={6}>Chưa có môn học được phân công.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      {selected && (
        <CourseLessons
          key={selected.id}
          course={selected}
          role={role}
          demo={demo}
          reports={reports}
          canVideo={canVideo}
          samples={meetings.filter((m) => m.course_id === selected.id)}
          onOpen={onOpen}
        />
      )}
    </section>
  );
}
function CourseLessons({
  course,
  role,
  demo,
  reports,
  canVideo,
  samples,
  onOpen,
}: {
  course: Course;
  role: string;
  demo: boolean;
  reports: boolean;
  canVideo: boolean;
  samples: Lesson[];
  onOpen: (m: any) => void;
}) {
  const [lessons, setLessons] = useState<Lesson[]>([]),
    [page, setPage] = useState(0),
    [detail, setDetail] = useState<string | null>(null),
    [videoLesson, setVideoLesson] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setError("");
    const req = demo
      ? Promise.resolve(
          samples.length
            ? samples
            : [1, 2].map((i) => ({
                id: course.id + "-" + i,
                title: "Bài học số " + i,
                starts_at: "2026-10-24T01:00:00Z",
                status: "ended",
                course_id: course.id,
              })),
        )
      : api<Lesson[]>(
          `/meetings?course_id=${encodeURIComponent(course.id)}&page=${page}`,
        );
    void req
      .then((v) => {
        if (current) setLessons(v);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [course.id, page, demo]);
  return (
    <div className="learning-detail">
      <div className="section-title">
        <h3>
          {course.class_name} · {course.name}
        </h3>
        <span>{course.lesson_count ?? lessons.length} buổi học</span>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="learning-table-scroll">
        <table className="learning-table">
          <thead>
            <tr>
              <th>Buổi học</th>
              <th>Thời gian</th>
              <th>Trạng thái</th>
              <th>Điểm danh</th>
              <th>Video</th>
            </tr>
          </thead>
          <tbody>
            {lessons.map((m) => (
              <tr key={m.id}>
                <td>{m.title}</td>
                <td>{new Date(m.starts_at).toLocaleString("vi-VN")}</td>
                <td>
                  {m.status === "live"
                    ? "Đang học"
                    : m.status === "scheduled"
                      ? "Đang chuẩn bị"
                      : "Đã kết thúc"}
                </td>
                <td>
                  <button className="secondary" onClick={() => setDetail(m.id)}>
                    Xem thống kê buổi
                  </button>
                  {!reports && m.status === "live" && (
                    <button onClick={() => onOpen(m)}>Vào lớp học</button>
                  )}
                </td>
                <td>
                  {canVideo && (
                    <button
                      className="secondary"
                      onClick={() =>
                        setVideoLesson(videoLesson === m.id ? "" : m.id)
                      }
                    >
                      Xem video
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!lessons.length && (
              <tr>
                <td colSpan={5}>Chưa có buổi học.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!demo && (page > 0 || lessons.length === 200) && (
        <div className="learning-actions">
          <button disabled={!page} onClick={() => setPage((p) => p - 1)}>
            Trang trước
          </button>
          <span>Trang {page + 1}</span>
          <button
            disabled={lessons.length < 200}
            onClick={() => setPage((p) => p + 1)}
          >
            Trang sau
          </button>
        </div>
      )}
      <div className="learning-actions">
        <button className="secondary" onClick={() => setDetail("")}>
          Thống kê toàn môn
        </button>
      </div>
      {videoLesson && (
        <LessonVideos key={videoLesson} meeting={videoLesson} demo={demo} />
      )}
      {detail !== null && (
        <AttendanceReport
          key={course.id + detail}
          role={role}
          courses={[course]}
          demo={demo}
          preferredCourseId={course.id}
          preferredMeetingId={detail}
        />
      )}
    </div>
  );
}
function LessonVideos({ meeting, demo }: { meeting: string; demo: boolean }) {
  const [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState(""),
    [player, setPlayer] = useState(""),
    [loading, setLoading] = useState(true);
  const generation = useRef(0);
  useEffect(() => {
    let active = true;
    void (
      demo
        ? Promise.resolve([
            { id: "demo-video", created_at: "2026-10-24T01:00:00Z" },
          ])
        : api<any[]>(`/meetings/${meeting}/recordings`)
    )
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
      generation.current++;
    };
  }, [meeting, demo]);
  async function play(id: string) {
    const version = ++generation.current;
    setError("");
    if (demo) {
      setError("Video minh họa: chưa có file ghi hình thật.");
      return;
    }
    try {
      const result = await api<{ url: string }>(
        `/meetings/${meeting}/recordings/${id}/download`,
      );
      if (version === generation.current) setPlayer(result.url);
    } catch (e) {
      if (version === generation.current) setError((e as Error).message);
    }
  }
  return (
    <section className="learning-videos">
      <h4>Video của buổi học</h4>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p>Đang tải video…</p>
      ) : !rows.length ? (
        <p>Chưa có video đã hoàn tất cho buổi này.</p>
      ) : (
        rows.map((r, i) => (
          <button
            key={r.id}
            className="secondary"
            onClick={() => void play(r.id)}
          >
            Xem video {i + 1}
          </button>
        ))
      )}
      {player && (
        <video key={player} controls autoPlay playsInline src={player} />
      )}
    </section>
  );
}
