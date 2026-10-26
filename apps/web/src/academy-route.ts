import { useEffect, useState } from "react";
import { allowPageLeave } from "./form-guard";
export const academyPaths: Record<string, string> = {
  live: "/hoc",
  courses: "/hoc/khoa-hoc",
  reports: "/hoc/diem-danh",
  vip: "/hoc/goi-hoc",
  profile: "/hoc/tai-khoan",
  notifications: "/hoc/thong-bao",
  manage: "/quan-tri/noi-dung",
  academic: "/quan-tri/lop-hoc",
  accounts: "/quan-tri/tai-khoan",
  orders: "/quan-tri/thanh-toan",
  students: "/quan-tri/hoc-vien",
  finance: "/quan-tri/thu-chi",
  settings: "/quan-tri/cai-dat",
};
export const subjectTabs: Record<string, string> = {
  stream: "bang-tin",
  classwork: "bai-tap",
  lessons: "buoi-hoc",
  people: "thanh-vien",
  info: "thong-tin",
};
const id = "([a-zA-Z0-9-]{1,36})";
export type AcademyRoute = {
  path: string;
  tab: string;
  classId?: string;
  subjectId?: string;
  subjectTab?: string;
  courseId?: string;
  lessonId?: string;
  assignmentId?: string;
  orderId?: string;
  roomId?: string;
  roomCode?: string;
  auth?: "login" | "register";
  invalid?: boolean;
};
export function safeNext(value: string | null): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  )
    return "/hoc";
  try {
    const u = new URL(value, "https://va.invalid");
    if (
      u.origin !== "https://va.invalid" ||
      !/^(\/hoc(?:\/|$)|\/quan-tri(?:\/|$)|\/[a-z0-9]{6}$)/.test(u.pathname)
    )
      return "/hoc";
    return u.pathname + u.search;
  } catch {
    return "/hoc";
  }
}
export function readAcademyRoute(
  path = location.pathname,
  search = "",
): AcademyRoute {
  const base = { path, tab: "live" };
  let m: RegExpMatchArray | null;
  if (path === "/dang-nhap" || path === "/dang-ky")
    return { ...base, auth: path === "/dang-ky" ? "register" : "login" };
  if ((m = path.match(/^\/([a-z0-9]{6})\/?$/)))
    return { ...base, roomCode: m[1] };
  if ((m = path.match(new RegExp("^/hoc/lop/" + id + "/?$"))))
    return { ...base, classId: m[1] };
  if (
    (m = path.match(
      new RegExp(
        "^/hoc/mon/" +
          id +
          "(?:/(bang-tin|bai-tap|buoi-hoc|thanh-vien|thong-tin))?/?$",
      ),
    ))
  )
    return {
      ...base,
      subjectId: m[1],
      subjectTab:
        Object.keys(subjectTabs).find((k) => subjectTabs[k] === m![2]) ||
        "stream",
    };
  if ((m = path.match(new RegExp("^/hoc/khoa-hoc/" + id + "/?$"))))
    return { ...base, tab: "courses", courseId: m[1] };
  if ((m = path.match(new RegExp("^/hoc/bai-giang/" + id + "/?$"))))
    return { ...base, tab: "courses", lessonId: m[1] };
  if ((m = path.match(new RegExp("^/hoc/bai-tap/" + id + "/?$"))))
    return { ...base, tab: "courses", assignmentId: m[1] };
  if ((m = path.match(new RegExp("^/hoc/thanh-toan/" + id + "/?$"))))
    return { ...base, tab: "vip", orderId: m[1] };
  if ((m = path.match(new RegExp("^/hoc/buoi-hoc/" + id + "/?$"))))
    return { ...base, roomId: m[1] };
  const tab = Object.keys(academyPaths).find(
    (k) => academyPaths[k] === path.replace(/\/$/, ""),
  );
  return tab ? { ...base, tab } : { ...base, invalid: true };
}
export function legacyAcademyPath(path: string, search: string): string | null {
  const q = new URLSearchParams(search),
    valid = (key: string) => {
      const v = q.get(key) || "";
      return /^[a-zA-Z0-9-]{1,36}$/.test(v) ? v : "";
    };
  if (!["/hoc", "/index.html", "/"].includes(path)) return null;
  let target = "";
  if (valid("room")) target = "/hoc/buoi-hoc/" + valid("room");
  else if (valid("plan"))
    target =
      "/hoc/goi-hoc?goi=" +
      valid("plan") +
      (valid("course") ? "&khoa=" + valid("course") : "");
  else if (valid("lesson")) target = "/hoc/bai-giang/" + valid("lesson");
  else if (valid("course")) target = "/hoc/khoa-hoc/" + valid("course");
  if (q.has("register"))
    return "/dang-ky?next=" + encodeURIComponent(target || "/hoc");
  if (target) return target;
  return null;
}
function demoPath(path: string) {
  const now = new URLSearchParams(location.search),
    url = new URL(path, location.origin);
  if (now.has("academy_demo")) {
    url.searchParams.set("academy_demo", "1");
    if (now.has("role")) url.searchParams.set("role", now.get("role")!);
  }
  return url.pathname + url.search;
}
let index = 0,
  installed = false,
  reverting = false;
function initialize() {
  if (installed) return;
  installed = true;
  index = Number(history.state?.academyIndex) || 0;
  history.replaceState(
    { ...history.state, academyIndex: index },
    "",
    location.href,
  );
  window.addEventListener("popstate", (e) => {
    const next = Number(e.state?.academyIndex) || 0;
    if (reverting) {
      reverting = false;
      return;
    }
    if (!allowPageLeave()) {
      reverting = true;
      history.go(index - next || 1);
      return;
    }
    index = next;
    window.dispatchEvent(new Event("academy:navigate"));
  });
}
export function goAcademy(path: string, replace = false) {
  initialize();
  const target = demoPath(path);
  if (target === location.pathname + location.search) return true;
  if (!replace && !allowPageLeave()) return false;
  if (replace)
    history.replaceState({ ...history.state, academyIndex: index }, "", target);
  else {
    index++;
    history.pushState({ academyIndex: index }, "", target);
  }
  window.dispatchEvent(new Event("academy:navigate"));
  return true;
}
export function useAcademyRoute() {
  const [locationKey, setKey] = useState(
    () => location.pathname + location.search,
  );
  useEffect(() => {
    initialize();
    const changed = () => setKey(location.pathname + location.search);
    window.addEventListener("academy:navigate", changed);
    return () => window.removeEventListener("academy:navigate", changed);
  }, []);
  return readAcademyRoute(
    locationKey.split("?")[0],
    locationKey.includes("?")
      ? "?" + locationKey.split("?").slice(1).join("?")
      : "",
  );
}
export function subjectPath(id: string, tab = "stream") {
  return (
    "/hoc/mon/" +
    encodeURIComponent(id) +
    "/" +
    (subjectTabs[tab] || "bang-tin")
  );
}

export const academyHref = (path: string) => demoPath(path);
export function academyClick(
  e: {
    button: number;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    preventDefault: () => void;
  },
  path: string,
) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
    return;
  e.preventDefault();
  goAcademy(path);
}

export function reportQuery(
  changes: Record<string, string | null>,
  replace = false,
) {
  const q = new URLSearchParams(location.search);
  for (const [key, value] of Object.entries(changes)) {
    if (value == null || value === "") q.delete(key);
    else q.set(key, value);
  }
  return goAcademy(
    location.pathname + (q.size ? "?" + q.toString() : ""),
    replace,
  );
}
