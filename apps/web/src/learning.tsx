import { DeleteLearningData } from "./academy-data-cleanup";
import {vnDateTime} from "./date-format";
import {VNMonthInput} from './date-input';
import { useEffect, useRef, useState } from "react";
import { ClassroomCourses } from "./classroom";
import type { ReactNode } from "react";
import { api } from "./api";
import { useAcademyRoute, reportQuery } from "./academy-route";
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
  classCatalog,
  meetings,
  demo = false,
  reports = false,
  onOpen,
  onRefresh,
  canTeach = true,
  canVideo = true,
 canLive = true,
  renderClasswork,
  routed = false,
}: {
  role: string;
  courses: Course[];
  classCatalog?: { id: string; name: string }[];
  meetings: Lesson[];
  demo?: boolean;
  reports?: boolean;
  onOpen: (m: any) => void;
  onRefresh: () => Promise<void>;
  canTeach?: boolean;
  canVideo?: boolean;
 canLive?: boolean;
  renderClasswork?: (id: string) => ReactNode;
  routed?: boolean;
}) {
  useAcademyRoute();
  const q = new URLSearchParams(location.search);
  const [classState, setClassState] = useState(""),
    [expandedState, setExpandedState] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const classId = routed && reports ? q.get("lop") || "" : classState,
    expanded = routed && reports ? q.get("mon") || "" : expandedState;
  const setClassId = (id: string) =>
    routed && reports
      ? reportQuery({
          lop: id,
          mon: null,
          buoi: null,
          video: null,
          "thong-ke": null,
          trang: null,
        })
      : setClassState(id);
  const setExpanded = (id: string) =>
    routed && reports
      ? reportQuery({
          mon: id,
          buoi: null,
          video: null,
          "thong-ke": null,
          trang: null,
        })
      : setExpandedState(id);
  const classes = [
    ...new Map([
      ...courses.map(
        (c) => [c.class_id, { id: c.class_id, name: c.class_name }] as const,
      ),
      ...(classCatalog || []).map((c) => [c.id, c] as const),
    ]).values(),
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
  if (!reports && role !== "admin")
    return (
      <ClassroomCourses
        routed={routed}
        demo={demo}
        role={role}
        courses={courses}
        meetings={meetings}
        busy={busy}
        error={error}
        canTeach={canTeach}
 canLive={canLive}
        onPrepare={(c) => void prepare(c)}
        onOpen={onOpen}
        renderClasswork={renderClasswork}
        renderLessons={(c) => (
          <CourseLessons
            key={c.id}
            course={c}
            role={role}
            demo={demo}
            reports={false}
            routed={routed}
            canVideo={canVideo}
 canLive={canLive}
            samples={meetings.filter((m) => m.course_id === c.id)}
            onOpen={onOpen}
          />
        )}
      />
    );
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
              if (!routed) setExpanded("");
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
      {routed && reports && (
        <label className="learning-filter">
          Tháng báo cáo
          <VNMonthInput
            value={q.get("thang") || ""}
            onValueChange={(value) =>
              reportQuery({
                thang: value,
                buoi: null,
                video: null,
                "thong-ke": null,
                trang: null,
              })
            }
          />
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
                          if (!routed) setExpanded("");
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
          routed={routed}
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
  routed = false,
  canVideo,
 canLive = true,
  samples,
  onOpen,
}: {
  course: Course;
  role: string;
  demo: boolean;
  reports: boolean;
  routed?: boolean;
  canVideo: boolean;
 canLive?: boolean;
  samples: Lesson[];
  onOpen: (m: any) => void;
}) {
  useAcademyRoute();
  const params = new URLSearchParams(location.search),
    routeReport = routed;
  const [lessons, setLessons] = useState<Lesson[]>([]),
    [pageState, setPageState] = useState(0),
    [detailState, setDetailState] = useState<string | null>(null),
    [videoState, setVideoState] = useState(""),
    [error, setError] = useState("");
  const page = routeReport
      ? Math.max(0, Number(params.get("trang")) || 0)
      : pageState,
    detail = routeReport
      ? params.has("thong-ke")
        ? params.get("buoi") || ""
        : null
      : detailState,
    videoLesson = routeReport ? params.get("video") || "" : videoState,
    month = routeReport ? params.get("thang") || "" : "";
  const setPage = (v: number | ((old: number) => number)) => {
    const next = typeof v === "function" ? v(page) : v;
    if (routeReport) reportQuery({ trang: String(next) });
    else setPageState(next);
  };
  const setDetail = (id: string | null) =>
    routeReport
      ? reportQuery({ buoi: id, "thong-ke": id === null ? null : "1" })
      : setDetailState(id);
  const setVideoLesson = (id: string) =>
    routeReport ? reportQuery({ video: id }) : setVideoState(id);
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
          `/meetings?course_id=${encodeURIComponent(course.id)}&page=${page}&month=${encodeURIComponent(month)}`,
        );
    void req
      .then((v) => {
        if (current) setLessons(month&&demo?v.filter(l=>new Date(new Date(l.starts_at).getTime()+7*3600000).toISOString().slice(0,7)===month):v);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [course.id, page, demo, month]);
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
                <td>{vnDateTime(m.starts_at)}</td>
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
                    <button disabled={role === "student" && !canLive} onClick={() => onOpen(m)}>{role === "student" && !canLive ? "Cần VIP còn hạn" : "Vào lớp học"}</button>
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
        <LessonVideos key={videoLesson} meeting={videoLesson} demo={demo} role={role} />
      )}
      {detail !== null && (
        <AttendanceReport
          key={course.id + detail}
          role={role}
          courses={[course]}
          demo={demo}
          preferredCourseId={course.id}
          preferredMeetingId={detail}
          month={month}
          routed={routeReport}
        />
      )}
    </div>
  );
}
function LessonVideos({ meeting, demo, role }: { meeting: string; demo: boolean; role:string }) {
  const [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState(""),
    [player, setPlayer] = useState(""),
    [part, setPart] = useState(0),
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
        if (active)
          setRows(
            v.sort(
              (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
            ),
          );
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
    setPart(rows.findIndex((row) => row.id === id));
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
 {role === "admin" && rows.length > 0 && <DeleteLearningData kind="videos" label="Xóa video buổi này" scope={{meeting_id:meeting}} demo={demo} onDeleted={()=>{generation.current++;setRows([]);setPlayer("")}}/>}
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
        <button className="secondary" onClick={() => void play(rows[0].id)}>
          Xem video buổi học
        </button>
      )}
      {player && (
        <>
          {rows.length > 1 && (
            <label>
              Đoạn video{" "}
              <select
                value={part}
                onChange={(e) => void play(rows[Number(e.target.value)].id)}
              >
                {rows.map((r, i) => (
                  <option key={r.id} value={i}>
                    {i + 1} / {rows.length}
                  </option>
                ))}
              </select>
            </label>
          )}
          <video
            key={player}
            controls
            autoPlay
            playsInline
            src={player}
            onEnded={() => {
              if (rows[part + 1]) void play(rows[part + 1].id);
            }}
          />
        </>
      )}
    </section>
  );
}
