import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api";
import { ClassroomMedia } from "./media";
import "./style.css";
import "./attendance.css";
import { AttendanceReport } from "./attendance";
import {
  RoleSwitcher,
  PreviewRecordings,
  PreviewRoom,
  previewRoles,
  previewUsers,
  previewCourses,
  previewClasses,
} from "./preview";
type User = { id: string; name: string; role: string; school_id: string };
type Meeting = {
  id: string;
  title: string;
  course: string;
  class_name: string;
  starts_at: string;
  status: string;
  recording_allowed: number | boolean;
};
const demo = new URLSearchParams(location.search).get("demo") === "1";
const previewRole =
  previewRoles.find(
    (v) => v.id === new URLSearchParams(location.search).get("role"),
  ) || previewRoles[1];
const sample: Meeting[] = [
  {
    id: "preview",
    title: "Hàm số và đồ thị",
    course: "Toán học",
    class_name: "10A1",
    starts_at: new Date().toISOString(),
    status: "live",
    recording_allowed: true,
  },
  {
    id: "preview-next",
    title: "Chuyển động thẳng đều",
    course: "Vật lý",
    class_name: "10A1",
    starts_at: new Date(Date.now() + 86400000).toISOString(),
    status: "scheduled",
    recording_allowed: false,
  },
  {
    id: "preview-ended",
    title: "Ôn tập phương trình bậc hai",
    course: "Toán học",
    class_name: "10A1",
    starts_at: new Date(Date.now() - 86400000).toISOString(),
    status: "ended",
    recording_allowed: true,
  },
];
function Video({
  stream,
  muted = false,
}: {
  stream: MediaStream;
  muted?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <video ref={ref} autoPlay playsInline muted={muted} controls={!muted} />
  );
}
function App() {
  const [user, setUser] = useState<User | null>(
      demo
        ? {
            id: "preview",
            name: previewRole.name,
            role: previewRole.id,
            school_id: "preview",
          }
        : null,
    ),
    [loading, setLoading] = useState(!demo),
    [error, setError] = useState(""),
    [page, setPage] = useState(
      new URLSearchParams(location.search).get("page") === "attendance"
        ? "attendance"
        : demo && previewRole.id === "admin"
          ? "admin"
          : "overview",
    ),
    [menuOpen, setMenuOpen] = useState(false),
    [meetings, setMeetings] = useState<Meeting[]>(demo ? sample : []),
    [courses, setCourses] = useState<any[]>(
      demo
        ? previewCourses.filter(
            (c) =>
              previewRole.id === "admin" ||
              (previewRole.id === "student"
                ? c.class_name === "10A1"
                : c.teacher === "Nguyễn Minh Anh"),
          )
        : [],
    ),
    [room, setRoom] = useState<Meeting | null>(null),
    [users, setUsers] = useState<any[]>(demo ? previewUsers : []),
    [classes, setClasses] = useState<any[]>(demo ? previewClasses : []),
    [notice, setNotice] = useState("");
  const safe = async (fn: () => Promise<void>) => {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  async function refresh() {
    if (demo) return;
    const [m, c] = await Promise.all([
      api<Meeting[]>("/meetings"),
      api<any[]>("/catalog"),
    ]);
    setMeetings(m);
    setCourses(c);
  }
  useEffect(() => {
    if (demo) return;
    api<User>("/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (user) void safe(refresh);
  }, [user]);
  if (loading)
    return (
      <main className="login">
        <p>Đang kết nối…</p>
      </main>
    );
  if (!user)
    return (
      <main className="login">
        <div className="login-art">
          <span className="brand">
            m<span>●</span> meet
          </span>
          <h1>
            Mỗi lớp học.
            <br />
            Một kết nối mới.
          </h1>
          <p>Không gian dạy và học trực tuyến dành cho trường của bạn.</p>
          <div className="orb">✳</div>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void safe(async () =>
              setUser(await api("/login", Object.fromEntries(f))),
            );
          }}
        >
          <span className="eyebrow">CHÀO MỪNG TRỞ LẠI</span>
          <h2>Đăng nhập trường học</h2>
          <p>Tài khoản do nhà trường cung cấp.</p>
          <label>
            Mã trường
            <input
              name="school"
              required
              defaultValue="demo"
              autoComplete="organization"
            />
          </label>
          <label>
            Email
            <input name="email" type="email" required autoComplete="username" />
          </label>
          <label>
            Mật khẩu
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button>Đăng nhập →</button>
          <a href="?demo=1">Xem trước giao diện</a>
        </form>
      </main>
    );
  if (room && demo)
    return (
      <PreviewRoom
        role={user.role}
        title={room.title}
        onExit={() => setRoom(null)}
      />
    );
  if (room)
    return (
      <Room
        meeting={room}
        user={user}
        onExit={() => {
          setRoom(null);
          void safe(refresh);
        }}
        onError={setError}
        error={error}
      />
    );
  return (
    <div className="shell">
      <aside>
        <button
          className="mobile-menu-control secondary"
          aria-expanded={menuOpen}
          aria-controls="main-navigation"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? "Đóng menu ✕" : "Menu ☰"}
        </button>
        <span className="brand">
          m<span>●</span> meet
        </span>
        <div className="school">
          <span className="school-icon">N</span>
          <div>
            <strong>
              {demo || user.school_id === "school-demo"
                ? "Trường Nguyễn Trãi"
                : "Trường của bạn"}
            </strong>
            <small>Không gian học tập</small>
          </div>
        </div>
        <small className="nav-label">KHÔNG GIAN CỦA BẠN</small>
        <nav id="main-navigation" className={menuOpen ? "mobile-open" : ""}>
          {[
            ["overview", "▦", "Tổng quan"],
            ["courses", "▤", "Lớp & môn học"],
            ["meetings", "◉", "Buổi học"],
            ["settings", "⚙", "Tài khoản"],
            ...(user.role === "admin" ? [["admin", "⇧", "Quản trị"]] : []),
            [
              "attendance",
              "◷",
              user.role === "student"
                ? "Điểm danh của tôi"
                : "Báo cáo điểm danh",
            ],
            ...(demo ? [["recordings", "▷", "Bản ghi bài học"]] : []),
          ].map(([key, icon, label]) => (
            <button
              key={key}
              className={page === key ? "active" : ""}
              onClick={() => {
                setPage(key);
                setMenuOpen(false);
                const params = new URLSearchParams(location.search);
                params.set("page", key);
                history.replaceState(null, "", "?" + params.toString());
                if (key === "admin" && !demo)
                  void safe(async () => {
                    setUsers(await api("/users"));
                    setClasses(await api("/classes"));
                  });
              }}
            >
              <span>{icon}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="aside-bottom">
          <span className="avatar">{user.name[0]}</span>
          <div>
            <strong>{user.name}</strong>
            <small>
              {user.role === "teacher"
                ? "Giáo viên"
                : user.role === "admin"
                  ? "Quản trị viên"
                  : "Học sinh"}
            </small>
          </div>
          <button
            title="Đăng xuất"
            onClick={() =>
              void safe(async () => {
                if (!demo) await api("/logout", {});
                location.href = "/";
              })
            }
          >
            ↗
          </button>
        </div>
      </aside>
      <main>
        <header>
          <span>
            Không gian học tập <b>/</b>{" "}
            {page === "overview"
              ? "Tổng quan"
              : page === "courses"
                ? "Lớp & môn học"
                : page === "meetings"
                  ? "Buổi học"
                  : page === "admin"
                    ? "Quản trị"
                    : page === "attendance"
                      ? "Điểm danh"
                      : page === "recordings"
                        ? "Bản ghi bài học"
                        : "Tài khoản"}
          </span>
          <span className="today">
            {new Intl.DateTimeFormat("vi-VN", { dateStyle: "full" }).format(
              new Date(),
            )}
          </span>
        </header>
        <div
          className="content"
          onSubmitCapture={(e) => {
            if (demo) {
              e.preventDefault();
              e.stopPropagation();
              setNotice(
                "Đây là bản xem trước. Thao tác lưu dữ liệu cần đăng nhập máy chủ thật.",
              );
            }
          }}
        >
          {demo && <RoleSwitcher role={user.role} />}
          {demo && page !== "attendance" && (
            <div className="banner">
              Bản xem trước giao diện · Dữ liệu mẫu, chưa kết nối máy chủ hoặc
              Cloudflare. <a href="/">Đăng nhập thật →</a>
            </div>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {notice && <div className="banner">{notice}</div>}
          <div className="heading">
            <div>
              <span className="eyebrow">HỌC TẬP CÙNG NHAU</span>
              <h1>
                {page === "overview"
                  ? `Chào ${user.name},`
                  : page === "courses"
                    ? "Lớp & môn học"
                    : page === "meetings"
                      ? "Buổi học của bạn"
                      : page === "admin"
                        ? "Quản trị trường học"
                        : page === "attendance"
                          ? "Điểm danh & thời gian học"
                          : page === "recordings"
                            ? "Bản ghi bài học"
                            : "Tài khoản của bạn"}
              </h1>
              <p>
                {page === "overview"
                  ? "Một ngày mới, thêm những điều để khám phá."
                  : "Quản lý hoạt động học tập trong trường của bạn."}
              </p>
            </div>
            <span className="leaf">✳</span>
          </div>
          {(page === "overview" || page === "meetings") && (
            <>
              <section className="stats">
                {[
                  [courses.length, "Môn học được phân công", "▤"],
                  [
                    meetings.filter((m) => m.status === "live").length,
                    "Buổi học đang diễn ra",
                    "◉",
                  ],
                  [
                    meetings.filter((m) => m.status === "scheduled").length,
                    "Buổi học sắp tới",
                    "◷",
                  ],
                ].map(([v, label, icon]) => (
                  <article key={label}>
                    <span>{icon}</span>
                    <strong>{v}</strong>
                    <small>{label}</small>
                  </article>
                ))}
              </section>
              <section className="section">
                <div className="section-title">
                  <div>
                    <h2>Lịch học của bạn</h2>
                    <p>Sẵn sàng cho buổi học tiếp theo</p>
                  </div>
                  <span className="pill">{meetings.length} buổi học</span>
                </div>
                <div className="meeting-list">
                  {meetings.length === 0 && (
                    <p>
                      Chưa có buổi học. Giáo viên có thể tạo buổi học bên dưới.
                    </p>
                  )}
                  {meetings.map((m) => (
                    <article className="meeting" key={m.id}>
                      <div className="date-tile">
                        <strong>{new Date(m.starts_at).getDate()}</strong>
                        <small>
                          THÁNG {new Date(m.starts_at).getMonth() + 1}
                        </small>
                      </div>
                      <div className="meeting-info">
                        <span className={"status " + m.status}>
                          {m.status === "live"
                            ? "● Đang diễn ra"
                            : m.status === "ended"
                              ? "Đã kết thúc"
                              : "Sắp diễn ra"}
                        </span>
                        <h3>{m.title}</h3>
                        <p>
                          {m.course} <span>·</span> Lớp {m.class_name}{" "}
                          <span>·</span>{" "}
                          {new Date(m.starts_at).toLocaleTimeString("vi-VN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                        {!!m.recording_allowed && (
                          <small>Buổi học cho phép giáo viên ghi hình</small>
                        )}
                      </div>
                      <button
                        className="secondary"
                        disabled={m.status === "ended"}
                        onClick={() => setRoom(m)}
                      >
                        Vào lớp ↗
                      </button>
                    </article>
                  ))}
                </div>
              </section>
              {user.role !== "student" && (
                <section className="section">
                  <h2>Tạo buổi học</h2>
                  <form
                    className="inline-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void safe(async () => {
                        if (demo) throw new Error("Đăng nhập để tạo buổi học");
                        await api("/meetings", {
                          course_id: f.get("course_id"),
                          title: f.get("title"),
                          starts_at: new Date(
                            String(f.get("starts_at")),
                          ).toISOString(),
                          recording_allowed: f.get("recording") === "on",
                        });
                        await refresh();
                        setNotice("Đã tạo buổi học");
                      });
                    }}
                  >
                    <label>
                      Môn học
                      <select name="course_id" required>
                        {courses.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} · {c.class_name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Chủ đề
                      <input name="title" required maxLength={200} />
                    </label>
                    <label>
                      Bắt đầu
                      <input name="starts_at" type="datetime-local" required />
                    </label>
                    <label className="checkbox">
                      <input name="recording" type="checkbox" /> Cho phép ghi
                      hình
                    </label>
                    <button disabled={demo}>Tạo buổi học</button>
                  </form>
                </section>
              )}
            </>
          )}
          {page === "courses" && (
            <section className="course-grid">
              {courses.map((c) => (
                <article key={c.id}>
                  <span className="course-icon">∑</span>
                  <span className="pill">Lớp {c.class_name}</span>
                  <h2>{c.name}</h2>
                  <p>Giáo viên: {c.teacher}</p>
                  <button
                    className="secondary"
                    onClick={() => setPage("meetings")}
                  >
                    Xem lịch học →
                  </button>
                </article>
              ))}
            </section>
          )}
          {page === "attendance" && (
            <AttendanceReport role={user.role} courses={courses} demo={demo} />
          )}
          {demo && page === "recordings" && <PreviewRecordings />}
          {page === "settings" && (
            <section className="section">
              <h2>Đổi mật khẩu</h2>
              <form
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void safe(async () => {
                    if (demo) return;
                    await api("/password", Object.fromEntries(f));
                    location.href = "/";
                  });
                }}
              >
                <label>
                  Mật khẩu hiện tại
                  <input
                    type="password"
                    name="current"
                    required
                    autoComplete="current-password"
                  />
                </label>
                <label>
                  Mật khẩu mới
                  <input
                    type="password"
                    name="new"
                    required
                    minLength={12}
                    maxLength={72}
                    autoComplete="new-password"
                  />
                </label>
                <button disabled={demo}>Lưu mật khẩu</button>
              </form>
            </section>
          )}
          {page === "admin" && (
            <>
              <section className="section">
                <h2>Import tài khoản từ Excel</h2>
                <p>
                  Một sheet, tối đa 100 dòng. Cột: email, name, role, password,
                  class. Role: teacher hoặc student. Mật khẩu ít nhất 12 ký tự.
                </p>
                <input
                  type="file"
                  accept=".xlsx"
                  disabled={demo}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file)
                      void safe(async () => {
                        const f = new FormData();
                        f.set("file", file);
                        const res = await api("/import", f);
                        setNotice(`Đã import ${res.imported} tài khoản`);
                        setUsers(await api("/users"));
                        setClasses(await api("/classes"));
                      });
                  }}
                />
              </section>
              <section className="section">
                <h2>Tạo lớp</h2>
                <form
                  className="inline-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void safe(async () => {
                      await api("/classes", Object.fromEntries(f));
                      setClasses(await api("/classes"));
                      setNotice("Đã tạo lớp");
                    });
                  }}
                >
                  <label>
                    Tên lớp
                    <input name="name" required />
                  </label>
                  <button>Tạo lớp</button>
                </form>
                <h2>Tạo môn học</h2>
                <form
                  className="inline-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void safe(async () => {
                      await api("/courses", Object.fromEntries(f));
                      await refresh();
                      setNotice("Đã tạo môn học");
                    });
                  }}
                >
                  <label>
                    Tên môn
                    <input name="name" required />
                  </label>
                  <label>
                    Lớp
                    <select name="class_id" required>
                      {classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Giáo viên
                    <select name="teacher_id">
                      {users
                        .filter((u) => u.role === "teacher")
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button>Tạo môn</button>
                </form>
                <h2>Thêm học sinh vào lớp</h2>
                <form
                  className="inline-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void safe(async () => {
                      await api("/enrollments", Object.fromEntries(f));
                      setNotice("Đã thêm học sinh vào lớp");
                    });
                  }}
                >
                  <label>
                    Lớp
                    <select name="class_id" required>
                      {classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Học sinh
                    <select name="user_id" required>
                      {users
                        .filter((u) => u.role === "student")
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} · {u.email}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button>Thêm vào lớp</button>
                </form>
              </section>
              <section className="section">
                <h2>Tài khoản ({users.length})</h2>
                <table className="attendance-table">
                  <thead>
                    <tr>
                      <th>Họ tên</th>
                      <th>Email</th>
                      <th>Vai trò</th>
                      <th>ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td data-label="Họ tên">{u.name}</td>
                        <td data-label="Email">{u.email}</td>
                        <td data-label="Vai trò">
                          {u.role === "teacher"
                            ? "Giáo viên"
                            : u.role === "student"
                              ? "Học sinh"
                              : "Admin"}
                        </td>
                        <td data-label="ID">{u.id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </>
          )}
          <footer>
            Meet <span>·</span> Kết nối tri thức, cùng nhau tiến bộ.
          </footer>
        </div>
      </main>
    </div>
  );
}
function Room({
  meeting,
  user,
  onExit,
  onError,
  error,
}: {
  meeting: Meeting;
  user: User;
  onExit: () => void;
  onError: (s: string) => void;
  error: string;
}) {
  const [state, setState] = useState(meeting.status),
    [joined, setJoined] = useState(false),
    [local, setLocal] = useState<MediaStream | null>(null),
    [remote, setRemote] = useState<
      Record<string, { stream: MediaStream; name: string }>
    >({}),
    [attendance, setAttendance] = useState<any[]>([]),
    [recordings, setRecordings] = useState<any[]>([]),
    [recording, setRecording] = useState(false),
    [busy, setBusy] = useState(false);
  const media = useRef<ClassroomMedia | null>(null),
    rec = useRef<MediaRecorder | null>(null),
    display = useRef<MediaStream | null>(null),
    joinedRef = useRef(false),
    canManage = user.role !== "student";
  const run = async (fn: () => Promise<void>) => {
    onError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const list = await api<Meeting[]>("/meetings");
        const current = list.find((v) => v.id === meeting.id);
        if (active && current) {
          setState(current.status);
          if (current.status === "ended") {
            media.current?.close();
            setJoined(false);
            setLocal(null);
          }
        }
      } catch (e) {
        if (active) onError((e as Error).message);
      }
    };
    const timer = setInterval(() => void poll(), 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    joinedRef.current = joined;
    if (!joined) return;
    let stopped = false,
      ticking = false;
    const tick = async () => {
      if (ticking || stopped) return;
      ticking = true;
      try {
        await api(`/meetings/${meeting.id}/presence`, { kind: "heartbeat" });
        if (stopped) return;
        setAttendance(await api(`/meetings/${meeting.id}/attendance`));
        await media.current?.subscribe(
          await api(`/meetings/${meeting.id}/tracks`),
          user.id,
        );
      } catch (e) {
        onError((e as Error).message);
      } finally {
        ticking = false;
      }
    };
    const timer = setInterval(() => void tick(), 15000);
    void tick();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [joined]);
  useEffect(
    () => () => {
      media.current?.close();
      display.current?.getTracks().forEach((t) => t.stop());
      if (rec.current?.state === "recording") rec.current.stop();
      if (joinedRef.current)
        void api(`/meetings/${meeting.id}/presence`, { kind: "leave" }).catch(
          () => {},
        );
    },
    [],
  );
  async function join() {
    await api(`/meetings/${meeting.id}/presence`, { kind: "join" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 360 },
        audio: true,
      });
      setLocal(stream);
      media.current = new ClassroomMedia(meeting.id, (key, stream, name) =>
        setRemote((v) => ({ ...v, [key]: { stream, name } })),
      );
      await media.current.publish(stream);
      setJoined(true);
    } catch (e) {
      media.current?.close();
      setLocal(null);
      await api(`/meetings/${meeting.id}/presence`, { kind: "leave" });
      throw e;
    }
  }
  async function record() {
    if (rec.current?.state === "recording") {
      rec.current.stop();
      return;
    }
    const capture = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
    display.current = capture;
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(capture, { mimeType: "video/webm" });
    rec.current = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onstop = () => {
      setRecording(false);
      capture.getTracks().forEach((t) => t.stop());
      void run(async () => {
        const blob = new Blob(chunks, { type: "video/webm" });
        if (blob.size > 1 << 30) throw new Error("Bản ghi vượt quá 1 GiB");
        const item = await api(`/meetings/${meeting.id}/recordings`, {});
        const res = await fetch(item.upload_url, {
          method: "PUT",
          headers: { "Content-Type": "video/webm" },
          body: blob,
        });
        if (!res.ok) throw new Error("Tải bản ghi thất bại");
        await api(`/meetings/${meeting.id}/recordings/${item.id}/complete`, {});
        setRecordings(await api(`/meetings/${meeting.id}/recordings`));
      });
    };
    capture.getVideoTracks()[0].onended = () => {
      if (recorder.state === "recording") recorder.stop();
    };
    recorder.start(1000);
    setRecording(true);
  }
  return (
    <main className="room">
      <header>
        <span className="brand">
          m<span>●</span> meet
        </span>
        <h2>{meeting.title}</h2>
        <button
          className="secondary"
          disabled={busy || recording}
          onClick={() =>
            void run(async () => {
              if (joined)
                await api(`/meetings/${meeting.id}/presence`, {
                  kind: "leave",
                });
              joinedRef.current = false;
              onExit();
            })
          }
        >
          Rời lớp
        </button>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="room-toolbar">
        <span className="pill">
          {meeting.class_name} · {meeting.course}
        </span>
        <span>{state}</span>
        {!!meeting.recording_allowed && (
          <span>Giáo viên có thể ghi hình buổi học này.</span>
        )}
        {canManage && state === "scheduled" && (
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api(`/meetings/${meeting.id}/state`, { status: "live" });
                setState("live");
              })
            }
          >
            Bắt đầu buổi học
          </button>
        )}
        {state === "live" && !joined && (
          <button disabled={busy} onClick={() => void run(join)}>
            Bật camera & tham gia
          </button>
        )}
        {joined && (
          <>
            <button onClick={() => media.current?.toggle("audio")}>
              Bật/tắt mic
            </button>
            <button onClick={() => media.current?.toggle("video")}>
              Bật/tắt camera
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  display.current = await media.current!.share();
                })
              }
            >
              Chia sẻ màn hình
            </button>
            {canManage && !!meeting.recording_allowed && (
              <button disabled={busy} onClick={() => void run(record)}>
                {recording ? "● Dừng & lưu bản ghi" : "Ghi màn hình vào R2"}
              </button>
            )}
          </>
        )}
        {canManage && state === "live" && (
          <button
            disabled={busy || recording}
            onClick={() =>
              void run(async () => {
                await api(`/meetings/${meeting.id}/state`, { status: "ended" });
                setState("ended");
                setJoined(false);
                media.current?.close();
                setLocal(null);
              })
            }
          >
            Kết thúc buổi học
          </button>
        )}
      </div>
      <div className="video-grid">
        {local && (
          <article>
            <Video stream={local} muted />
            <strong>Bạn</strong>
          </article>
        )}
        {Object.entries(remote).map(([k, v]) => (
          <article key={k}>
            <Video stream={v.stream} />
            <strong>{v.name}</strong>
          </article>
        ))}
      </div>
      <section className="section">
        <h2>Điểm danh theo thời gian tham gia</h2>
        <button
          className="secondary"
          onClick={() =>
            void run(async () =>
              setAttendance(await api(`/meetings/${meeting.id}/attendance`)),
            )
          }
        >
          Tải báo cáo
        </button>
        <table>
          <thead>
            <tr>
              <th>Học sinh</th>
              <th>Thời gian được ghi nhận</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {attendance.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>
                  {Math.floor(a.seconds / 60)} phút {a.seconds % 60} giây
                </td>
                <td>{a.online ? "Trong lớp" : "Ngoại tuyến"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Ghi nhận bằng heartbeat mỗi 15 giây; khoảng mất kết nối trên 45 giây
          không được cộng. Đây là thời gian kết nối, không xác nhận mức độ chú
          ý.
        </p>
      </section>
      <section className="section">
        <h2>Bản ghi buổi học</h2>
        <button
          className="secondary"
          onClick={() =>
            void run(async () =>
              setRecordings(await api(`/meetings/${meeting.id}/recordings`)),
            )
          }
        >
          Tải danh sách
        </button>
        {recordings.map((v) => (
          <p key={v.id}>
            <button
              onClick={() =>
                void run(async () => {
                  const d = await api(
                    `/meetings/${meeting.id}/recordings/${v.id}/download`,
                  );
                  window.open(d.url, "_blank", "noopener");
                })
              }
            >
              Xem bản ghi · {Math.round(v.size_bytes / 1024 / 1024)} MB
            </button>
          </p>
        ))}
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
