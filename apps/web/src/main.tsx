import { Accounts } from "./accounts";
import { AccountSecurity } from "./account";
import { AcademicAdmin } from "./academic";
import { RoomTools } from "./room-tools";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, ApiError } from "./api";
import { ClassroomMedia } from "./media";
import { captureDevices } from "./devices";
import type { RoomRules } from "./room-moderation";
import { RoomDevices } from "./room-devices";
import "./style.css";
import "./meet-room.css";
import "./attendance.css";
import "./comparison-tables.css";
import { RecordingLibrary } from "./recordings";
import { AttendanceReport } from "./attendance";
import { Setup } from "./setup";
import { AuditLog } from "./audit";
import { PasswordRecovery } from "./password-recovery";
import { RecordingRecovery } from "./recording-recovery";
import {
  appendChunk,
  saveJob,
  getJob,
  stopJob,
  uploadRecording,
  acquireCapture,
  MAX_RECORDING_SIZE,
  PART_SIZE,
} from "./recording-store";
import "./workspace.css";
import {
  RoleSwitcher,
  PreviewRoom,
  previewRoles,
  previewUsers,
  previewCourses,
  previewClasses,
} from "./preview";
type User = {
  id: string;
  name: string;
  role: string;
  school_id: string;
  permissions?: string[] | null;
};
type Meeting = {
  id: string;
  title: string;
  course: string;
  class_name: string;
  starts_at: string;
  status: string;
  recording_allowed: number | boolean;
  course_id?: string;
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
  sinkId = "",
}: {
  stream: MediaStream;
  muted?: boolean;
  sinkId?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  useEffect(() => {
    const video = ref.current as
      (HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (video?.setSinkId) void video.setSinkId(sinkId).catch(() => {});
  }, [sinkId]);
  return (
    <video ref={ref} autoPlay playsInline muted={muted} controls={!muted} />
  );
}
function App() {
  const [loginChallenge, setLoginChallenge] = useState("");
  const [managed, setManaged] = useState(false);
  useEffect(() => {
    if (!demo)
      void api<any>("/public-config")
        .then((v) => setManaged(v.managed))
        .catch(() => {});
  }, []);
  useEffect(() => {
    const ended = () => {
      setUser(null);
      setRoom(null);
      setError("Phiên đã kết thúc. Vui lòng đăng nhập lại.");
    };
    window.addEventListener("meet-session-ended", ended);
    return () => window.removeEventListener("meet-session-ended", ended);
  }, []);
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
      [
        "overview",
        "courses",
        "meetings",
        "settings",
        "admin",
        "recordings",
        "attendance",
        "audit",
      ].includes(new URLSearchParams(location.search).get("page") || "")
        ? new URLSearchParams(location.search).get("page")!
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
  const allowed = (p: string) =>
    user?.role !== "admin" ||
    user.permissions == null ||
    user.permissions.includes(p);
  async function refresh() {
    if (demo) return;
    const [m, c] = await Promise.all([
      allowed("meetings") || allowed("attendance") || allowed("recordings")
        ? api<Meeting[]>("/meetings")
        : Promise.resolve([]),
      api<any[]>("/catalog"),
    ]);
    setMeetings(m);
    setCourses(c);
  }
  useEffect(() => {
    if (demo) return;
    api("/setup/status")
      .then((s) => {
        if (s.available && !s.initialized) location.replace("/setup");
      })
      .catch(() => {});
    api<User>("/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (user) void safe(refresh);
  }, [user]);
  const openedRoom = useRef("");
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("room");
    if (!demo && user && id && id !== openedRoom.current) {
      openedRoom.current = id;
      void api<Meeting>(`/meetings/${encodeURIComponent(id)}`)
        .then(setRoom)
        .catch((e) => setError(e.message));
    }
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
            void safe(async () => {
              const result = await api<any>(
                loginChallenge ? "/login/2fa" : "/login",
                loginChallenge
                  ? { challenge: loginChallenge, code: f.get("code") }
                  : Object.fromEntries(f),
              );
              if (result.requires_2fa) setLoginChallenge(result.challenge);
              else {
                setLoginChallenge("");
                setUser(result);
              }
            });
          }}
        >
          <span className="eyebrow">CHÀO MỪNG TRỞ LẠI</span>
          <h2>Đăng nhập trường học</h2>
          <p>Tài khoản do nhà trường cung cấp.</p>
          {!loginChallenge && (
            <>
              <label>
                Email hoặc mã SV
                <input
                  name="email"
                  type="text"
                  required
                  autoComplete="username"
                  placeholder="Email hoặc mã SV"
                />
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
            </>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {loginChallenge && (
            <>
              <label>
                Mã xác thực 2FA
                <input
                  name="code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  autoComplete="one-time-code"
                  placeholder="6 chữ số"
                />
              </label>
            </>
          )}
          <button>{loginChallenge ? "Xác thực →" : "Đăng nhập →"}</button>
          {loginChallenge && (
            <button
              type="button"
              onClick={() => {
                setLoginChallenge("");
                setError("");
              }}
            >
              Quay lại đăng nhập
            </button>
          )}
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
        <nav
          aria-label="Điều hướng chính"
          id="main-navigation"
          className={menuOpen ? "mobile-open" : ""}
        >
          {[
            ["overview", "▦", "Tổng quan"],
            ["courses", "▤", "Lớp & môn học"],
            ["meetings", "◉", "Buổi học"],
            ["settings", "⚙", "Tài khoản"],
            ...(user.role === "admin" ? [["admin", "⇧", "Quản trị"]] : []),
            ...(user.role === "admin" && allowed("audit")
              ? [["audit", "≡", "Nhật ký"]]
              : []),
            [
              "attendance",
              "◷",
              user.role === "student"
                ? "Điểm danh của tôi"
                : "Báo cáo điểm danh",
            ],
            ...(allowed("recordings")
              ? [["recordings", "▷", "Bản ghi bài học"]]
              : []),
          ]
            .filter(([key]) => key !== "attendance" || allowed("attendance"))
            .filter(([key]) => key !== "meetings" || allowed("meetings"))
            .map(([key, icon, label]) => (
              <button
                key={key}
                aria-current={page === key ? "page" : undefined}
                className={page === key ? "active" : ""}
                onClick={() => {
                  setPage(key);
                  setMenuOpen(false);
                  const params = new URLSearchParams(location.search);
                  params.set("page", key);
                  history.replaceState(null, "", "?" + params.toString());
                  if (key === "admin" && !demo && allowed("academic"))
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
                        : page === "audit"
                          ? "Nhật ký hoạt động"
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
            if (demo && page !== "admin") {
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
          {!demo && user.role !== "student" && (
            <RecordingRecovery owner={user.id} school={user.school_id} />
          )}
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
                            : page === "audit"
                              ? "Nhật ký hoạt động"
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
                        disabled={
                          m.status === "ended" ||
                          (user.role === "student" && m.status !== "live")
                        }
                        onClick={() => setRoom(m)}
                      >
                        {m.status === "ended"
                          ? "Đã kết thúc"
                          : user.role === "student" && m.status !== "live"
                            ? "Đang chờ giáo viên"
                            : "Vào lớp học ↗"}
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
            <AttendanceReport
              role={user.role}
              courses={courses}
              demo={demo}
              preferredCourseId={
                meetings.find((m) => m.status !== "scheduled")?.course_id
              }
            />
          )}
          {page === "recordings" && (
            <RecordingLibrary courses={courses} demo={demo} role={user.role} />
          )}
          {page === "settings" && <AccountSecurity demo={demo} user={user} />}
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
          {page === "admin" && user.role === "admin" && (
            <>
              {allowed("academic") && (
                <AcademicAdmin demo={demo} onChange={refresh} />
              )}
              {allowed("accounts") && <Accounts demo={demo} />}
              {!managed && (
                <section className="section">
                  <h2>Cấu hình hệ thống dùng chung</h2>
                  <p>
                    SFU theo lớp, TURN, R2, thời hạn ghi hình và lịch sao lưu.
                    Cần mã cài đặt riêng của người vận hành VPS.
                  </p>
                  <a href="/setup" target="_blank" rel="noreferrer">
                    Mở cấu hình SFU / R2 / sao lưu ↗
                  </a>
                </section>
              )}
            </>
          )}
          {page === "audit" && user.role === "admin" && allowed("audit") && (
            <AuditLog demo={demo} />
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
  const [connection, setConnection] = useState("");
  const [canManage, setCanManage] = useState(user.role !== "student");
  const [rules, setRules] = useState<RoomRules>({
    lobby: false,
    chat_enabled: true,
    present_enabled: true,
    revision: 0,
  });
  const [admission, setAdmission] = useState("admitted");
  const muteRequest = useRef(0);
  const [localScreen, setLocalScreen] = useState<MediaStream | null>(null);
  const [pinned, setPinned] = useState("");
  const [layout, setLayout] = useState("auto");
  const [deviceIDs, setDeviceIDs] = useState<{
    audio?: string;
    video?: string;
  }>({});
  const [audioOutput, setAudioOutput] = useState("");
  const [reactions, setReactions] = useState<
    { id: string; name: string; emoji: string; received: number }[]
  >([]);
  const seenReactions = useRef(new Set<string>());
  const [activeSpeaker, setActiveSpeaker] = useState("");
  const lastSpeaker = useRef({ id: "", at: 0 });
  useEffect(() => {
    if (!joined) return;
    let stopped = false,
      pending = false;
    const tick = async () => {
      if (pending) return;
      pending = true;
      try {
        const levels = await media.current?.audioLevels();
        if (stopped || !levels) return;
        const top = Object.entries(levels).sort((a, b) => b[1] - a[1])[0];
        if (top && top[1] > 0.025) {
          lastSpeaker.current = { id: top[0], at: Date.now() };
          setActiveSpeaker(top[0]);
        } else if (Date.now() - lastSpeaker.current.at > 3000)
          setActiveSpeaker("");
      } catch {
      } finally {
        pending = false;
      }
    };
    const timer = setInterval(() => void tick(), 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [joined]);
  useEffect(() => {
    const timer = setInterval(
      () =>
        setReactions((v) => v.filter((r) => Date.now() - r.received < 6000)),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  const [recordingStatus, setRecordingStatus] = useState("");
  const [recordingJob, setRecordingJob] = useState("");
  const [preMic, setPreMic] = useState(true),
    [preCamera, setPreCamera] = useState(true),
    [preview, setPreview] = useState<MediaStream | null>(null);
  const previewRef = useRef<MediaStream | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const resize = new ResizeObserver(() => {
      (toolbar.closest(".room") as HTMLElement)?.style.setProperty(
        "--toolbar-height",
        `${toolbar.getBoundingClientRect().height}px`,
      );
    });
    resize.observe(toolbar);
    return () => resize.disconnect();
  }, []);
  const media = useRef<ClassroomMedia | null>(null),
    rec = useRef<MediaRecorder | null>(null),
    display = useRef<MediaStream | null>(null),
    joinedRef = useRef(false);
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
        const current = await api<{
          status: string;
          can_manage?: boolean;
          rules?: RoomRules;
          admission?: string;
          mute_request?: number;
        }>(`/meetings/${meeting.id}`);
        if (active && current) {
          setState(current.status);
          if (typeof current.can_manage === "boolean")
            setCanManage(current.can_manage);
          if (current.rules) setRules(current.rules);
          if (current.admission) setAdmission(current.admission);
          if (
            current.mute_request &&
            current.mute_request > muteRequest.current
          ) {
            muteRequest.current = current.mute_request;
            setPreMic(false);
            if (joinedRef.current)
              void media.current
                ?.setEnabled("audio", false)
                .then(() => setConnection("Giáo viên yêu cầu tắt mic"))
                .catch((e) => onError(e.message));
          }
          if (
            current.rules &&
            !current.rules.present_enabled &&
            !current.can_manage
          ) {
            void media.current?.stopShare().catch((e) => onError(e.message));
            setLocalScreen(null);
          }
          if (
            current.admission === "removed" ||
            current.admission === "denied"
          ) {
            media.current?.close();
            joinedRef.current = false;
            setJoined(false);
            setLocal(null);
            setLocalScreen(null);
            setRemote({});
            setConnection("Giáo viên chưa cho phép vào buổi này");
          }
          if (current.status === "ended") {
            media.current?.close();
            joinedRef.current = false;
            setJoined(false);
            setLocal(null);
            setRemote({});
            setLocalScreen(null);
          }
        } else if (active && !current) {
          media.current?.close();
          joinedRef.current = false;
          setJoined(false);
          setLocal(null);
          setRemote({});
        }
      } catch (e) {
        if (active) onError((e as Error).message);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
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
      let heartbeatPassed = false;
      try {
        await api(`/meetings/${meeting.id}/presence`, { kind: "heartbeat" });
        heartbeatPassed = true;
        if (stopped) return;
        setAttendance(await api(`/meetings/${meeting.id}/attendance`));
        await media.current?.subscribe(
          await api(`/meetings/${meeting.id}/tracks`),
          user.id,
        );
      } catch (e) {
        if (
          e instanceof ApiError &&
          ([401, 403, 404].includes(e.status) ||
            (e.status === 409 && !heartbeatPassed))
        ) {
          media.current?.close();
          joinedRef.current = false;
          setJoined(false);
          setLocal(null);
          setRemote({});
        }
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
  useEffect(() => {
    if (!joined) return;
    let pending = false;
    const recover = async (force = false) => {
      if (pending || !navigator.onLine || !joinedRef.current) return;
      pending = true;
      try {
        await media.current?.recover(force);
      } catch (e) {
        if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
          media.current?.close();
          joinedRef.current = false;
          setJoined(false);
          setLocal(null);
          setRemote({});
        }
        onError((e as Error).message);
      } finally {
        pending = false;
      }
    };
    const online = () => void recover(true);
    const offline = () => setConnection("Mất mạng · đang chờ kết nối");
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    const timer = setInterval(() => void recover(), 5000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [joined]);
  useEffect(
    () => () => {
      media.current?.close();
      previewRef.current?.getTracks().forEach((t) => t.stop());
      display.current?.getTracks().forEach((t) => t.stop());
      if (rec.current?.state === "recording") rec.current.stop();
      if (joinedRef.current)
        void api(`/meetings/${meeting.id}/presence`, { kind: "leave" }).catch(
          () => {},
        );
    },
    [],
  );
  async function join(listenOnly = false) {
    let stream: MediaStream | undefined;
    let entered = false;
    try {
      const result = await api<{ admission?: string }>(
        `/meetings/${meeting.id}/admission`,
        {},
      );
      setAdmission(result.admission || "admitted");
      if (result.admission && result.admission !== "admitted") {
        setConnection(
          result.admission === "waiting"
            ? "Đang chờ giáo viên duyệt vào lớp"
            : "Chưa được phép vào lớp",
        );
        return;
      }
      if (listenOnly) {
        previewRef.current?.getTracks().forEach((t) => t.stop());
        previewRef.current = null;
      }
      stream = listenOnly
        ? new MediaStream()
        : previewRef.current ||
          (await captureDevices(preMic, preCamera, deviceIDs));
      await api(`/meetings/${meeting.id}/media/reset`, {});
      await api(`/meetings/${meeting.id}/presence`, { kind: "join" });
      entered = true;
      stream.getAudioTracks().forEach((t) => (t.enabled = preMic));
      stream.getVideoTracks().forEach((t) => (t.enabled = preCamera));
      setPreMic(!listenOnly && preMic && stream.getAudioTracks().length > 0);
      setPreCamera(
        !listenOnly && preCamera && stream.getVideoTracks().length > 0,
      );
      setLocal(stream);
      media.current = new ClassroomMedia(
        meeting.id,
        (key, stream, name) =>
          setRemote((v) => ({ ...v, [key]: { stream, name } })),
        (key) =>
          setRemote((v) => {
            const next = { ...v };
            delete next[key];
            return next;
          }),
        (text) => {
          setConnection(text);
          if (text === "Đang kết nối lại…") setLocalScreen(null);
        },
      );
      if (stream.getTracks().length) await media.current.publish(stream);
      setPreview(null);
      setJoined(true);
    } catch (e) {
      media.current?.close();
      stream?.getTracks().forEach((t) => t.stop());
      previewRef.current = null;
      setPreview(null);
      setLocal(null);
      if (entered)
        await api(`/meetings/${meeting.id}/presence`, { kind: "leave" }).catch(
          () => {},
        );
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
    if (!MediaRecorder.isTypeSupported("video/webm")) {
      capture.getTracks().forEach((t) => t.stop());
      throw new Error(
        "Trình duyệt này chưa hỗ trợ ghi WebM. Dùng trình duyệt đã nghiệm thu.",
      );
    }
    let item: { id: string };
    let createdID = "";
    let releaseCapture: () => void = () => {};
    try {
      const storage = await navigator.storage?.estimate();
      if (
        storage?.quota &&
        storage.quota - (storage.usage || 0) < 2 * PART_SIZE
      )
        throw new Error("Thiết bị không đủ dung lượng lưu tạm bản ghi");
      item = await api(`/meetings/${meeting.id}/recordings/multipart`, {});
      createdID = item.id;
      await saveJob({
        id: item.id,
        owner: user.id,
        school: user.school_id,
        meeting: meeting.id,
        title: meeting.title,
        bytes: 0,
        chunks: 0,
        uploaded: 0,
        stopped: false,
        created: Date.now(),
      });
      releaseCapture = await acquireCapture(item.id);
      void navigator.storage?.persist?.();
    } catch (e) {
      releaseCapture();
      capture.getTracks().forEach((t) => t.stop());
      if (createdID)
        void api(
          `/meetings/${meeting.id}/recordings/${createdID}/abort`,
          {},
        ).catch(() => {});
      throw e;
    }
    setRecordingJob(item.id);
    let writes: Promise<void> = Promise.resolve();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(capture, {
        mimeType: "video/webm",
        videoBitsPerSecond: 1500000,
        audioBitsPerSecond: 96000,
      });
    } catch (e) {
      releaseCapture();
      capture.getTracks().forEach((t) => t.stop());
      setRecordingJob("");
      throw e;
    }
    let writeFailed = false;
    rec.current = recorder;
    recorder.ondataavailable = (e) => {
      if (!e.data.size) return;
      writes = writes
        .then(async () => {
          await appendChunk(item.id, e.data);
          const job = await getJob(item.id);
          setRecordingStatus(
            `Đã lưu tạm ${Math.round(job.bytes / 1048576)} MB trên thiết bị`,
          );
          if (
            job.bytes >= MAX_RECORDING_SIZE - PART_SIZE &&
            recorder.state === "recording"
          )
            recorder.stop();
          void uploadRecording(item.id, setRecordingStatus).catch((e) =>
            setRecordingStatus((e as Error).message),
          );
        })
        .catch((e) => {
          writeFailed = true;
          onError((e as Error).message);
          if (recorder.state === "recording") recorder.stop();
        });
    };
    recorder.onstop = () => {
      setRecording(false);
      capture.getTracks().forEach((t) => t.stop());
      void run(async () => {
        await writes;
        releaseCapture();
        if (writeFailed) {
          setRecordingJob("");
          throw new Error(
            "Ghi hình đã dừng vì lỗi lưu trên thiết bị. Kiểm tra phần đã lưu trong mục phục hồi bản ghi.",
          );
        }
        await stopJob(item.id);
        try {
          await uploadRecording(item.id, setRecordingStatus);
          await uploadRecording(item.id, setRecordingStatus);
        } finally {
          setRecordingJob("");
        }
        setRecordings(await api(`/meetings/${meeting.id}/recordings`));
      });
    };
    recorder.onerror = () => {
      writeFailed = true;
      onError(
        "Trình duyệt gặp lỗi ghi hình; các đoạn đã lưu được giữ để phục hồi.",
      );
      if (recorder.state === "recording") recorder.stop();
    };
    capture.getVideoTracks()[0].onended = () => {
      if (recorder.state === "recording") recorder.stop();
    };
    recorder.start(1000);
    setRecording(true);
  }
  const focusKey =
    pinned ||
    (layout === "grid"
      ? ""
      : localScreen
        ? "self:screen"
        : Object.keys(remote).find((k) => k.endsWith(":screen")) ||
          (layout === "spotlight"
            ? activeSpeaker || Object.keys(remote)[0] || "self"
            : ""));
  return (
    <main className="room">
      <header>
        <span className="brand">
          m<span>●</span> meet
        </span>
        <h2>{meeting.title}</h2>
        <button
          className="secondary"
          onClick={() => {
            const link = `${location.origin}/?room=${meeting.id}`;
            if (navigator.clipboard)
              void navigator.clipboard
                .writeText(link)
                .then(() => setConnection("Đã sao chép liên kết lớp học"))
                .catch(() => onError("Không sao chép được liên kết"));
            else prompt("Liên kết lớp học", link);
          }}
        >
          Sao chép liên kết
        </button>
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
      {(error || recordingStatus) && (
        <div className="room-notices">
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {recordingStatus && (
            <p className="banner" role="status">
              {recordingStatus}
            </p>
          )}
        </div>
      )}
      {canManage && (
        <RecordingRecovery
          owner={user.id}
          school={user.school_id}
          active={recordingJob}
        />
      )}
      <div className="room-toolbar" ref={toolbarRef}>
        {connection && (
          <span role="status" aria-live="polite">
            {connection}
          </span>
        )}
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
          <button
            disabled={
              busy || ["waiting", "removed", "denied"].includes(admission)
            }
            onClick={() => void run(join)}
          >
            {rules.lobby && !canManage ? "Xin vào lớp" : "Tham gia buổi học"}
          </button>
        )}
        {joined && (
          <>
            <button
              aria-pressed={preMic}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const s = await media.current?.setEnabled("audio", !preMic);
                  if (s) setLocal(new MediaStream(s.getTracks()));
                  setPreMic(!preMic);
                })
              }
            >
              {preMic ? "Tắt mic" : "Bật mic"}
            </button>
            <button
              aria-pressed={preCamera}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const s = await media.current?.setEnabled(
                    "video",
                    !preCamera,
                  );
                  if (s) setLocal(new MediaStream(s.getTracks()));
                  setPreCamera(!preCamera);
                })
              }
            >
              {preCamera ? "Tắt camera" : "Bật camera"}
            </button>
            <button
              disabled={busy || (!rules.present_enabled && !canManage)}
              onClick={() =>
                void run(async () => {
                  const stream = await media.current!.share();
                  setLocalScreen(stream || null);
                  stream
                    ?.getVideoTracks()[0]
                    ?.addEventListener("ended", () => setLocalScreen(null), {
                      once: true,
                    });
                })
              }
            >
              {localScreen ? "Dừng trình bày" : "Chia sẻ màn hình"}
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
      <div className="room-view-controls">
        <label>
          Bố cục
          <select
            value={layout}
            onChange={(e) => {
              setLayout(e.target.value);
              setPinned("");
            }}
          >
            <option value="auto">Tự động</option>
            <option value="grid">Lưới</option>
            <option value="spotlight">Người trình bày</option>
          </select>
        </label>
        {pinned && (
          <button className="secondary" onClick={() => setPinned("")}>
            Bỏ ghim
          </button>
        )}
        <RoomDevices
          refreshKey={preview?.id || local?.id}
          onInput={async (kind, id) => {
            const next = { ...deviceIDs, [kind]: id };
            setDeviceIDs(next);
            if (joined) {
              const stream = await media.current?.changeDevice(kind, id);
              if (stream) setLocal(new MediaStream(stream.getTracks()));
            } else {
              previewRef.current?.getTracks().forEach((t) => t.stop());
              previewRef.current = null;
              setPreview(null);
              const stream = await captureDevices(preMic, preCamera, next);
              previewRef.current = stream;
              setPreview(stream);
            }
          }}
          onOutput={async (id) => {
            await Promise.all(
              Array.from(document.querySelectorAll("video")).map((v) =>
                (
                  v as HTMLVideoElement & {
                    setSinkId?: (id: string) => Promise<void>;
                  }
                ).setSinkId?.(id),
              ),
            );
            setAudioOutput(id);
          }}
        />
      </div>
      <div className="room-reaction-overlay" aria-live="polite">
        {reactions.map((r) => (
          <span key={r.id}>
            {r.emoji} <small>{r.name}</small>
          </span>
        ))}
      </div>
      <div className={"video-grid layout-" + layout}>
        {!joined && state !== "ended" && (
          <section className="section prejoin">
            <div>
              <h2>Chuẩn bị trước khi vào lớp</h2>
              {["waiting", "removed", "denied"].includes(admission) && (
                <p role="status">
                  {admission === "waiting"
                    ? "Yêu cầu đã gửi. Chờ giáo viên duyệt, sau đó bấm vào lớp."
                    : "Bạn chưa được phép tham gia buổi này. Liên hệ giáo viên để được cho vào lại."}
                </p>
              )}
              <p>
                Chọn mic/camera hoặc tắt cả hai để vào chỉ nghe. Camera chỉ chia
                sẻ khi tham gia.
              </p>
              {(!preview || !preview.getVideoTracks().length) && (
                <div className="prejoin-placeholder">
                  <span>{user.name[0]}</span>
                  <strong>
                    {preview?.getAudioTracks().length
                      ? "Đã có micro · không có camera"
                      : "Camera chưa được mở"}
                  </strong>
                  <p>
                    Bấm kiểm tra camera/mic để xem trước, hoặc vào lớp không
                    dùng thiết bị.
                  </p>
                </div>
              )}
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={preMic}
                  onChange={(e) => {
                    setPreMic(e.target.checked);
                    previewRef.current
                      ?.getAudioTracks()
                      .forEach((t) => (t.enabled = e.target.checked));
                  }}
                />{" "}
                Bật mic khi vào lớp
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={preCamera}
                  onChange={(e) => {
                    setPreCamera(e.target.checked);
                    previewRef.current
                      ?.getVideoTracks()
                      .forEach((t) => (t.enabled = e.target.checked));
                  }}
                />{" "}
                Bật camera khi vào lớp
              </label>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    previewRef.current?.getTracks().forEach((t) => t.stop());
                    const s = await captureDevices(
                      preMic,
                      preCamera,
                      deviceIDs,
                    );
                    s.getAudioTracks().forEach((t) => (t.enabled = preMic));
                    s.getVideoTracks().forEach((t) => (t.enabled = preCamera));
                    previewRef.current = s;
                    setPreview(s);
                  })
                }
              >
                Kiểm tra camera / mic
              </button>
              {state === "live" && (
                <div className="prejoin-actions">
                  <button
                    disabled={
                      busy ||
                      ["waiting", "removed", "denied"].includes(admission)
                    }
                    onClick={() => void run(() => join())}
                  >
                    Vào lớp với thiết bị đã chọn
                  </button>
                  <button
                    className="secondary"
                    disabled={
                      busy ||
                      ["waiting", "removed", "denied"].includes(admission)
                    }
                    onClick={() => void run(() => join(true))}
                  >
                    Vào lớp không dùng camera/micro
                  </button>
                </div>
              )}
            </div>
            {preview?.getVideoTracks().length ? (
              <Video stream={preview} muted />
            ) : null}
          </section>
        )}
        {local && (
          <article
            className={
              (focusKey === "self" ? "is-pinned " : "") +
              (activeSpeaker === "self" ? "is-speaking" : "")
            }
          >
            <Video stream={local} muted />
            {!preCamera && <span className="video-avatar">{user.name[0]}</span>}
            <strong>Bạn{activeSpeaker === "self" ? " · Đang nói" : ""}</strong>
            <div className="tile-actions">
              <button
                onClick={() => setPinned(pinned === "self" ? "" : "self")}
              >
                {pinned === "self" ? "Bỏ ghim" : "Ghim"}
              </button>
              <button
                onClick={(e) =>
                  void e.currentTarget
                    .closest("article")
                    ?.requestFullscreen?.()
                    .catch((e) => onError(e.message))
                }
              >
                Toàn màn hình
              </button>
            </div>
          </article>
        )}
        {localScreen && (
          <article className={focusKey === "self:screen" ? "is-pinned" : ""}>
            <Video stream={localScreen} muted />
            <strong>Màn hình của bạn</strong>
            <div className="tile-actions">
              <button
                onClick={() =>
                  setPinned(pinned === "self:screen" ? "" : "self:screen")
                }
              >
                Ghim màn hình
              </button>
            </div>
          </article>
        )}
        {Object.entries(remote).map(([k, v]) => (
          <article
            key={k}
            className={
              (focusKey === k ? "is-pinned " : "") +
              (activeSpeaker === k ? "is-speaking" : "")
            }
          >
            <Video stream={v.stream} sinkId={audioOutput} />
            {!v.stream
              .getVideoTracks()
              .some((t) => t.enabled && t.readyState !== "ended") && (
              <span className="video-avatar">{v.name[0]}</span>
            )}
            <strong>
              {v.name}
              {activeSpeaker === k ? " · Đang nói" : ""}
            </strong>
            <div className="tile-actions">
              <button onClick={() => setPinned(pinned === k ? "" : k)}>
                {pinned === k ? "Bỏ ghim" : "Ghim"}
              </button>
              <button
                onClick={(e) =>
                  void e.currentTarget
                    .closest("article")
                    ?.requestFullscreen?.()
                    .catch((e) => onError(e.message))
                }
              >
                Toàn màn hình
              </button>
            </div>
          </article>
        ))}
      </div>
      <RoomTools
        meeting={meeting.id}
        user={user}
        joined={joined}
        canManage={canManage}
        chatEnabled={rules.chat_enabled}
        onReactions={(events) => {
          const fresh = events.filter((e) => !seenReactions.current.has(e.id));
          fresh.forEach((e) => seenReactions.current.add(e.id));
          if (seenReactions.current.size > 200)
            seenReactions.current = new Set(
              Array.from(seenReactions.current).slice(-100),
            );
          if (fresh.length)
            setReactions((old) =>
              [
                ...old,
                ...fresh.map((e) => ({ ...e, received: Date.now() })),
              ].slice(-6),
            );
        }}
      />
      <section className="section room-history">
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
createRoot(document.getElementById("root")!).render(
  location.pathname === "/setup" ? (
    <Setup />
  ) : location.pathname === "/reset-password" ? (
    <PasswordRecovery />
  ) : (
    <App />
  ),
);
