import { useState, type ReactNode } from "react";
import "./classroom.css";
import { ClassroomCommunity } from "./classroom-community";
type Subject = {
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
  status: string;
  starts_at: string;
};
type Props = {
  demo?: boolean;
  role: string;
  courses: Subject[];
  meetings: Lesson[];
  busy: string;
  error: string;
  canTeach: boolean;
  onPrepare: (c: Subject) => void;
  onOpen: (m: any) => void;
  renderLessons: (c: Subject) => ReactNode;
  renderClasswork?: (id: string) => ReactNode;
};
const colors = ["#1967d2", "#137e70", "#7543aa", "#b34a26", "#336b8c"];
const color = (id: string) =>
  colors[
    Array.from(id).reduce((n, c) => n + c.charCodeAt(0), 0) % colors.length
  ];
export function ClassroomCourses(p: Props) {
  const [classId, setClassId] = useState(""),
    [subjectId, setSubjectId] = useState(""),
    [query, setQuery] = useState(""),
    [tab, setTab] = useState("stream");
  const classes = [
    ...new Map(
      p.courses.map((c) => [
        c.class_id,
        { id: c.class_id, name: c.class_name },
      ]),
    ).values(),
  ];
  const current = p.courses.find((c) => c.id === subjectId);
  const active = (c: Subject) =>
    p.meetings.find((m) => m.course_id === c.id && m.status === "live") ||
    p.meetings.find((m) => m.course_id === c.id && m.status === "scheduled") ||
    (c.ready_meeting_id
      ? {
          id: c.ready_meeting_id,
          title: c.name,
          status: c.ready_status || "scheduled",
          course_id: c.id,
          starts_at: "",
        }
      : undefined);
  const open = (id: string, next = "stream") => {
    setSubjectId(id);
    setTab(next);
  };
  const shown = p.courses
    .filter(
      (c) =>
        (p.role === "student" || !classId || c.class_id === classId) &&
        (c.name + " " + c.class_name + " " + c.teacher)
          .toLocaleLowerCase("vi")
          .includes(query.toLocaleLowerCase("vi")),
    )
    .sort(
      (a, b) =>
        Number(active(b)?.status === "live") -
          Number(active(a)?.status === "live") ||
        Number(!!active(b)) - Number(!!active(a)) ||
        a.name.localeCompare(b.name, "vi"),
    );
  const classwork = current && p.renderClasswork?.(current.id);
  return (
    <section
      className="classroom-workspace"
      data-detail={!!current}
      aria-label="Không gian lớp học"
    >
      <div className="classroom-heading">
        <div>
          <small>
            {p.role === "teacher"
              ? "KHÔNG GIAN GIẢNG DẠY"
              : "KHÔNG GIAN HỌC TẬP"}
          </small>
          <h2>{current ? current.name : "Lớp học của tôi"}</h2>
          <p>
            {current
              ? current.class_name
              : p.role === "teacher"
                ? "Các lớp và môn học được phân công cho bạn."
                : "Các môn bạn đang theo học. Môn đang học được ưu tiên hiển thị."}
          </p>
        </div>
        {current ? (
          <button className="secondary" onClick={() => setSubjectId("")}>
            ← Danh sách lớp
          </button>
        ) : (
          <label className="classroom-search">
            <span>Tìm lớp hoặc môn học</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm lớp, môn học, giáo viên…"
            />
          </label>
        )}
      </div>
      {p.error && (
        <p className="error" role="alert">
          {p.error}
        </p>
      )}
      {!current && p.role === "teacher" && (
        <label className="classroom-filter">
          Lớp học
          <select value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">Tất cả lớp được phân công</option>
            {classes.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {!current &&
        (p.role === "teacher" && !classId && !query ? (
          <div className="classroom-card-grid">
            {classes.map((cl) => {
              const subjects = p.courses.filter((c) => c.class_id === cl.id);
              return (
                <article
                  className="classroom-card"
                  key={cl.id}
                  style={
                    { "--class-color": color(cl.id) } as React.CSSProperties
                  }
                >
                  <div className="classroom-card-cover">
                    <small>LỚP HỌC</small>
                    <h3>{cl.name}</h3>
                    <span>{subjects.length} môn được phân công</span>
                    <div className="classroom-cover-lines" />
                  </div>
                  <div className="classroom-card-content">
                    <span className="classroom-card-avatar" aria-hidden="true">
                      {cl.name.slice(0, 2)}
                    </span>
                    <p>{subjects.map((c) => c.name).join(" · ")}</p>
                    <small>
                      {
                        subjects.filter((c) => active(c)?.status === "live")
                          .length
                      }{" "}
                      môn đang học
                    </small>
                  </div>
                  <footer>
                    <button
                      className="secondary"
                      onClick={() => setClassId(cl.id)}
                    >
                      Xem môn học
                    </button>
                  </footer>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="classroom-card-grid">
            {shown.map((c) => {
              const m = active(c),
                live = m?.status === "live";
              return (
                <article
                  className="classroom-card"
                  key={c.id}
                  style={
                    { "--class-color": color(c.id) } as React.CSSProperties
                  }
                >
                  <div className="classroom-card-cover">
                    <small>{c.class_name}</small>
                    <h3>
                      <button onClick={() => open(c.id)}>{c.name}</button>
                    </h3>
                    <span>{c.teacher || "Chưa phân công giáo viên"}</span>
                    <div className="classroom-cover-lines" />
                  </div>
                  <div className="classroom-card-content">
                    <span className="classroom-card-avatar" aria-hidden="true">
                      {(c.teacher || c.name)
                        .trim()
                        .split(" ")
                        .at(-1)
                        ?.slice(0, 1)}
                    </span>
                    <span
                      className={"classroom-state " + (live ? "is-live" : "")}
                    >
                      {live
                        ? "Đang học"
                        : m
                          ? "Giáo viên đang chuẩn bị"
                          : "Chưa bắt đầu"}
                    </span>
                    <p>
                      {c.lesson_count ??
                        p.meetings.filter((m) => m.course_id === c.id)
                          .length}{" "}
                      buổi học
                    </p>
                  </div>
                  <footer>
                    {p.role === "student" ? (
                      <button disabled={!live} onClick={() => p.onOpen(m)}>
                        {live ? "Vào lớp học" : "Đang chờ"}
                      </button>
                    ) : (
                      p.canTeach && (
                        <button
                          disabled={!!p.busy}
                          onClick={() => p.onPrepare(c)}
                        >
                          {p.busy === c.id
                            ? "Đang chuẩn bị…"
                            : m
                              ? "Vào phòng dạy"
                              : "Chuẩn bị dạy"}
                        </button>
                      )
                    )}
                    <button
                      className="secondary"
                      onClick={() => open(c.id, "lessons")}
                    >
                      Các buổi học & video
                    </button>
                  </footer>
                </article>
              );
            })}
          </div>
        ))}
      {!current && !shown.length && (
        <div className="classroom-empty">
          <h3>
            {query
              ? "Không tìm thấy lớp học"
              : "Chưa có môn học được phân công"}
          </h3>
          <p>
            {query
              ? "Thử tìm bằng tên môn hoặc giáo viên."
              : "Các môn học sẽ xuất hiện tại đây khi bạn được phân công hoặc ghi danh."}
          </p>
        </div>
      )}
      {current && (
        <>
          <div
            className="classroom-subject-banner"
            style={
              { "--class-color": color(current.id) } as React.CSSProperties
            }
          >
            <small>{current.class_name}</small>
            <h2>{current.name}</h2>
            <p>{current.teacher || "Chưa phân công giáo viên"}</p>
            <div className="classroom-cover-lines" />
          </div>
          <div
            className="classroom-tabs"
            role="tablist"
            aria-label="Nội dung môn học"
          >
            {[
              ["stream", "Bảng tin"],
              ["lessons", "Buổi học & video"],
              ...(classwork ? [["classwork", "Bài tập"]] : []),
              ["people", "Thành viên"],
              ["info", "Thông tin lớp"],
            ].map(([id, label]) => (
              <button
                role="tab"
                id={"classroom-tab-" + id}
                aria-selected={tab === id}
                aria-controls="classroom-tab-content"
                tabIndex={tab === id ? 0 : -1}
                key={id}
                onKeyDown={(e) => {
                  if (
                    ["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)
                  ) {
                    e.preventDefault();
                    const buttons = Array.from(
                      e.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
                        "[role=tab]",
                      ),
                    );
                    let n = buttons.indexOf(e.currentTarget);
                    n =
                      e.key === "Home"
                        ? 0
                        : e.key === "End"
                          ? buttons.length - 1
                          : (n +
                              (e.key === "ArrowRight" ? 1 : -1) +
                              buttons.length) %
                            buttons.length;
                    buttons[n].click();
                    buttons[n].focus();
                  }
                }}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id="classroom-tab-content"
            aria-labelledby={"classroom-tab-" + tab}
          >
            {tab === "lessons" ? (
              p.renderLessons(current)
            ) : tab === "classwork" ? (
              classwork
            ) : tab === "people" ? (
              <ClassroomCommunity
                course={current}
                role={p.role}
                demo={p.demo}
                people
              />
            ) : tab === "info" ? (
              <section className="classroom-info">
                <h3>Thông tin môn học</h3>
                <dl>
                  <dt>Lớp học</dt>
                  <dd>{current.class_name}</dd>
                  <dt>Môn học</dt>
                  <dd>{current.name}</dd>
                  <dt>Giáo viên</dt>
                  <dd>{current.teacher || "Chưa phân công"}</dd>
                </dl>
              </section>
            ) : (
              <div className="classroom-stream">
                <aside>
                  <h3>Phòng học trực tiếp</h3>
                  <p>
                    {active(current)?.status === "live"
                      ? "Buổi học đang diễn ra"
                      : active(current)
                        ? "Giáo viên đang chuẩn bị buổi học"
                        : "Chưa có buổi học bắt đầu"}
                  </p>
                  {p.role === "student" ? (
                    <button
                      disabled={active(current)?.status !== "live"}
                      onClick={() => p.onOpen(active(current))}
                    >
                      {active(current)?.status === "live"
                        ? "Vào lớp học"
                        : "Đang chờ"}
                    </button>
                  ) : (
                    p.canTeach && (
                      <button
                        disabled={!!p.busy}
                        onClick={() => p.onPrepare(current)}
                      >
                        {active(current) ? "Vào phòng dạy" : "Chuẩn bị dạy"}
                      </button>
                    )
                  )}
                </aside>
                <section aria-label="Hoạt động của môn học">
                  <ClassroomCommunity
                    course={current}
                    role={p.role}
                    demo={p.demo}
                  />
                  <h3>Hoạt động lớp học</h3>
                  {p.meetings
                    .filter((m) => m.course_id === current.id)
                    .slice()
                    .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
                    .map((m) => (
                      <article className="classroom-stream-item" key={m.id}>
                        <span
                          className="classroom-event-icon"
                          aria-hidden="true"
                        >
                          ▤
                        </span>
                        <div>
                          <strong>{m.title}</strong>
                          <p>
                            {m.starts_at
                              ? new Date(m.starts_at).toLocaleString("vi-VN")
                              : ""}{" "}
                            ·{" "}
                            {m.status === "live"
                              ? "Đang học"
                              : m.status === "scheduled"
                                ? "Đang chuẩn bị"
                                : "Đã kết thúc"}
                          </p>
                          <button
                            className="secondary"
                            onClick={() => setTab("lessons")}
                          >
                            Xem buổi học
                          </button>
                        </div>
                      </article>
                    ))}
                  {!p.meetings.some((m) => m.course_id === current.id) && (
                    <p className="classroom-empty">
                      Chưa có hoạt động của môn học. Các buổi học sẽ được cập
                      nhật tại đây.
                    </p>
                  )}
                </section>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
