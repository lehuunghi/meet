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
    [tab, setTab] = useState(demo && role !== "admin" ? "live" : "courses"),
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
  const safeIntent = (key: string) => {
    const v = new URLSearchParams(location.search).get(key) || "";
    return /^[a-zA-Z0-9-]{1,36}$/.test(v) ? v : "";
  };
  const [intentCourse, setIntentCourse] = useState(safeIntent("course")),
    [intentLesson, setIntentLesson] = useState(safeIntent("lesson")),
    [intentTasks, setIntentTasks] = useState(false),
    [signupStep, setSignupStep] = useState(0);
  const intentPlan = safeIntent("plan");
  const showCourse = (id: string, lesson = "", tasks = false) => {
    setIntentCourse(id);
    setIntentLesson(lesson);
    setIntentTasks(tasks);
    setTab("courses");
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
  const perform = async (fn: () => Promise<void>) => {
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    if (user && user.role !== "admin")
      setTab(intentPlan ? "vip" : intentCourse ? "courses" : "live");
  }, [user?.id]);
  async function refresh() {
    if (demo) return;
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
    setCourses(c);
    setPlans(p);
    if (user) {
      const me = await api<any[]>("/academy/me");
      setProfile(me[0] || {});
    }
  }
  useEffect(() => {
    if (demo) return;
    api("/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setLoading(false));
    const ended = () => {
      setUser(null);
      setRoom(null);
    };
    window.addEventListener("meet-session-ended", ended);
    return () => window.removeEventListener("meet-session-ended", ended);
  }, []);
  useEffect(() => {
    void perform(refresh);
  }, [user]);
  useEffect(() => {
    if (!user || demo) return;
    const code = /^\/([a-z0-9]{6})\/?$/.exec(location.pathname)?.[1],
      id = new URLSearchParams(location.search).get("room");
    if (code || id)
      void perform(async () =>
        setRoom(await api(code ? `/rooms/${code}` : `/meetings/${id}`)),
      );
  }, [user]);
  useEffect(() => {
    if (!user || demo || !["live", "reports"].includes(tab)) return;
    const load = () =>
      void perform(async () => {
        const [c, m] = await Promise.all([
          api<any[]>("/catalog"),
          api<any[]>("/meetings"),
        ]);
        setClassrooms(c);
        setMeetings(m);
      });
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [user, tab]);
  const vip = profile.expires_at && Date.parse(profile.expires_at) > Date.now();
  if (loading)
    return <main className="academy-loading">Đang mở cổng học tập…</main>;
  if (room && user && demo)
    return (
      <PreviewRoom
        role={user.role}
        title={room.title}
        onExit={() => setRoom(null)}
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
          history.replaceState(null, "", "/hoc");
          setRoom(null);
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
                setAuthTab("login");
                setChallenge("");
              }}
            >
              Đăng nhập
            </button>
            <button onClick={() => setAuthTab("register")}>
              Đăng ký học thử
            </button>
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          {authTab === "register" && (
            <p className="academy-signup-steps" role="status">
              {signupStep === 0
                ? "Bước 1/2 · Tài khoản"
                : "Bước 2/2 · Hồ sơ và xác thực email"}
            </p>
          )}
          {(intentCourse || intentPlan) && (
            <p className="academy-intent-notice">
              Đăng nhập hoặc tạo tài khoản để tiếp tục{" "}
              {intentCourse ? "khóa học đã chọn" : "gói học đã chọn"}. Thông tin
              lựa chọn được giữ trong quá trình đăng ký.
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (authTab === "register" && signupStep === 0) {
                setSignupStep(1);
                return;
              }
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
                    code: v.code,
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
                  setSignupStep(0);
                  setNotice("Đăng ký thành công. Anh/chị có thể đăng nhập.");
                }
              });
            }}
          >
            {!challenge && (
              <div hidden={authTab === "register" && signupStep === 1}>
                <label>
                  Email
                  <input
                    name="email"
                    type="email"
                    required={authTab !== "register" || signupStep === 0}
                    autoComplete="email"
                  />
                </label>
                <label>
                  Mật khẩu
                  <input
                    name="password"
                    type="password"
                    minLength={6}
                    required={authTab !== "register" || signupStep === 0}
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
              <div hidden={signupStep === 0}>
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
                      <input
                        name={key}
                        type={type}
                        required={signupStep === 1}
                      />
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    const f = e.currentTarget.form!;
                    void perform(async () => {
                      await api("/academy/email-code", {
                        email: (
                          f.elements.namedItem("email") as HTMLInputElement
                        ).value,
                      });
                      setNotice("Đã gửi mã email. Mã có hiệu lực 10 phút.");
                    });
                  }}
                >
                  Gửi mã xác thực email
                </button>
                <label>
                  Mã xác thực email
                  <input
                    name="code"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    required={signupStep === 1}
                  />
                </label>
                <label className="academy-check">
                  <input type="checkbox" name="marketing_consent" />
                  Tôi muốn nhận lịch khai giảng và ưu đãi.
                </label>
                <small>
                  Thêm ảnh đại diện trong hồ sơ sau khi đăng nhập. Email OTP xác
                  thực email; số điện thoại chưa được xác thực qua SMS/Zalo.
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
            {authTab === "register" && signupStep === 1 && (
              <button
                type="button"
                className="secondary"
                onClick={() => setSignupStep(0)}
              >
                ← Quay lại tài khoản
              </button>
            )}
            <button className="academy-primary">
              {authTab === "register"
                ? signupStep === 0
                  ? "Tiếp tục"
                  : "Tạo tài khoản"
                : "Đăng nhập"}
            </button>
          </form>
        </main>
      </AcademyAuthFrame>
    );
  const admin = user.role === "admin",
    staff = user.role !== "student";
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
          {[
            ...(admin
              ? [
                  ["courses", "Khóa học"],
                  ["live", "Lớp học trực tiếp"],
                ]
              : [
                  ["live", "Lớp học"],
                  ["courses", "Kho bài giảng"],
                ]),
            ["reports", "Điểm danh & bản ghi"],
            ...(!staff ? [["vip", "Gói học & thanh toán"]] : []),
            ["profile", staff ? "Tài khoản của bạn" : "Hồ sơ học viên"],
            ...(admin
              ? [
                  ["manage", "Quản lý nội dung"],
                  ["academic", "Lớp & giáo viên"],
                  ["accounts", "Tài khoản & phân quyền"],
                  ["orders", "Duyệt thanh toán"],
                  ["students", "Học viên"],
                  ["finance", "Thu chi"],
                  ["settings", "Email & thanh toán"],
                ]
              : []),
          ].map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => {
                setTab(id);
                setMenuOpen(false);
              }}
            >
              <AcademyIcon name={id} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <button
          className="academy-logout"
          onClick={() =>
            void perform(async () => {
              if (!demo) await api("/logout", {});
              setUser(null);
            })
          }
        >
          <AcademyIcon name="logout" />
          Đăng xuất
        </button>
      </aside>
      <main>
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
                      ? "Nội dung và khóa học"
                      : tab === "finance"
                        ? "Thu chi trung tâm"
                        : tab === "students"
                          ? "Học viên"
                          : tab === "live"
                            ? admin
                              ? "Lớp học trực tiếp"
                              : "Lớp học của tôi"
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
        {!admin && tab === "live" && (
          <AcademyToday
            demo={demo}
            role={user.role}
            onMeeting={(m: any) =>
              demo
                ? setRoom(m)
                : void perform(async () =>
                    setRoom(await api(`/meetings/${m.id}`)),
                  )
            }
            onCourse={showCourse}
          />
        )}
        {tab === "courses" && (
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
                      ? new Date(profile.expires_at).toLocaleDateString("vi-VN")
                      : "Chưa đăng ký"}
                </strong>
              </article>
            </div>
            <div className="academy-course-grid">
              {courses.map((c) => (
                <CourseCard
                  key={c.id}
                  course={c}
                  demo={demo}
                  staff={staff}
                  perform={perform}
                  onNotice={setNotice}
                  focus={intentCourse === c.id}
                  focusLesson={intentCourse === c.id ? intentLesson : ""}
                  focusTasks={intentCourse === c.id && intentTasks}
                />
              ))}
            </div>
            {!courses.length && (
              <p>Trung tâm đang chuẩn bị khóa học đầu tiên.</p>
            )}
          </>
        )}
        {["live", "reports"].includes(tab) && (
          <LearningWorkspace
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
            canVideo={true}
            onRefresh={async () => {
              if (demo) return;
              setClassrooms(await api("/catalog"));
              setMeetings(await api("/meetings"));
            }}
            onOpen={(m) =>
              demo
                ? setRoom(m)
                : void perform(async () =>
                    setRoom(await api(`/meetings/${m.id}`)),
                  )
            }
          />
        )}
        {tab === "vip" && (
          <VipPanel
            intentPlan={intentPlan}
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
        {admin && tab === "manage" && (
          <ManagePanel
            demo={demo}
            courses={courses}
            perform={perform}
            refresh={refresh}
            notice={setNotice}
          />
        )}
        {admin && tab === "settings" && <AcademySettings demo={demo} />}
        {admin && tab === "academic" && (
          <AcademicAdmin demo={demo} onChange={refresh} />
        )}
        {admin && tab === "accounts" && <Accounts demo={demo} />}
        {admin && ["orders", "students", "finance"].includes(tab) && (
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
  focus = false,
  focusLesson = "",
  focusTasks = false,
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
        <span>◈</span>
        <small>KHÓA HỌC</small>
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
            onClick={() => void perform(load)}
          >
            {open ? "Thu gọn" : "Xem bài học"}
          </button>
          <button onClick={() => setTasks(!tasks)}>Bài tập</button>
          {course.academic_course_id && (
            <button
              onClick={() =>
                void perform(async () => {
                  if (!demo)
                    await api(`/academy/courses/${course.id}/enroll`, {});
                  onNotice("Đã đăng ký lớp. Xem mục Lớp học trực tiếp.");
                })
              }
            >
              Đăng ký lớp Live
            </button>
          )}
        </div>
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
                  {lessons.map((l) => (
                    <tr
                      key={l.id}
                      className={
                        l.id === focusLesson ? "academy-selected-lesson" : ""
                      }
                    >
                      <td>
                        {l.title}
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
                        <button onClick={() => void perform(() => play(l))}>
                          Xem
                        </button>
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
          />
        )}
      </div>
    </article>
  );
}
function VipPanel({ demo, plans, perform, notice, intentPlan = "" }: any) {
  const [order, setOrder] = useState<any>(null),
    [history, setHistory] = useState<any[]>([]);
  useEffect(() => {
    if (!demo)
      void api<any[]>("/academy/orders")
        .then(setHistory)
        .catch(() => {});
  }, []);
  return (
    <>
      <div className="academy-course-grid">
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
              {p.days} ngày · {p.live_enabled ? "Có lớp Live" : "Video xem lại"}
            </p>
            <ul>
              <li>Xem bài giảng trong danh mục trung tâm</li>
              <li>Theo dõi tiến độ và làm bài tập</li>
            </ul>
            <button
              className="academy-primary"
              onClick={() =>
                void perform(async () => {
                  if (demo) {
                    notice("Đơn hàng mô phỏng; không có thanh toán thật.");
                    setOrder({
                      id: "demo-order",
                      amount: p.price_vnd,
                      description: "NAPVIP DEMO",
                    });
                    return;
                  }
                  setOrder(await api("/academy/orders", { plan_id: p.id }));
                  setHistory(await api("/academy/orders"));
                })
              }
            >
              Chọn gói
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
          {order.qr_url && (
            <img
              className="academy-qr"
              src={order.qr_url}
              alt="QR chuyển khoản"
            />
          )}
          {order.checkout_url && (
            <a href={order.checkout_url} target="_blank" rel="noopener">
              Mở trang thanh toán
            </a>
          )}
          <p>
            Ảnh biên lai đưa đơn vào hàng chờ duyệt, không tự kích hoạt VIP.
          </p>
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
        </section>
      )}
      <DataTable
        rows={history}
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
      <h2>Hồ sơ học viên</h2>
      <p>Email: {profile.email || user.email || "—"}</p>
      {!profile.email_verified && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const code = new FormData(e.currentTarget).get("code");
            void perform(async () => {
              if (!demo) {
                await api("/academy/profile/verify-email", { code });
                await refresh();
              }
              notice("Đã xác thực email.");
            });
          }}
        >
          <p>Lưu hồ sơ bên dưới rồi xác thực email trước khi mua gói học.</p>
          <button
            type="button"
            onClick={() =>
              void perform(async () => {
                if (!demo)
                  await api("/academy/email-code", {
                    email: profile.email || user.email,
                  });
                notice(
                  demo
                    ? "Mã xác thực minh họa."
                    : "Đã gửi mã xác thực qua email.",
                );
              })
            }
          >
            Gửi mã email
          </button>
          <label>
            Mã xác thực
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
            />
          </label>
          <button>Xác thực email</button>
        </form>
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
        ].map(([key, label, type]) => (
          <label key={key}>
            {label}
            <input
              name={key}
              type={type}
              defaultValue={String(profile[key] || "").slice(
                0,
                type === "date" ? 10 : 500,
              )}
              required
            />
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
                <td key={key}>{row[key] == null ? "—" : String(row[key])}</td>
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
            <input name="paid_on" type="date" required />
          </label>
          <button>Lưu khoản chi</button>
        </form>
      )}
      <DataTable
        rows={rows}
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
function ManagePanel({ demo, courses, perform, refresh, notice }: any) {
  return (
    <div className="academy-admin-grid">
      <AcademyCourseEditor
        demo={demo}
        courses={courses}
        perform={perform}
        refresh={refresh}
        notice={notice}
      />
      <section className="academy-section">
        <h2>Tạo gói VIP</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v: any = Object.fromEntries(new FormData(e.currentTarget));
            void perform(async () => {
              if (!demo)
                await api("/academy/plans", {
                  name: v.name,
                  price_vnd: Number(v.price_vnd),
                  days: Number(v.days),
                  live_enabled: v.live_enabled === "on",
                  active: true,
                });
              await refresh();
              notice(demo ? "Gói giá minh họa." : "Đã lưu gói giá.");
            });
          }}
        >
          <label>
            Tên gói
            <input name="name" required />
          </label>
          <label>
            Giá VND
            <input name="price_vnd" type="number" min="1000" required />
          </label>
          <label>
            Số ngày
            <input
              name="days"
              type="number"
              min="1"
              defaultValue="30"
              required
            />
          </label>
          <label className="academy-check">
            <input name="live_enabled" type="checkbox" />
            Có quyền học Live
          </label>
          <button>Lưu gói</button>
        </form>
      </section>
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
      <AcademySiteEditor
        demo={demo}
        courses={courses}
        perform={perform}
        notice={notice}
      />
    </div>
  );
}
function Assignments({ course, demo, staff, perform }: any) {
  const [rows, setRows] = useState<any[]>([]),
    [submissions, setSubmissions] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [questions, setQuestions] = useState<any[]>([
      { id: "1", prompt: "", options: [], answer: "" },
    ]);
  const load = async () =>
    setRows(demo ? [] : await api(`/academy/courses/${course}/assignments`));
  useEffect(() => {
    void perform(load);
  }, [course]);
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
              <input name="due" type="datetime-local" required />
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
        <article key={row.id}>
          <h4>{row.title}</h4>
          <p>
            Hạn: {new Date(row.due_at).toLocaleString("vi-VN")} · Điểm:{" "}
            {row.score ?? "Chưa chấm"}
          </p>
          {row.feedback && <p>{row.feedback}</p>}
          {staff ? (
            <button
              onClick={() =>
                void perform(async () => {
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
