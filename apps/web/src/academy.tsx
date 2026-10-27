import { StudentLiveClasses } from "./student-live-classes";
import { subjectArt } from "./subject-art";
import { LearningDataCleanup } from "./academy-data-cleanup";
import { CourseClassroomLink } from "./academy-classroom-links";
import { useUITexts } from "./ui-language-hook";
import { AcademyVIPPlans } from "./academy-vip-plans";
import { registrationAvatarData } from "./registration-avatar";
import { vnDate, vnDateTime, vnDateCell } from "./date-format";
import { VNDateInput } from "./date-input";
import { AcademyLessonEditor } from "./academy-lesson-editor";
import React, { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { PreviewRoom } from "./preview";
import { LearningWorkspace } from "./learning";
import { AcademicAdmin } from "./academic";
import { AcademySiteEditor, AcademyCourseEditor } from "./academy-site-editor";
import { AcademyToday } from "./academy-today";
import { Accounts } from "./accounts";
import { AcademySettings } from "./academy-settings";
import { AcademyIcon, AcademyAuthFrame } from "./academy-ui";
import "./academy.css";
import {
  academyPaths,
  academyHref,
  academyClick,
  goAcademy,
  useAcademyRoute,
  legacyAcademyPath,
  safeNext,
} from "./academy-route";
import { useAcademyFormGuard, submittingForm } from "./form-guard";
import {
  AcademyNotificationList,
  AcademyBreadcrumbs,
} from "./academy-navigation";
const money = (n: number) =>
  new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(
    n || 0,
  );
const parse = (v: any) => (typeof v === "string" ? JSON.parse(v) : v);
const demoCourses = [
  {
    id: "demo-course",
    academic_course_id: "demo-academic-math",
    title: "Toán nền tảng",
    description:
      "Hiểu bản chất, luyện bài có hướng dẫn và học Live cùng giáo viên.",
    teacher_name: "Giáo viên minh họa",
    published: 1,
  },
];
const demoClassrooms = [
  {
    id: "demo-academic-math",
    name: "Toán nền tảng",
    class_id: "demo-class-10a1",
    class_name: "10A1",
    teacher: "Nguyễn Minh Anh",
    lesson_count: 12,
  },
  {
    id: "demo-academic-physics",
    name: "Vật lý",
    class_id: "demo-class-10a1",
    class_name: "10A1",
    teacher: "Trần Quốc Huy",
    lesson_count: 8,
  },
  {
    id: "demo-academic-literature",
    name: "Ngữ văn",
    class_id: "demo-class-11a2",
    class_name: "11A2",
    teacher: "Lê Thu Hà",
    lesson_count: 6,
  },
];
const demoMeetings = [
  {
    id: "demo-live-math",
    course_id: "demo-academic-math",
    title: "Hàm số và đồ thị",
    course: "Toán nền tảng",
    class_name: "10A1",
    status: "live",
    starts_at: "2026-10-26T01:00:00Z",
    recording_allowed: false,
  },
  {
    id: "demo-ended-math",
    course_id: "demo-academic-math",
    title: "Ôn tập phương trình",
    course: "Toán nền tảng",
    class_name: "10A1",
    status: "ended",
    starts_at: "2026-10-24T01:00:00Z",
    recording_allowed: true,
  },
];
const demoPlans = [
  {
    id: "demo-plan",
    name: "VIP 30 ngày",
    price_vnd: 299000,
    days: 30,
    live_enabled: 1,
    active: 1,
  },
];
export function AcademyApp({
  RoomComponent,
}: {
  RoomComponent: React.ComponentType<any>;
}) {
  useUITexts();
  const route = useAcademyRoute();
  useAcademyFormGuard();
  const [routeBusy, setRouteBusy] = useState(false),
    [routeError, setRouteError] = useState(""),
    [routeTitle, setRouteTitle] = useState("");
  const demo = new URLSearchParams(location.search).has("academy_demo"),
    role = new URLSearchParams(location.search).get("role") || "student";
  const [user, setUser] = useState<any>(
      demo
        ? {
            id: "demo",
            school_id: "demo",
            name:
              role === "admin"
                ? "Quản trị VA"
                : role === "teacher"
                  ? "Giáo viên minh họa"
                  : "Học viên minh họa",
            role,
          }
        : null,
    ),
    [loading, setLoading] = useState(!demo),
    [tab, setTabState] = useState(
      demo && role !== "admin" ? "live" : "courses",
    ),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [courses, setCourses] = useState<any[]>(demo ? demoCourses : []),
    [plans, setPlans] = useState<any[]>(demo ? demoPlans : []),
    [profile, setProfile] = useState<any>(
      demo
        ? {
            name: "Học viên minh họa",
            email: "hocvien@example.test",
            expires_at: null,
          }
        : {},
    ),
    [room, setRoom] = useState<any>(null),
    [classrooms, setClassrooms] = useState<any[]>([]),
    [meetings, setMeetings] = useState<any[]>([]),
    [authTab, setAuthTab] = useState(
      new URLSearchParams(location.search).has("register")
        ? "register"
        : "login",
    ),
    [challenge, setChallenge] = useState("");
  const setTab = (id: string) => {
    if (goAcademy(academyPaths[id] || "/hoc")) setTabState(id);
  };
  const [signupAvatarName, setSignupAvatarName] = useState("");
  useEffect(() => {
    if (authTab !== "register") setSignupAvatarName("");
  }, [authTab]);
  const [notifications, setNotifications] = useState<any[]>([]),
    [notificationError, setNotificationError] = useState("");
  const safeIntent = (key: string) => {
    const v = new URLSearchParams(location.search).get(key) || "";
    return /^[a-zA-Z0-9-]{1,36}$/.test(v) ? v : "";
  };
  const [intentCourse, setIntentCourse] = useState(safeIntent("course")),
    [intentLesson, setIntentLesson] = useState(safeIntent("lesson")),
    [intentTasks, setIntentTasks] = useState(false);
  const intentPlan = safeIntent("goi") || safeIntent("plan");
  const showCourse = (id: string, lesson = "", tasks = false) => {
    const path = lesson
      ? "/hoc/bai-giang/" + lesson
      : tasks
        ? "/hoc/khoa-hoc/" + id + "?bai-tap=1"
        : id
          ? "/hoc/khoa-hoc/" + id
          : academyPaths.courses;
    goAcademy(path);
  };
  const openMeeting = async (m: any) => {
    if (demo) {
      goAcademy("/hoc/buoi-hoc/" + m.id);
      return;
    }
    const info = await api(`/meetings/${m.id}`);
    goAcademy(
      info.short_code ? "/" + info.short_code : "/hoc/buoi-hoc/" + m.id,
    );
  };
  const [brand, setBrand] = useState("VA Academy"),
    [freeQuota, setFreeQuota] = useState(4),
    [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!demo) {
      void api("/public-config")
        .then((v) => setBrand(v.school_name || "VA Academy"))
        .catch(() => {});
      void api("/academy/public")
        .then((v) => setFreeQuota(v.free_videos || 4))
        .catch(() => {});
    }
  }, []);
  const verificationStarted = useRef(false);
  useEffect(() => {
    const token = new URLSearchParams(location.hash.slice(1)).get(
      "xac-thuc-email",
    );
    if (!token || verificationStarted.current) return;
    verificationStarted.current = true;
    history.replaceState(
      history.state,
      "",
      location.pathname + location.search,
    );
    void api("/academy/verify-email-link", { token })
      .then(() =>
        setNotice("Email đã xác thực. Anh/chị có thể đăng nhập để học."),
      )
      .catch((e) => setError(e.message));
  }, []);
  const perform = async (fn: () => Promise<void>) => {
    setError("");
    setNotice("");
    const finish = submittingForm();
    try {
      await fn();
      finish(true);
    } catch (e) {
      finish(false);
      setError((e as Error).message);
    }
  };
  const refreshGeneration = useRef(0);
  const [catalogLoaded, setCatalogLoaded] = useState(demo),
    [classroomsLoaded, setClassroomsLoaded] = useState(demo),
    [scheduleError, setScheduleError] = useState("");
  async function refresh() {
    if (demo) return;
    const generation = ++refreshGeneration.current;
    const [c, p] = await Promise.all([
      api<any[]>(
        user?.role === "admin" &&
          (user.permissions == null || user.permissions.includes("content"))
          ? "/academy/admin/courses"
          : user?.role === "teacher"
            ? "/academy/teaching"
            : "/academy/courses",
      ),
      api<any[]>("/academy/plans"),
    ]);
    if (generation !== refreshGeneration.current) return;
    setCourses(c);
    setCatalogLoaded(true);
    setPlans(p);
    if (user) {
      const me = await api<any[]>("/academy/me");
      if (generation === refreshGeneration.current) setProfile(me[0] || {});
    }
  }
  function clearAccount() {
    refreshGeneration.current++;
    setUser(null);
    setRoom(null);
    setCourses([]);
    setClassrooms([]);
    setMeetings([]);
    setProfile({});
    setNotifications([]);
    setNotificationError("");
    setScheduleError("");
    setClassroomsLoaded(false);
    setCatalogLoaded(false);
  }
  useEffect(() => {
    if (demo) return;
    api("/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setLoading(false));
    const ended = () => {
      clearAccount();
    };
    window.addEventListener("meet-session-ended", ended);
    return () => window.removeEventListener("meet-session-ended", ended);
  }, []);
  useEffect(() => {
    void perform(refresh);
  }, [user]);
  useEffect(() => {
    const legacy = legacyAcademyPath(location.pathname, location.search);
    if (legacy) {
      goAcademy(legacy, true);
      return;
    }
    if (location.pathname.length > 1 && location.pathname.endsWith("/")) {
      goAcademy(location.pathname.slice(0, -1) + location.search, true);
      return;
    }
    if (route.auth) {
      setAuthTab(route.auth);
      if (user)
        goAcademy(
          safeNext(new URLSearchParams(location.search).get("next")),
          true,
        );
      return;
    }
    if (!user) {
      if (!loading && !demo)
        goAcademy(
          "/dang-nhap?next=" +
            encodeURIComponent(location.pathname + location.search),
          true,
        );
      return;
    }
    if (user.role === "admin" && location.pathname === "/hoc") {
      goAcademy(academyPaths.courses + location.search, true);
      return;
    }
    let active = true;
    setTabState(route.tab);
    setRoom(null);
    setRouteError("");
    setRouteTitle("");
    setIntentCourse(route.courseId || safeIntent("khoa"));
    setIntentLesson(route.lessonId || "");
    setIntentTasks(
      !!route.assignmentId ||
        new URLSearchParams(location.search).get("bai-tap") === "1",
    );
    if (route.roomId || route.roomCode) {
      setRouteBusy(true);
      void (
        demo
          ? Promise.resolve(
              demoMeetings.find((v) => v.id === route.roomId) || {
                id: route.roomId || "preview",
                title: "Phòng học minh họa",
                status: "live",
              },
            )
          : api(
              route.roomCode
                ? `/rooms/${route.roomCode}`
                : `/meetings/${route.roomId}`,
            )
      )
        .then((v) => {
          if (active) setRoom(v);
        })
        .catch((e) => {
          if (active) setRouteError(e.message);
        })
        .finally(() => {
          if (active) setRouteBusy(false);
        });
    } else if (route.lessonId || route.assignmentId) {
      setRouteBusy(true);
      const id = route.lessonId || route.assignmentId;
      void (
        demo
          ? Promise.resolve({
              id,
              course_id: "demo-course",
              title: "Nội dung minh họa",
            })
          : api(
              route.lessonId
                ? `/academy/lessons/${id}`
                : `/academy/assignments/${id}`,
            )
      )
        .then((v) => {
          if (active) {
            setIntentCourse(v.course_id);
            setRouteTitle(v.title);
          }
        })
        .catch((e) => {
          if (active) setRouteError(e.message);
        })
        .finally(() => {
          if (active) setRouteBusy(false);
        });
    } else setRouteBusy(false);
    return () => {
      active = false;
    };
  }, [route.path, location.search, user?.id, loading]);
  useEffect(() => {
    if (!user) return;
    let active = true;
    const load = async () => {
      try {
        const rows = demo ? [] : await api<any[]>("/academy/notifications");
        if (active) {
          setNotifications(rows);
          setNotificationError("");
        }
      } catch (e) {
        if (active) setNotificationError((e as Error).message);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [user?.id, demo]);
  const readNotifications = async (ids: string[]) => {
    if (!ids.length) return;
    if (!demo) await api("/academy/notifications/read", { ids });
    setNotifications((v) =>
      v.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)),
    );
  };
  useEffect(() => {
    if (!user || demo || !["live", "reports"].includes(tab)) return;
    let active = true,
      inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const [c, m] = await Promise.all([
          api<any[]>("/catalog"),
          api<any[]>("/meetings"),
        ]);
        if (active) {
          setClassrooms(c);
          setClassroomsLoaded(true);
          setMeetings(m);
          setScheduleError("");
        }
      } catch (e) {
        if (active) setScheduleError((e as Error).message);
      } finally {
        inFlight = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [user, tab]);
  const vip = profile.expires_at && Date.parse(profile.expires_at) > Date.now();
  if (loading)
    return <main className="academy-loading">Đang mở cổng học tập…</main>;
  if (room && user && demo)
    return (
      <PreviewRoom
        role={user.role}
        title={room.title}
        onExit={() => goAcademy(academyPaths.live)}
      />
    );
  if (room && user)
    return (
      <RoomComponent
        meeting={room}
        user={user}
        error={error}
        onError={setError}
        onExit={() => {
          goAcademy(academyPaths.live);
        }}
      />
    );
  if (!user)
    return (
      <AcademyAuthFrame brand={brand}>
        <main className="academy-auth">
          <a href="/">← Trang giới thiệu</a>
          <h1>
            {authTab === "register"
              ? "Tạo tài khoản học tập"
              : "Chào mừng trở lại"}
          </h1>
          <div className="academy-tabs">
            <button
              onClick={() => {
                if (goAcademy("/dang-nhap" + location.search)) {
                  setAuthTab("login");
                  setChallenge("");
                }
              }}
            >
              Đăng nhập
            </button>
            <button
              onClick={() => {
                if (goAcademy("/dang-ky" + (location.search || ""))) {
                  setChallenge("");
                }
              }}
            >
              Đăng ký học thử
            </button>
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          {(intentCourse || intentPlan) && (
            <p className="academy-intent-notice">
              Đăng nhập hoặc tạo tài khoản để tiếp tục{" "}
              {intentCourse ? "khóa học đã chọn" : "gói học đã chọn"}. Thông tin
              lựa chọn được giữ trong quá trình đăng ký.
            </p>
          )}
          <form
            onInvalidCapture={() =>
              setError("Vui lòng điền đầy đủ và kiểm tra các ô được đánh dấu.")
            }
            onSubmit={(e) => {
              e.preventDefault();
              const v = Object.fromEntries(new FormData(e.currentTarget));
              void perform(async () => {
                if (authTab === "login") {
                  const result = await api(
                    challenge ? "/login/2fa" : "/login",
                    challenge
                      ? { challenge, code: v.code }
                      : { email: v.email, password: v.password },
                  );
                  if (result.requires_2fa) {
                    setChallenge(result.challenge);
                    return;
                  }
                  setUser(result);
                } else {
                  await api("/academy/register", {
                    email: v.email,
                    password: v.password,
                    avatar_data: await registrationAvatarData(v.avatar as File),
                    profile: {
                      name: v.name,
                      dob: v.dob,
                      address: v.address,
                      school_name: v.school_name,
                      phone: v.phone,
                      parent_phone: v.parent_phone,
                      marketing_consent: v.marketing_consent === "on",
                    },
                  });
                  setAuthTab("login");
                  setNotice(
                    "Tài khoản đã tạo. Hệ thống sẽ gửi link xác thực qua email; bấm link một lần, không cần nhập mã. Anh/chị có thể đăng nhập ngay.",
                  );
                  goAcademy("/dang-nhap" + location.search, true);
                }
              });
            }}
          >
            {!challenge && (
              <div>
                <label>
                  Email
                  <input
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                  />
                </label>
                <label>
                  Mật khẩu
                  <input
                    name="password"
                    type="password"
                    minLength={6}
                    required
                    autoComplete={
                      authTab === "register"
                        ? "new-password"
                        : "current-password"
                    }
                  />
                </label>
              </div>
            )}
            {authTab === "register" && (
              <div>
                <div className="academy-form-grid">
                  {[
                    ["name", "Họ tên", "text"],
                    ["dob", "Ngày sinh", "date"],
                    ["address", "Địa chỉ", "text"],
                    ["school_name", "Trường đang học", "text"],
                    ["phone", "Số điện thoại", "tel"],
                    ["parent_phone", "Số điện thoại phụ huynh", "tel"],
                  ].map(([key, label, type]) => (
                    <label key={key}>
                      {label}
                      {type === "date" ? (
                        <VNDateInput name={key} label={label} required />
                      ) : (
                        <input
                          name={key}
                          type={type}
                          pattern={
                            type === "tel" ? "[+]?[0-9]{9,15}" : undefined
                          }
                          required
                        />
                      )}
                    </label>
                  ))}
                </div>
                <label>
                  Ảnh đại diện
                  <span className="academy-file-picker">
                    <input
                      aria-label="Ảnh đại diện"
                      name="avatar"
                      type="file"
                      accept="image/png,image/jpeg"
                      required
                      onChange={(e) =>
                        setSignupAvatarName(e.target.files?.[0]?.name || "")
                      }
                    />
                    <span className="academy-file-button" aria-hidden="true">
                      Chọn ảnh
                    </span>
                    <small>{signupAvatarName || "Chưa chọn ảnh"}</small>
                  </span>
                </label>
                <label className="academy-check">
                  <input type="checkbox" name="marketing_consent" />
                  Tôi muốn nhận lịch khai giảng và ưu đãi.
                </label>
                <small>
                  Điền đầy đủ tất cả thông tin bắt buộc. Sau khi tạo tài khoản,
                  kiểm tra hộp thư và bấm liên kết để xác thực email. Không cần
                  nhập mã.
                </small>
              </div>
            )}
            {challenge && (
              <label>
                Mã xác thực hai bước
                <input
                  name="code"
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                />
              </label>
            )}
            {authTab === "login" && !challenge && (
              <button
                type="button"
                className="secondary"
                onClick={(e) => {
                  const input = e.currentTarget.form?.elements.namedItem(
                    "email",
                  ) as HTMLInputElement;
                  if (!input?.reportValidity()) return;
                  void perform(async () => {
                    const v = await api("/academy/verification-link", {
                      email: input.value,
                    });
                    setNotice(v.message);
                  });
                }}
              >
                Gửi lại liên kết xác thực email
              </button>
            )}
            <button className="academy-primary">
              {authTab === "register" ? "Tạo tài khoản" : "Đăng nhập"}
            </button>
          </form>
        </main>
      </AcademyAuthFrame>
    );
  const admin = user.role === "admin",
    staff = user.role !== "student";
  const routePermission = (
    {
      manage: "content",
      website: "content",
      academic: "academic",
      accounts: "accounts",
      orders: "finance",
      students: "accounts",
      finance: "finance",
      settings: "finance",
    } as Record<string, string>
  )[route.tab];
  const routeForbidden =
    (!!routePermission &&
      (!admin ||
        (user.permissions != null &&
          !user.permissions.includes(routePermission)))) ||
    (!!route.orderId && user.role !== "student");
  return (
    <div className={"academy-shell" + (!admin ? " classroom-shell" : "")}>
      <aside data-menu-open={menuOpen}>
        <a className="academy-brand" href="/hoc">
          <span className="academy-logo-mark">
            <AcademyIcon name="courses" />
          </span>
          <span className="academy-brand-name">
            {brand}
            <small>KHÔNG GIAN HỌC TẬP</small>
          </span>
        </a>
        <button
          className="academy-menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="academy-navigation"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <AcademyIcon name="menu" />
          Danh mục
        </button>
        <div className="academy-user-card">
          <span className="academy-user-avatar">
            {user.name?.trim().charAt(0) || "V"}
          </span>
          <div>
            <strong>{user.name}</strong>
            <small>
              {admin ? "Quản trị nền tảng" : staff ? "Giáo viên" : "Học viên"}
            </small>
          </div>
        </div>
        <nav id="academy-navigation" aria-label="Danh mục học tập">
          {(admin ? [
            ["live", "Lớp học trực tiếp"], ["academic", "Lớp & giáo viên"],
            ["reports", "Điểm danh & bản ghi"], ["manage", "Quản lý nội dung"],
            ["courses", "Khóa học"], ["students", "Học viên"],
            ["orders", "Duyệt thanh toán"], ["finance", "Thu chi"],
            ["website", "Quản trị website"], ["accounts", "Tài khoản & phân quyền"],
            ["settings", "Email & thanh toán"], ["notifications", "Thông báo"],
            ["profile", "Tài khoản của bạn"],
          ] : staff ? [
            ["live", "Lớp học"], ["courses", "Kho bài giảng"],
            ["reports", "Điểm danh & bản ghi"], ["notifications", "Thông báo"],
            ["profile", "Tài khoản của bạn"],
          ] : [
            ["live", "Lớp học"], ["courses", "Kho bài giảng"],
            ["reports", "Điểm danh & bản ghi"], ["vip", "Gói học & thanh toán"],
            ["notifications", "Thông báo"], ["profile", "Hồ sơ học viên"],
          ])
            .filter(
              ([id]) =>
                !admin ||
                user.permissions == null ||
                !(
                  {
                    manage: "content",
                    website: "content",
                    academic: "academic",
                    accounts: "accounts",
                    orders: "finance",
                    students: "accounts",
                    finance: "finance",
                    settings: "finance",
                  } as Record<string, string>
                )[id] ||
                user.permissions.includes(
                  (
                    {
                      manage: "content",
                      website: "content",
                      academic: "academic",
                      accounts: "accounts",
                      orders: "finance",
                      students: "accounts",
                      finance: "finance",
                      settings: "finance",
                    } as Record<string, string>
                  )[id],
                ),
            )
            .map(([id, label]) => (
              <a
                key={id}
                role="button"
                href={academyHref(academyPaths[id])}
                aria-current={tab === id ? "page" : undefined}
                className={tab === id ? "active" : ""}
                onClick={(e) => {
                  academyClick(e, academyPaths[id]);
                  setMenuOpen(false);
                }}
              >
                <AcademyIcon name={id} />
                <span>
                  {label}
                  {id === "notifications" &&
                    notifications.some((n) => !n.read) && (
                      <b className="academy-notification-count">
                        {notifications.filter((n) => !n.read).length}
                      </b>
                    )}
                </span>
              </a>
            ))}
        </nav>
        <button
          className="academy-logout"
          onClick={() =>
            void perform(async () => {
              if (!demo) await api("/logout", {});
              clearAccount();
            })
          }
        >
          <AcademyIcon name="logout" />
          Đăng xuất
        </button>
      </aside>
      <main key={route.subjectId ? "subject:" + route.subjectId : route.path}>
        <header>
          <div>
            <small>
              {demo
                ? "BẢN DEMO · DỮ LIỆU MINH HỌA"
                : admin
                  ? "QUẢN TRỊ NỀN TẢNG"
                  : staff
                    ? "KHÔNG GIAN GIẢNG DẠY"
                    : "KHÔNG GIAN HỌC TẬP"}
            </small>
            <h1>
              {tab === "courses"
                ? admin
                  ? "Tổng quan khóa học"
                  : staff
                    ? "Không gian giảng dạy"
                    : "Học từng bước. Tiến bộ mỗi ngày."
                : tab === "vip"
                  ? "Chọn gói học phù hợp"
                  : tab === "orders"
                    ? "Đối soát thanh toán"
                    : tab === "manage"
                      ? "Khóa học, bài giảng và gói học"
                      : tab === "website"
                        ? "Quản trị nội dung website"
                        : tab === "finance"
                          ? "Thu chi trung tâm"
                          : tab === "students"
                            ? "Học viên"
                            : tab === "live"
                              ? admin
                                ? "Lớp học trực tiếp"
                                : "Lớp học của tôi"
                              : tab === "notifications"
                                ? "Thông báo"
                                : tab === "reports"
                                  ? "Điểm danh & bản ghi"
                                  : tab === "academic"
                                    ? "Lớp học và giáo viên"
                                    : tab === "accounts"
                                      ? "Tài khoản và phân quyền"
                                      : tab === "settings"
                                        ? "Cài đặt kinh doanh"
                                        : "Tài khoản của bạn"}
            </h1>
          </div>
          <span className="academy-badge">
            {staff
              ? admin
                ? "Quản trị viên"
                : "Giáo viên"
              : vip
                ? "VIP đang hoạt động"
                : "Học thử miễn phí"}
          </span>
        </header>
        <AcademyBreadcrumbs
          route={route}
          courses={courses}
          classrooms={demo ? demoClassrooms : classrooms}
          title={routeTitle}
        />
        {routeBusy && (
          <p role="status" className="academy-notice">
            Đang mở nội dung đã chọn…
          </p>
        )}
        {(route.invalid || routeError || routeForbidden) && (
          <section className="academy-route-error" role="alert">
            <h2>
              {routeForbidden
                ? "Bạn không có quyền mở trang này"
                : route.invalid
                  ? "Không tìm thấy trang"
                  : routeError}
            </h2>
            <a
              href={academyHref("/hoc")}
              onClick={(e) => academyClick(e, "/hoc")}
            >
              Quay lại không gian học tập
            </a>
            {routeError && (
              <button className="secondary" onClick={() => location.reload()}>
                Thử lại
              </button>
            )}
          </section>
        )}
        {tab === "notifications" && (
          <AcademyNotificationList
            rows={notifications}
            error={notificationError}
            onRead={readNotifications}
          />
        )}
        {scheduleError && ["live", "reports"].includes(tab) && (
          <p role="alert" className="error">
            Không tải được lịch học: {scheduleError}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="academy-notice" role="status">
            {notice}
          </p>
        )}
        {!route.invalid &&
          !routeError &&
          !routeForbidden &&
          !routeBusy &&
          !admin &&
          tab === "live" && (
            <AcademyToday
              demo={demo}
              role={user.role}
              onMeeting={(m: any) => void perform(() => openMeeting(m))}
              onCourse={showCourse}
            />
          )}
        {!routeBusy && !routeError && !route.invalid && tab === "courses" && (
          <>
            <div className="academy-stats">
              <article>
                <small>Khóa học đang mở</small>
                <strong>{courses.length}</strong>
              </article>
              <article>
                <small>
                  {staff ? "Không gian làm việc" : "Quyền xem video"}
                </small>
                <strong>
                  {staff
                    ? admin
                      ? "Quản trị"
                      : "Giảng dạy"
                    : vip
                      ? "VIP"
                      : `${freeQuota} bài/tháng`}
                </strong>
              </article>
              <article>
                <small>{staff ? "Truy cập lớp học" : "Hạn gói học"}</small>
                <strong>
                  {staff
                    ? "Theo phân công"
                    : vip
                      ? vnDate(profile.expires_at)
                      : "Chưa đăng ký"}
                </strong>
              </article>
            </div>
            {catalogLoaded &&
              intentCourse &&
              !courses.some((c) => c.id === intentCourse) && (
                <p role="alert">
                  Không tìm thấy khóa học hoặc tài khoản chưa có quyền truy cập.{" "}
                  <a
                    href={academyHref(academyPaths.courses)}
                    onClick={(e) => academyClick(e, academyPaths.courses)}
                  >
                    Xem danh mục được cấp quyền
                  </a>
                </p>
              )}
            <div className="academy-course-grid">
              {courses.map((c) => (
                <CourseCard
                  key={c.id}
                  course={c}
                  demo={demo}
                  staff={staff}
                  perform={perform}
                  onNotice={setNotice}
                  onUpgrade={(id: string) => {
                    goAcademy(
                      academyPaths.vip + "?khoa=" + encodeURIComponent(id),
                    );
                  }}
                  focus={intentCourse === c.id}
                  focusLesson={intentCourse === c.id ? intentLesson : ""}
                  focusTasks={intentCourse === c.id && intentTasks}
                  focusAssignment={
                    intentCourse === c.id ? route.assignmentId : undefined
                  }
                />
              ))}
            </div>
            {!courses.length && (
              <p>Trung tâm đang chuẩn bị khóa học đầu tiên.</p>
            )}
          </>
        )}
        {user.role === "student" && tab === "live" && !route.subjectId && !route.classId && <StudentLiveClasses demo={demo} onEnter={async m=>{if(!demo){setClassrooms(await api("/catalog"));setMeetings(await api("/meetings"))}await openMeeting(m)}}/>}
        {admin && tab === "reports" && (user.permissions == null || ["attendance","recordings","content"].every(p=>user.permissions.includes(p))) && <LearningDataCleanup demo={demo} />}
        {!routeBusy &&
          !routeError &&
          !route.invalid &&
          ["live", "reports"].includes(tab) &&
          !classroomsLoaded && <p role="status">Đang tải lớp học…</p>}
        {!routeBusy &&
          !routeError &&
          !route.invalid &&
          classroomsLoaded &&
 (user.role !== "student" || tab !== "live" || route.subjectId || route.classId || demo || classrooms.length > 0) &&
          ["live", "reports"].includes(tab) && (
            <LearningWorkspace
              routed
              role={user.role}
              courses={demo ? demoClassrooms : classrooms}
              meetings={demo ? demoMeetings : meetings}
              demo={demo}
              reports={tab === "reports"}
              renderClasswork={(id) => {
                const c = courses.find((v) => v.academic_course_id === id);
                return c ? (
                  <Assignments
                    course={c.id}
                    demo={demo}
                    staff={staff}
                    perform={perform}
                  />
                ) : null;
              }}
              canTeach={staff}
 canLive={demo || !!vip}
              canVideo={true}
              onRefresh={async () => {
                if (demo) return;
                setClassrooms(await api("/catalog"));
                setMeetings(await api("/meetings"));
              }}
              onOpen={(m) => void perform(() => openMeeting(m))}
            />
          )}
        {!routeForbidden && tab === "vip" && (
          <VipPanel
            intentPlan={intentPlan}
            intentCourse={intentCourse}
            orderId={route.orderId}
            onContinue={() => showCourse(intentCourse)}
            refreshMembership={refresh}
            demo={demo}
            plans={plans}
            perform={perform}
            notice={setNotice}
          />
        )}
        {tab === "profile" && (
          <ProfilePanel
            demo={demo}
            profile={profile}
            user={user}
            perform={perform}
            refresh={refresh}
            notice={setNotice}
          />
        )}
        {!routeForbidden && admin && tab === "manage" && (
          <ManagePanel
            canFinance={
              user.permissions == null || user.permissions.includes("finance")
            }
            demo={demo}
            courses={courses}
            perform={perform}
            refresh={refresh}
            notice={setNotice}
          />
        )}
        {!routeForbidden && admin && tab === "settings" && (
          <AcademySettings demo={demo} />
        )}
        {!routeForbidden && admin && tab === "website" && (
          <AcademySiteEditor
            demo={demo}
            courses={courses}
            perform={perform}
            notice={setNotice}
          />
        )}
        {!routeForbidden && admin && tab === "academic" && (
          <AcademicAdmin
            demo={demo}
            onChange={refresh}
            canManageAccounts={
              user.permissions == null || user.permissions.includes("accounts")
            }
          />
        )}
        {!routeForbidden && admin && tab === "accounts" && (
          <Accounts demo={demo} />
        )}
        {!routeForbidden && admin && tab === "orders" && (
          <AcademyVIPPlans demo={demo} />
        )}
        {!routeForbidden &&
          admin &&
          ["orders", "students", "finance"].includes(tab) && (
            <BusinessTable
              key={tab}
              kind={tab}
              demo={demo}
              perform={perform}
              notice={setNotice}
            />
          )}
        <footer>
          Thông tin học tập và thanh toán chỉ hiển thị theo quyền tài khoản.
        </footer>
      </main>
    </div>
  );
}
function CourseCard({
  course,
  demo,
  staff,
  perform,
  onNotice,
  onUpgrade,
  focus = false,
  focusLesson = "",
  focusTasks = false,
  focusAssignment = "",
}: any) {
  const [open, setOpen] = useState(false),
    [lessons, setLessons] = useState<any[]>([]),
    [video, setVideo] = useState<any>(null),
    [tasks, setTasks] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const ref = useRef<HTMLVideoElement>(null),
    saved = useRef(0);
  async function load() {
    setOpen(!open);
    if (!open)
      setLessons(
        demo
          ? [
              {
                id: "demo-lesson",
                title: "Bài 1 · Bắt đầu từ kiến thức cốt lõi",
                duration_seconds: 1800,
                progress_seconds: 420,
                status: "ready",
              },
            ]
          : await api(`/academy/courses/${course.id}/lessons`),
      );
  }
  useEffect(() => {
    if (!focus) return;
    let active = true;
    setOpen(true);
    setTasks(focusTasks);
    void perform(async () => {
      const rows = demo
        ? [
            {
              id: "demo-lesson",
              title: "Bài 1 · Bắt đầu từ kiến thức cốt lõi",
              duration_seconds: 1800,
              progress_seconds: 420,
              status: "ready",
            },
          ]
        : await api(`/academy/courses/${course.id}/lessons`);
      if (active) {
        setLessons(rows);
        cardRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    });
    return () => {
      active = false;
    };
  }, [focus, focusLesson, focusTasks, course.id]);
  async function play(l: any) {
    if (demo) {
      onNotice("Video minh họa: chưa có file thật.");
      return;
    }
    const v = await api(`/academy/lessons/${l.id}/play`, {});
    setVideo({ ...v, id: l.id, position: l.progress_seconds || 0 });
  }
  async function save(completed = false) {
    if (!video || !ref.current || demo) return;
    const seconds = Math.min(
      video.duration_seconds,
      Math.floor(ref.current.currentTime),
    );
    if (!completed && Math.abs(seconds - saved.current) < 15) return;
    saved.current = seconds;
    await api(`/academy/lessons/${video.id}/progress`, {
      seconds,
      completed,
    }).catch(() => {});
  }
  useEffect(() => {
    if (!video || demo) return;
    const timer = setInterval(() => {
      const position = ref.current?.currentTime || 0;
      void api(`/academy/lessons/${video.id}/play`, {})
        .then((v) => setVideo((old: any) => ({ ...old, ...v, position })))
        .catch(() => ref.current?.pause());
    }, 90000);
    return () => clearInterval(timer);
  }, [video?.id]);
  return (
    <article
      ref={cardRef}
      className={"academy-course" + (focus ? " academy-course-selected" : "")}
      id={"course-" + course.id}
    >
      <div className="academy-course-art">
        <img src={subjectArt(course.title)} alt="" width={400} height={260} loading="lazy" decoding="async"/>
      </div>
      <div className="academy-course-body">
        <h2>{course.title}</h2>
        <p>{course.description}</p>
        <a
          className="academy-course-public-link"
          href={"/khoa-hoc/" + course.id}
        >
          Thông tin khóa học ↗
        </a>
        <small>{course.teacher_name || "Đội ngũ giáo viên"}</small>
        <div className="academy-actions">
          <button
            className="academy-primary"
            onClick={() => {
              if (open) setOpen(false);
              else if (focus) void perform(load);
              else goAcademy("/hoc/khoa-hoc/" + course.id);
            }}
          >
            {open ? "Thu gọn" : "Xem bài học"}
          </button>
          <a
            role="button"
            href={academyHref("/hoc/khoa-hoc/" + course.id + "?bai-tap=1")}
            onClick={(e) =>
              academyClick(e, "/hoc/khoa-hoc/" + course.id + "?bai-tap=1")
            }
          >
            Bài tập
          </a>
          {!staff && onUpgrade && (
            <button className="secondary" onClick={() => onUpgrade(course.id)}>
              Gói học & quyền lợi
            </button>
          )}
        </div>
        <CourseClassroomLink
          course={course}
          demo={demo}
          role={staff ? "teacher" : "student"}
          perform={perform}
          notice={onNotice}
        />
        {open && (
          <div>
            {!lessons.length ? (
              <p>Chưa có bài giảng xuất bản.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Bài học</th>
                    <th>Tiến độ</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lessons.map((l, index) => (
                    <tr
                      key={l.id}
                      className={
                        l.id === focusLesson ? "academy-selected-lesson" : ""
                      }
                    >
                      <td>
                        <strong>
                          {index + 1}. {l.title}
                        </strong>
                        {l.chapter && (
                          <small className="academy-lesson-chapter">
                            {l.chapter}
                          </small>
                        )}
                        {l.notes && (
                          <details>
                            <summary>Ghi chú bài giảng</summary>
                            <p className="academy-lesson-notes">{l.notes}</p>
                          </details>
                        )}
                        {l.id === focusLesson && (
                          <small> · Bài bạn đã chọn</small>
                        )}
                      </td>
                      <td>
                        <progress
                          max={l.duration_seconds || 1}
                          value={l.progress_seconds || 0}
                        />
                      </td>
                      <td>
                        {focusLesson === l.id ? (
                          <button onClick={() => void perform(() => play(l))}>
                            Phát bài giảng
                          </button>
                        ) : (
                          <a
                            role="button"
                            href={academyHref("/hoc/bai-giang/" + l.id)}
                            onClick={(e) =>
                              academyClick(e, "/hoc/bai-giang/" + l.id)
                            }
                          >
                            Xem
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        {video && (
          <div className="academy-player">
            <video
              ref={ref}
              src={video.url}
              controls
              playsInline
              autoPlay
              onLoadedMetadata={() => {
                if (ref.current) ref.current.currentTime = video.position || 0;
              }}
              onPause={() => void save()}
              onEnded={() => void save(true)}
              onTimeUpdate={() => void save()}
            />
            <label>
              Tốc độ{" "}
              <select
                onChange={(e) => {
                  if (ref.current)
                    ref.current.playbackRate = Number(e.target.value);
                }}
              >
                {[0.75, 1, 1.25, 1.5, 2].map((n) => (
                  <option key={n} value={n}>
                    {n}×
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {tasks && (
          <Assignments
            course={course.id}
            demo={demo}
            staff={staff}
            perform={perform}
            preferred={focusAssignment}
          />
        )}
      </div>
    </article>
  );
}
function VipPanel({
  demo,
  plans,
  perform,
  notice,
  intentPlan = "",
  intentCourse = "",
  onContinue,
  refreshMembership,
  orderId = "",
}: any) {
  const [order, setOrder] = useState<any>(null),
    [creating, setCreating] = useState(false),
    [history, setHistory] = useState<any[]>([]);
  const orderPath = (id: string) =>
    "/hoc/thanh-toan/" +
    id +
    (intentCourse ? "?khoa=" + encodeURIComponent(intentCourse) : "");
  const creatingRef = useRef(false);
  useEffect(() => {
    if (!orderId) {
      setOrder(null);
      return;
    }
    let active = true;
    void perform(async () => {
      const v = demo
        ? {
            id: orderId,
            amount: 299000,
            description: "NAPVIP DEMO",
            status: "pending",
          }
        : await api("/academy/orders/" + orderId);
      if (active) setOrder(v);
    });
    return () => {
      active = false;
    };
  }, [orderId, demo]);
  useEffect(() => {
    if (!demo)
      void api<any[]>("/academy/orders")
        .then(setHistory)
        .catch(() => {});
  }, []);
  async function checkPayment() {
    if (demo) {
      notice("Bản minh họa không có thanh toán thật.");
      return;
    }
    setHistory(await api("/academy/orders"));
    if (orderId) setOrder(await api("/academy/orders/" + orderId));
    await refreshMembership?.();
  }
  useEffect(() => {
    if (
      demo ||
      !order ||
      history.some((v: any) => v.id === order.id && v.status === "paid")
    )
      return;
    const timer = setInterval(() => void perform(checkPayment), 15000);
    return () => clearInterval(timer);
  }, [
    order?.id,
    demo,
    history.some((v: any) => v.id === order?.id && v.status === "paid"),
  ]);
  return (
    <>
      <p className="vip-mobile-hint">Vuốt ngang để xem thêm →</p>
      <div className="academy-course-grid academy-vip-offers" role="region" aria-label="Các gói VIP" tabIndex={0}>
        {plans.map((p: any) => (
          <article
            className={
              "academy-plan" +
              (p.id === intentPlan ? " academy-course-selected" : "")
            }
            key={p.id}
          >
            <small>GÓI HỌC</small>
            <h2>{p.name}</h2>
            <strong>{money(p.price_vnd)}</strong>
            <p>
              {p.days} ngày · Video & Live
            </p>
            <ul>
              <li>Xem bài giảng trong danh mục trung tâm</li>
              <li>Theo dõi tiến độ và làm bài tập</li>
            </ul>
            <button
              className="academy-primary"
              disabled={creating}
              onClick={() => {
                if (creatingRef.current) return;
                creatingRef.current = true;
                setCreating(true);
                void perform(async () => {
                  if (demo) {
                    notice("Đơn hàng mô phỏng; không có thanh toán thật.");
                    goAcademy(orderPath("demo-order"));
                    return;
                  }
                  const created = await api("/academy/orders", {
                    plan_id: p.id,
                  });
                  goAcademy(orderPath(created.id));
                }).finally(() => {
                  creatingRef.current = false;
                  setCreating(false);
                });
              }}
            >
              {creating ? "Đang tạo đơn…" : "Chọn gói"}
            </button>
          </article>
        ))}
      </div>
      {order && (
        <section className="academy-section">
          <h2>Thanh toán đơn hàng</h2>
          <p>
            Số tiền: <strong>{money(order.amount)}</strong>
          </p>
          <p>
            Nội dung: <strong>{order.description}</strong>
          </p>
          <p role="status">
            {order.status === "paid"
              ? "Đã thanh toán"
              : order.status === "rejected"
                ? "Đã từ chối"
                : order.status === "refunded"
                  ? "Đã hoàn tiền"
                  : "Chờ thanh toán / đối soát"}
          </p>
          {order.status !== "paid" &&
            order.status !== "refunded" &&
            order.qr_url && (
              <img
                className="academy-qr"
                src={order.qr_url}
                alt="QR chuyển khoản"
              />
            )}
          {order.status === "pending" && order.checkout_url && (
            <a href={order.checkout_url} target="_blank" rel="noopener">
              Mở trang thanh toán
            </a>
          )}
          <p>
            Ảnh biên lai đưa đơn vào hàng chờ duyệt, không tự kích hoạt VIP.
          </p>
          {order.status === "pending" && (
            <label>
              Đính kèm biên lai
              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file)
                    void perform(async () => {
                      if (demo) {
                        notice("Biên lai minh họa.");
                        return;
                      }
                      const signed = await api("/academy/uploads", {
                        kind: "receipts",
                        type: file.type,
                        size: file.size,
                        order: order.id,
                      });
                      const response = await fetch(signed.url, {
                        method: "PUT",
                        headers: { "Content-Type": file.type },
                        body: file,
                      });
                      if (!response.ok) throw Error("Tải biên lai thất bại");
                      await api(`/academy/orders/${order.id}/receipt`, {
                        key: signed.key,
                      });
                      notice("Đã gửi biên lai để đối soát.");
                    });
                }}
              />
            </label>
          )}
        </section>
      )}
      <div className="academy-actions">
        <button
          className="secondary"
          onClick={() => void perform(checkPayment)}
        >
          Cập nhật trạng thái thanh toán
        </button>
        <button onClick={onContinue}>Tiếp tục khóa học đã chọn</button>
      </div>
      <DataTable
        rows={history.map((row: any) => ({
          ...row,
          status:
            (
              {
                pending: "Chờ thanh toán",
                review: "Chờ đối soát",
                paid: "Đã thanh toán",
                rejected: "Đã từ chối",
                expired: "Đã hết hạn",
              } as Record<string, string>
            )[row.status] || row.status,
        }))}
        actions={(row: any) => (
          <a
            href={academyHref(orderPath(row.id))}
            onClick={(e) => academyClick(e, orderPath(row.id))}
          >
            Xem đơn
          </a>
        )}
        columns={[
          ["code", "Mã đơn"],
          ["price_vnd", "Số tiền"],
          ["status", "Trạng thái"],
          ["paid_at", "Ngày thu"],
        ]}
      />
    </>
  );
}
function ProfilePanel({ demo, profile, user, perform, refresh, notice }: any) {
  return (
    <section className="academy-section">
      <h2>{user.role === "student" ? "Hồ sơ học viên" : "Tài khoản của bạn"}</h2>
      <p>Email: {profile.email || user.email || "—"}</p>
      {profile.live_expires_at && (
        <p>Quyền học Live đến: {vnDateTime(profile.live_expires_at)}</p>
      )}
      <p>
        {profile.email_verified
          ? "Email đã xác thực"
          : "Email đang chờ xác thực qua liên kết trong hộp thư."}
      </p>
      {profile.registration_avatar && (
        <img
          src="/api/academy/profile/avatar"
          alt="Ảnh đại diện của bạn"
          width={80}
          height={80}
        />
      )}
      <form
        className="academy-form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const v: any = Object.fromEntries(new FormData(e.currentTarget));
          void perform(async () => {
            if (demo) {
              notice("Đã lưu hồ sơ minh họa.");
              return;
            }
            await api("/academy/profile", {
              ...v,
              marketing_consent: v.marketing_consent === "on",
              name: user.name,
              avatar_key: profile.avatar_key || "",
            });
            await refresh();
            notice("Đã lưu hồ sơ.");
          });
        }}
      >
        {[
          ["dob", "Ngày sinh", "date"],
          ["address", "Địa chỉ", "text"],
          ["school_name", "Trường đang học", "text"],
          ["phone", "Điện thoại", "tel"],
          ["parent_phone", "Điện thoại phụ huynh", "tel"],
        ].filter(([key]) => user.role === "student" || !["school_name", "parent_phone"].includes(key)).map(([key, label, type]) => (
          <label key={key}>
            {label}
            {type === "date" ? (
              <VNDateInput
                name={key}
                label={label}
                defaultValue={String(profile[key] || "").slice(0, 10)}
                required
              />
            ) : (
              <input
                name={key}
                type={type}
                defaultValue={String(profile[key] || "").slice(
                  0,
                  type === "date" ? 10 : 500,
                )}
                required
              />
            )}
          </label>
        ))}
        <label className="academy-check">
          <input
            type="checkbox"
            name="marketing_consent"
            defaultChecked={!!profile.marketing_consent}
          />
          Đồng ý nhận thông tin khai giảng/ưu đãi
        </label>
        <button className="academy-primary">Lưu hồ sơ</button>
      </form>
      <label>
        Ảnh đại diện
        <input
          type="file"
          accept="image/png,image/jpeg"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              void perform(async () => {
                if (demo) {
                  notice("Ảnh đại diện minh họa.");
                  return;
                }
                const v = await api("/academy/uploads", {
                  kind: "avatars",
                  type: file.type,
                  size: file.size,
                });
                const r = await fetch(v.url, {
                  method: "PUT",
                  headers: { "Content-Type": file.type },
                  body: file,
                });
                if (!r.ok) throw Error("Tải ảnh thất bại");
                await api("/academy/profile", {
                  name: user.name,
                  dob: String(profile.dob).slice(0, 10),
                  address: profile.address,
                  school_name: profile.school_name,
                  phone: profile.phone,
                  parent_phone: profile.parent_phone,
                  avatar_key: v.key,
                  marketing_consent: !!profile.marketing_consent,
                });
                await refresh();
                notice("Đã cập nhật ảnh.");
              });
          }}
        />
      </label>
    </section>
  );
}
function DataTable({ rows, columns, actions }: any) {
  return (
    <div className="academy-table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map(([key, label]: any) => (
              <th key={key}>{label}</th>
            ))}
            {actions && <th>Thao tác</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row: any, i: number) => (
            <tr key={row.id || i}>
              {columns.map(([key]: any) => (
                <td key={key}>{vnDateCell(row[key], key)}</td>
              ))}
              {actions && <td>{actions(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p>Chưa có dữ liệu.</p>}
    </div>
  );
}
function BusinessTable({ kind, demo, perform, notice }: any) {
  useAcademyRoute();
  const focusedOrder =
    kind === "orders" ? new URLSearchParams(location.search).get("don") : null;
  const [rows, setRows] = useState<any[]>([]),
    [receipt, setReceipt] = useState("");
  const load = async () =>
    setRows(
      demo
        ? kind === "orders"
          ? [
              {
                id: "demo-order",
                code: 1001,
                name: "Học viên minh họa",
                price_vnd: 299000,
                status: "pending",
              },
            ]
          : []
        : await api(
            kind === "finance" ? "/academy/finance" : `/academy/admin/${kind}`,
          ),
    );
  useEffect(() => {
    void perform(load);
  }, [kind]);
  return (
    <section className="academy-section">
      <div className="academy-actions">
        {focusedOrder && (
          <a
            href={academyHref(academyPaths.orders)}
            onClick={(e) => academyClick(e, academyPaths.orders)}
          >
            ← Tất cả đơn hàng
          </a>
        )}
        <button onClick={() => void perform(load)}>Tải lại</button>
        <a
          href={
            demo
              ? undefined
              : `/api/academy/export/${kind === "orders" ? "finance" : kind}`
          }
          onClick={(e) => {
            if (demo) {
              e.preventDefault();
              notice("Xuất Excel cần dữ liệu thật.");
            }
          }}
        >
          Xuất Excel
        </a>
      </div>
      {kind === "finance" && (
        <form
          className="academy-form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            const v: any = Object.fromEntries(new FormData(e.currentTarget));
            void perform(async () => {
              if (!demo)
                await api("/academy/finance", {
                  ...v,
                  amount_vnd: Number(v.amount_vnd),
                });
              notice(demo ? "Khoản chi minh họa." : "Đã ghi khoản chi.");
              await load();
            });
          }}
        >
          <label>
            Nội dung chi
            <input name="title" required />
          </label>
          <label>
            Số tiền VND
            <input name="amount_vnd" type="number" min="1" required />
          </label>
          <label>
            Ngày chi
            <VNDateInput name="paid_on" required />
          </label>
          <button>Lưu khoản chi</button>
        </form>
      )}
      <DataTable
        rows={focusedOrder ? rows.filter((r) => r.id === focusedOrder) : rows}
        columns={
          kind === "students"
            ? [
                ["name", "Học viên"],
                ["email", "Email"],
                ["phone", "Điện thoại"],
                ["parent_phone", "Phụ huynh"],
                ["expires_at", "Hết hạn VIP"],
              ]
            : kind === "finance"
              ? [
                  ["day", "Ngày"],
                  ["revenue", "Doanh thu VND"],
                  ["orders", "Đơn đã thu"],
                ]
              : [
                  ["code", "Mã đơn"],
                  ["name", "Học viên"],
                  ["price_vnd", "Số tiền"],
                  ["status", "Trạng thái"],
                ]
        }
        actions={
          kind === "orders"
            ? (row: any) => (
                <div className="academy-actions">
                  <button
                    onClick={() =>
                      void perform(async () => {
                        if (demo) {
                          notice("Biên lai mẫu chưa có ảnh.");
                          return;
                        }
                        setReceipt(
                          (await api(`/academy/orders/${row.id}/receipt`)).url,
                        );
                      })
                    }
                  >
                    Biên lai
                  </button>
                  {row.status === "pending" &&
                    ["approve", "reject"].map((action) => (
                      <button
                        key={action}
                        onClick={() =>
                          void perform(async () => {
                            if (demo) {
                              setRows((v) =>
                                v.map((x) =>
                                  x.id === row.id
                                    ? {
                                        ...x,
                                        status:
                                          action === "approve"
                                            ? "paid"
                                            : "rejected",
                                      }
                                    : x,
                                ),
                              );
                              notice(
                                "Thao tác mô phỏng; không có giao dịch thật.",
                              );
                              return;
                            }
                            await api(`/academy/orders/${row.id}/review`, {
                              action,
                              note: "",
                            });
                            await load();
                          })
                        }
                      >
                        {action === "approve" ? "Kích hoạt VIP" : "Từ chối"}
                      </button>
                    ))}
                </div>
              )
            : undefined
        }
      />
      {receipt && (
        <div className="academy-receipt">
          <button onClick={() => setReceipt("")}>Đóng ảnh</button>
          <img src={receipt} alt="Biên lai chuyển khoản riêng tư" />
        </div>
      )}
    </section>
  );
}
function ManagePanel({
  demo,
  courses,
  perform,
  refresh,
  notice,
  canFinance,
}: any) {
  return (
    <div className="academy-admin-grid">
      <AcademyLessonEditor
        demo={demo}
        courses={courses}
        perform={perform}
        notice={notice}
      />
      <AcademyCourseEditor
        demo={demo}
        courses={courses}
        perform={perform}
        refresh={refresh}
        notice={notice}
      />
      {canFinance && <AcademyVIPPlans demo={demo} />}
      <section className="academy-section">
        <h2>Thêm bài giảng</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = e.currentTarget,
              v: any = Object.fromEntries(new FormData(f)),
              file = v.file as File;
            void perform(async () => {
              if (demo) {
                notice("Tải video thật cần cấu hình R2.");
                return;
              }
              const out = await api(`/academy/courses/${v.course}/lessons`, {
                title: v.title,
                duration_seconds: Number(v.duration),
                size: file.size,
                type: file.type,
                chapter: v.chapter,
                notes: v.notes,
              });
              const response = await fetch(out.url, {
                method: "PUT",
                headers: { "Content-Type": file.type },
                body: file,
              });
              if (!response.ok) throw Error("Tải video thất bại");
              await api(`/academy/lessons/${out.id}/finish`, {});
              notice("Video đã xuất bản.");
            });
          }}
        >
          <label>
            Khóa học
            <select name="course" required>
              {courses.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tên bài giảng
            <input name="title" required />
          </label>
          <label>
            Chương / chủ đề
            <input name="chapter" maxLength={200} />
          </label>
          <label>
            Ghi chú cho học sinh
            <textarea name="notes" rows={4} maxLength={20000} />
          </label>
          <label>
            Thời lượng giây
            <input name="duration" type="number" min="1" required />
          </label>
          <label>
            Video MP4/WebM
            <input
              type="file"
              name="file"
              accept="video/mp4,video/webm"
              required
            />
          </label>
          <button>Tải và xuất bản</button>
        </form>
      </section>
    </div>
  );
}
function Assignments({ course, demo, staff, perform, preferred = "" }: any) {
  const [rows, setRows] = useState<any[]>([]),
    [submissions, setSubmissions] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [questions, setQuestions] = useState<any[]>([
      { id: "1", prompt: "", options: [], answer: "" },
    ]);
  const load = async () => {
    setRows(
      demo
        ? []
        : preferred
          ? [await api(`/academy/assignments/${preferred}`)]
          : await api(`/academy/courses/${course}/assignments`),
    );
    if (staff && preferred && !demo) {
      setSelected(preferred);
      setSubmissions(
        await api(`/academy/assignments/${preferred}/submissions`),
      );
    }
  };
  useEffect(() => {
    void perform(load);
  }, [course, preferred]);
  return (
    <section className="academy-assignments">
      <h3>Bài tập & nhận xét</h3>
      {staff && (
        <details>
          <summary>Giao bài tập</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const v: any = Object.fromEntries(new FormData(e.currentTarget));
              void perform(async () => {
                if (demo) return;
                await api(`/academy/courses/${course}/assignments`, {
                  title: v.title,
                  due_at: new Date(v.due).toISOString(),
                  questions,
                });
                await load();
              });
            }}
          >
            <label>
              Tên bài tập
              <input name="title" required />
            </label>
            <label>
              Hạn nộp
              <VNDateInput name="due" dateTime required />
            </label>
            {questions.map((q, i) => (
              <fieldset key={q.id}>
                <legend>Câu {i + 1}</legend>
                <label>
                  Câu hỏi
                  <textarea
                    value={q.prompt}
                    onChange={(e) =>
                      setQuestions((v) =>
                        v.map((x, n) =>
                          n === i ? { ...x, prompt: e.target.value } : x,
                        ),
                      )
                    }
                    required
                  />
                </label>
                <label>
                  Lựa chọn trắc nghiệm, mỗi dòng một lựa chọn; để trống cho tự
                  luận
                  <textarea
                    value={q.options.join("\n")}
                    onChange={(e) =>
                      setQuestions((v) =>
                        v.map((x, n) =>
                          n === i
                            ? {
                                ...x,
                                options: e.target.value
                                  .split("\n")
                                  .filter(Boolean),
                              }
                            : x,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Đáp án/ghi chú chấm
                  <input
                    value={q.answer}
                    onChange={(e) =>
                      setQuestions((v) =>
                        v.map((x, n) =>
                          n === i ? { ...x, answer: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setQuestions((v) => v.filter((_, n) => n !== i))
                  }
                >
                  Xóa câu
                </button>
              </fieldset>
            ))}
            <button
              type="button"
              onClick={() =>
                setQuestions((v) => [
                  ...v,
                  {
                    id: crypto.randomUUID(),
                    prompt: "",
                    options: [],
                    answer: "",
                  },
                ])
              }
            >
              Thêm câu hỏi
            </button>
            <button>Giao bài</button>
          </form>
        </details>
      )}
      {rows.map((row) => (
        <article
          key={row.id}
          id={"assignment-" + row.id}
          className={row.id === preferred ? "academy-selected-lesson" : ""}
        >
          <h4>
            <a
              href={academyHref("/hoc/bai-tap/" + row.id)}
              onClick={(e) => academyClick(e, "/hoc/bai-tap/" + row.id)}
            >
              {row.title}
            </a>
          </h4>
          <p>
            Hạn: {vnDateTime(row.due_at)} · Điểm: {row.score ?? "Chưa chấm"}
          </p>
          {row.feedback && <p>{row.feedback}</p>}
          {staff ? (
            <button
              onClick={() =>
                void perform(async () => {
                  if (preferred !== row.id) {
                    goAcademy("/hoc/bai-tap/" + row.id);
                    return;
                  }
                  setSelected(row.id);
                  setSubmissions(
                    await api(`/academy/assignments/${row.id}/submissions`),
                  );
                })
              }
            >
              Xem bài nộp
            </button>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const answers = Object.fromEntries(
                  new FormData(e.currentTarget),
                );
                void perform(async () => {
                  await api(`/academy/assignments/${row.id}/submissions`, {
                    answers,
                  });
                  await load();
                });
              }}
            >
              {row.questions.map((q: any) => (
                <label key={q.id}>
                  {q.prompt}
                  {q.options?.length ? (
                    <select name={q.id} required>
                      <option value="">Chọn câu trả lời</option>
                      {q.options.map((o: string) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <textarea name={q.id} required />
                  )}
                </label>
              ))}
              <button>Nộp bài</button>
            </form>
          )}
        </article>
      ))}
      {submissions.map((s) => (
        <form
          key={s.user_id}
          onSubmit={(e) => {
            e.preventDefault();
            const v: any = Object.fromEntries(new FormData(e.currentTarget));
            void perform(async () => {
              await api(`/academy/assignments/${selected}/grade`, {
                user_id: s.user_id,
                score: Number(v.score),
                feedback: v.feedback,
              });
              setSubmissions(
                await api(`/academy/assignments/${selected}/submissions`),
              );
            });
          }}
        >
          <h4>{s.name}</h4>
          <pre>
            {Object.entries(parse(s.answers))
              .map(([k, v]) => `${k}: ${v}`)
              .join("\n")}
          </pre>
          <label>
            Điểm
            <input
              type="number"
              name="score"
              min="0"
              max="10"
              step="0.01"
              defaultValue={s.score || 0}
              required
            />
          </label>
          <label>
            Nhận xét
            <textarea name="feedback" defaultValue={s.feedback || ""} />
          </label>
          <button>Lưu điểm</button>
        </form>
      ))}
    </section>
  );
}
