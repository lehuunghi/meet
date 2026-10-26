import { AcademyApp } from "./academy";
import { Accounts } from "./accounts";
import { AccountSecurity } from "./account";
import { AcademicAdmin } from "./academic";
import { RoomTools } from "./room-tools";
import { CallIcon } from "./call-icon";
import { loadRoomResume, saveRoomResume, clearRoomResume } from "./room-resume";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, ApiError } from "./api";
import { ClassroomMedia } from "./media";
import { captureDevices } from "./devices";
import type { RoomRules } from "./room-moderation";

import "./style.css";
import "./meet-room.css";
import "./attendance.css";
import "./comparison-tables.css";
import { LearningWorkspace } from "./learning";

import { Setup } from "./setup";
import { AuditLog } from "./audit";
import { PasswordRecovery } from "./password-recovery";
import { RecordingRecovery } from "./recording-recovery";
import "./workspace.css";
import "./learning.css";
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
  session_version?: number;
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
  short_code?: string;
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
  const [schoolName, setSchoolName] = useState("");
  useEffect(() => {
    if (!demo)
      void api<any>("/public-config")
        .then((v) => {
          setManaged(v.managed);
          setSchoolName(v.school_name || "");
        })
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
    [page, setPage] = useState(() => {
      const requested =
        new URLSearchParams(location.search).get("page") || "overview";
      if (["courses", "meetings"].includes(requested)) return "overview";
      if (requested === "recordings") return "attendance";
      return ["overview", "attendance", "settings", "admin", "audit"].includes(
        requested,
      )
        ? requested
        : "overview";
    }),
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
    const [m, c, allClasses] = await Promise.all([
      allowed("meetings") || allowed("attendance") || allowed("recordings")
        ? api<Meeting[]>("/meetings")
        : Promise.resolve([]),
      api<any[]>("/catalog"),
      user?.role === "admin" && allowed("academic")
        ? api<any[]>("/classes")
        : Promise.resolve([]),
    ]);
    setMeetings(m);
    setCourses(c);
    if (user?.role === "admin" && allowed("academic")) setClasses(allClasses);
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
  useEffect(() => {
    if (!user || demo) return;
    let running = false,
      active = true;
    const timer = setInterval(() => {
      if (running) return;
      running = true;
      void refresh()
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          running = false;
        });
    }, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [user]);
  const openedRoom = useRef("");
  useEffect(() => {
    const code = /^\/([a-z0-9]{6})\/?$/.exec(location.pathname)?.[1];
    const id =
      new URLSearchParams(location.search).get("room") ||
      (!demo && user ? loadRoomResume(user)?.meeting : null);
    const key = code ? "short:" + code : id;
    if (!demo && user && key && key !== openedRoom.current) {
      openedRoom.current = key;
      void api<Meeting>(
        code ? `/rooms/${code}` : `/meetings/${encodeURIComponent(id!)}`,
      )
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
          history.replaceState(null, "", "/");
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
              {schoolName ||
                (demo || user.school_id === "school-demo"
                  ? "Trường Nguyễn Trãi"
                  : "Trường của bạn")}
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
            [
              "overview",
              "▤",
              user.role === "student" ? "Môn học" : "Lớp học & môn học",
            ],
            ...(allowed("attendance")
              ? [["attendance", "◷", "Điểm danh & video"]]
              : []),
            ["settings", "⚙", "Tài khoản"],
            ...(user.role === "admin" ? [["admin", "⇧", "Quản trị"]] : []),
            ...(user.role === "admin" && allowed("audit")
              ? [["audit", "≡", "Nhật ký"]]
              : []),
          ].map(([key, icon, label]) => (
            <button
              key={key}
              aria-current={page === key ? "page" : undefined}
              className={page === key ? "active" : ""}
              onClick={() => {
                setPage(key);
                setMenuOpen(false);
                const params = new URLSearchParams(location.search);
                params.set("page", key);
                params.delete("room");
                history.replaceState(null, "", "/?" + params.toString());
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
                  ? user.role === "student"
                    ? "Môn học của tôi"
                    : "Lớp học & môn học"
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
          {(page === "overview" || page === "attendance") && (
            <LearningWorkspace
              role={user.role}
              courses={courses}
              classCatalog={user.role === "admin" ? classes : undefined}
              meetings={
                demo
                  ? meetings.map((m) => ({
                      ...m,
                      course_id:
                        m.course_id ||
                        courses.find(
                          (c) =>
                            c.name === m.course &&
                            c.class_name === m.class_name,
                        )?.id,
                    }))
                  : meetings
              }
              demo={demo}
              reports={page === "attendance"}
              canTeach={allowed("meetings")}
              canVideo={allowed("recordings")}
              onRefresh={refresh}
              onOpen={setRoom}
            />
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
                    minLength={user.role === "admin" ? 12 : 6}
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
    [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState("");
  const resumeHint = useRef(loadRoomResume(user, meeting.id));
  const joining = useRef(false);
  const [resumeTick, setResumeTick] = useState(0);
  useEffect(() => {
    const url = meeting.short_code
      ? `/${meeting.short_code}`
      : `/?room=${encodeURIComponent(meeting.id)}`;
    history.replaceState(null, "", url);
  }, [meeting.id]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [waitingCount, setWaitingCount] = useState(0);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setToolsOpen(false);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
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
  const [serverRecording, setServerRecording] = useState("unavailable");

  const [preMic, setPreMic] = useState(resumeHint.current?.mic || false),
    [preCamera, setPreCamera] = useState(resumeHint.current?.camera || false),
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
          server_recording?: { state: string };
        }>(`/meetings/${meeting.id}`);
        if (active && current) {
          setState(current.status);
          setServerRecording(current.server_recording?.state || "unavailable");
          if (typeof current.can_manage === "boolean")
            setCanManage(current.can_manage);
          if (current.rules) setRules(current.rules);
          if (current.admission) setAdmission(current.admission);
          setResumeTick((value) => value + 1);
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
            clearRoomResume(user);
            resumeHint.current = null;
            media.current?.close();
            joinedRef.current = false;
            setJoined(false);
            setLocal(null);
            setLocalScreen(null);
            setRemote({});
            setConnection("Giáo viên chưa cho phép vào buổi này");
          }
          if (current.status === "ended") {
            clearRoomResume(user);
            resumeHint.current = null;
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

      if (joinedRef.current)
        void api(`/meetings/${meeting.id}/presence`, { kind: "leave" }).catch(
          () => {},
        );
    },
    [],
  );
  async function togglePreview(kind: "audio" | "video") {
    const enabled = kind === "audio" ? preMic : preCamera;
    const current = previewRef.current || new MediaStream();
    if (enabled) {
      current
        .getTracks()
        .filter((t) => t.kind === kind)
        .forEach((t) => {
          current.removeTrack(t);
          t.stop();
        });
    } else {
      const captured = await captureDevices(kind === "audio", kind === "video");
      captured.getTracks().forEach((t) => current.addTrack(t));
    }
    previewRef.current = current;
    setPreview(new MediaStream(current.getTracks()));
    if (kind === "audio") setPreMic(!enabled);
    else setPreCamera(!enabled);
  }
  async function join(resuming = false) {
    if (joining.current || joinedRef.current) return;
    joining.current = true;
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
      try {
        stream =
          previewRef.current || (await captureDevices(preMic, preCamera));
      } catch (e) {
        if (!resuming) throw e;
        stream = new MediaStream();
        setConnection(
          "Đã vào lại lớp · mic/camera chưa sẵn sàng, bấm biểu tượng để bật lại",
        );
      }
      await api(`/meetings/${meeting.id}/media/reset`, {});
      await api(`/meetings/${meeting.id}/presence`, { kind: "join" });
      entered = true;
      stream.getAudioTracks().forEach((t) => (t.enabled = preMic));
      stream.getVideoTracks().forEach((t) => (t.enabled = preCamera));
      setPreMic(preMic && stream.getAudioTracks().length > 0);
      setPreCamera(preCamera && stream.getVideoTracks().length > 0);
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
      saveRoomResume(
        user,
        meeting.id,
        preMic && stream.getAudioTracks().length > 0,
        preCamera && stream.getVideoTracks().length > 0,
      );
      resumeHint.current = loadRoomResume(user, meeting.id);
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
    } finally {
      joining.current = false;
    }
  }
  useEffect(() => {
    if (
      resumeTick > 0 &&
      resumeHint.current &&
      state === "live" &&
      admission === "admitted" &&
      !joinedRef.current &&
      !joining.current
    )
      void run(() => join(true));
  }, [resumeTick]);
  useEffect(() => {
    if (!joined) return;
    const save = () => {
      if (joinedRef.current)
        saveRoomResume(user, meeting.id, preMic, preCamera);
    };
    save();
    const timer = setInterval(save, 15000);
    return () => clearInterval(timer);
  }, [
    joined,
    preMic,
    preCamera,
    meeting.id,
    user.id,
    user.school_id,
    user.session_version,
  ]);
  const focusKey =
    pinned ||
    (localScreen
      ? "self:screen"
      : Object.keys(remote).find((k) => k.endsWith(":screen"))) ||
    "";
  return (
    <main className={"room" + (toolsOpen ? " room-tools-open" : "")}>
      <header>
        <span className="brand">
          m<span>●</span> meet
        </span>
        <h2>{meeting.title}</h2>
        <button
          className="secondary"
          onClick={() =>
            void run(async () => {
              const info = await api<Meeting>(`/meetings/${meeting.id}`);
              if (!info.short_code)
                throw new Error("Chưa có liên kết phòng học");
              const link = `${location.origin}/${info.short_code}`;
              if (navigator.clipboard) {
                await navigator.clipboard.writeText(link);
                setConnection("Đã sao chép liên kết lớp học");
              } else prompt("Liên kết lớp học", link);
            })
          }
        >
          Sao chép liên kết
        </button>
      </header>
      {error && (
        <div className="room-notices">
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
      {canManage && (
        <RecordingRecovery owner={user.id} school={user.school_id} active="" />
      )}
      <div className="room-toolbar" ref={toolbarRef}>
        {canManage && waitingCount > 0 && (
          <span role="status" className="room-waiting-notice">
            {waitingCount} người đang xin vào lớp
          </span>
        )}
        {connection && (
          <span role="status" aria-live="polite">
            {connection}
          </span>
        )}
        {!!meeting.recording_allowed && (
          <span>
            {
              (
                {
                  recording: "● Đang ghi tự động trên máy chủ",
                  waiting: "● Đang ghi · chờ người tham gia",
                  starting: "Đang khởi tạo ghi hình",
                  queued: "Đang chờ bộ ghi",
                  saving: "Đang lưu video",
                  complete: "Đã dừng ghi · đang hoàn tất lưu",
                  disabled: "Chưa bật R2 · không ghi hình",
                  unavailable: "Bộ ghi máy chủ chưa sẵn sàng",
                  error: "Ghi hình gián đoạn · đang thử lại",
                  interrupted: "Mất kết nối bộ ghi · đang thử lại",
                  limit: "Đã dừng ghi · đạt giới hạn 8 giờ",
                } as Record<string, string>
              )[serverRecording]
            }
          </span>
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
        {joined && (
          <>
            <button
              aria-pressed={preMic}
              className="call-control"
              aria-label={preMic ? "Tắt mic" : "Bật mic"}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const s = await media.current?.setEnabled("audio", !preMic);
                  if (s) setLocal(new MediaStream(s.getTracks()));
                  setPreMic(!preMic);
                })
              }
            >
              <CallIcon kind="mic" off={!preMic} />
              <span className="control-label">
                {preMic ? "Tắt mic" : "Bật mic"}
              </span>
            </button>
            <button
              aria-pressed={preCamera}
              className="call-control"
              aria-label={preCamera ? "Tắt camera" : "Bật camera"}
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
              <CallIcon kind="camera" off={!preCamera} />
              <span className="control-label">
                {preCamera ? "Tắt camera" : "Bật camera"}
              </span>
            </button>
            <button
              disabled={busy || (!rules.present_enabled && !canManage)}
              className="call-control"
              aria-label={localScreen ? "Dừng trình bày" : "Chia sẻ màn hình"}
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
              <CallIcon kind="present" />
              <span className="control-label">
                {localScreen ? "Dừng trình bày" : "Chia sẻ màn hình"}
              </span>
            </button>
          </>
        )}
        <button
          className="call-control"
          aria-label="Người tham gia & trò chuyện"
          aria-controls="room-tools-panel"
          aria-expanded={toolsOpen}
          onClick={() => setToolsOpen(!toolsOpen)}
        >
          <CallIcon kind="people" />
          <span className="control-label">Người tham gia & trò chuyện</span>
        </button>
        <button
          className="call-control room-leave"
          aria-label="Rời lớp"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              clearRoomResume(user);
              resumeHint.current = null;
              const wasJoined = joinedRef.current;
              joinedRef.current = false;
              media.current?.close();
              setJoined(false);
              if (wasJoined)
                void api(`/meetings/${meeting.id}/presence`, {
                  kind: "leave",
                }).catch(() => {});
              onExit();
            })
          }
        >
          <CallIcon kind="leave" />
          <span className="control-label">Rời lớp</span>
        </button>
        {canManage && state === "live" && (
          <details className="room-end-menu">
            <summary aria-label="Thêm tùy chọn">⋮</summary>
            <div>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api(`/meetings/${meeting.id}/state`, {
                      status: "ended",
                    });
                    setState("ended");
                    clearRoomResume(user);
                    resumeHint.current = null;
                    setJoined(false);
                    media.current?.close();
                    setLocal(null);
                  })
                }
              >
                Kết thúc buổi học
              </button>
            </div>
          </details>
        )}
      </div>
      <div className="room-reaction-overlay" aria-live="polite">
        {reactions.map((r) => (
          <span key={r.id}>
            {r.emoji} <small>{r.name}</small>
          </span>
        ))}
      </div>
      <div className="video-grid layout-auto">
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
                    Bấm biểu tượng mic/camera để bật, hoặc vào lớp không dùng
                    thiết bị.
                  </p>
                </div>
              )}
              <div
                className="prejoin-device-icons"
                aria-label="Mic và camera trước khi vào lớp"
              >
                <button
                  className="call-control"
                  aria-label={preMic ? "Tắt mic" : "Bật mic"}
                  aria-pressed={preMic}
                  disabled={busy}
                  onClick={() => void run(() => togglePreview("audio"))}
                >
                  <CallIcon kind="mic" off={!preMic} />
                </button>
                <button
                  className="call-control"
                  aria-label={preCamera ? "Tắt camera" : "Bật camera"}
                  aria-pressed={preCamera}
                  disabled={busy}
                  onClick={() => void run(() => togglePreview("video"))}
                >
                  <CallIcon kind="camera" off={!preCamera} />
                </button>
              </div>{" "}
              {state === "live" && (
                <div className="prejoin-actions">
                  <button
                    disabled={
                      busy ||
                      ["waiting", "removed", "denied"].includes(admission)
                    }
                    onClick={() => void run(() => join())}
                  >
                    {rules.lobby && admission !== "admitted"
                      ? "Xin vào lớp"
                      : "Vào lớp học"}
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
            <Video stream={v.stream} />
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
        onWaitingChange={setWaitingCount}
        open={toolsOpen}
        onClose={() => setToolsOpen(false)}
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
    </main>
  );
}
function PlatformEntry() {
  const forced =
    location.pathname === "/hoc" ||
    new URLSearchParams(location.search).has("academy_demo");
  const [mode, setMode] = useState(forced ? "academy" : "");
  useEffect(() => {
    if (forced) return;
    if (demo) {
      setMode("school");
      return;
    }
    api("/public-config")
      .then((c) =>
        setMode(
          c.setup_pending
            ? "initializing"
            : c.platform_mode === "academy"
              ? "academy"
              : "school",
        ),
      )
      .catch(() => setMode("school"));
  }, []);
  if (!mode)
    return (
      <main className="login">
        <p>Đang kết nối…</p>
      </main>
    );
  if (mode === "initializing")
    return (
      <main className="academy-auth">
        <h1>Nền tảng đang được khởi tạo</h1>
        <p>
          Cấu hình chưa hoàn tất. Chủ nền tảng kiểm tra trạng thái đồng bộ tại
          bảng quản trị trung tâm.
        </p>
        <button onClick={() => location.reload()}>Kiểm tra lại</button>
      </main>
    );
  return mode === "academy" ? <AcademyApp RoomComponent={Room} /> : <App />;
}
createRoot(document.getElementById("root")!).render(
  location.pathname === "/setup" ? (
    <Setup />
  ) : location.pathname === "/reset-password" ? (
    <PasswordRecovery />
  ) : (
    <PlatformEntry />
  ),
);
