import { useState } from "react";
import {
  academyClick,
  academyHref,
  goAcademy,
  academyPaths,
  type AcademyRoute,
} from "./academy-route";
export function AcademyBreadcrumbs({ route, courses, classrooms, title }: any) {
  const links: { label: string; path: string }[] = [
    { label: "Không gian học tập", path: "/hoc" },
  ];
  const subject = classrooms.find((c: any) => c.id === route.subjectId),
    cl = classrooms.find(
      (c: any) => c.class_id === (route.classId || subject?.class_id),
    ),
    course = courses.find((c: any) => c.id === route.courseId);
  if (route.classId || route.subjectId) {
    if (cl)
      links.push({
        label: "Lớp " + cl.class_name,
        path: "/hoc/lop/" + cl.class_id,
      });
    if (subject)
      links.push({
        label: subject.name,
        path: "/hoc/mon/" + subject.id + "/bang-tin",
      });
  } else if (route.tab === "courses") {
    links.push({ label: "Kho bài giảng", path: academyPaths.courses });
    if (course)
      links.push({ label: course.title, path: "/hoc/khoa-hoc/" + course.id });
    if (title) links.push({ label: title, path: route.path });
  } else if (route.orderId)
    links.push(
      { label: "Gói học & thanh toán", path: academyPaths.vip },
      { label: "Chi tiết đơn", path: route.path },
    );
  else if (route.path !== "/hoc")
    links.push({
      label:
        (
          {
            reports: "Điểm danh & bản ghi",
            vip: "Gói học",
            profile: "Tài khoản",
            notifications: "Thông báo",
            manage: "Quản lý nội dung",
            website: "Quản trị website",
            academic: "Lớp & giáo viên",
            accounts: "Tài khoản & phân quyền",
            orders: "Duyệt thanh toán",
            students: "Học viên",
            finance: "Thu chi",
            settings: "Cài đặt",
 mail: "Thông báo & email",
          } as Record<string, string>
        )[route.tab] || "Trang đã chọn",
      path: route.path,
    });
  return (
    <nav className="academy-breadcrumbs" aria-label="Đường dẫn trang">
      {links.map((l, i) => (
        <span key={i}>
          {i > 0 && <span aria-hidden="true"> / </span>}
          {i === links.length - 1 ? (
            <span aria-current="page">{l.label}</span>
          ) : (
            <a
              href={academyHref(l.path)}
              onClick={(e) => academyClick(e, l.path)}
            >
              {l.label}
            </a>
          )}
        </span>
      ))}
    </nav>
  );
}
export function AcademyNotificationList({ rows, error, onRead }: any) {
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState("");
  const read = async (ids: string[]) => {
    if (busy) return;
    setBusy(true);
    setFailure("");
    try {
      await onRead(ids);
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="academy-section academy-notifications">
      <div className="section-title">
        <h2>Thông báo của bạn</h2>
        <button
          className="secondary"
          disabled={busy || !rows.some((n: any) => !n.read)}
          onClick={() =>
            void read(rows.filter((n: any) => !n.read).map((n: any) => n.id))
          }
        >
          Đánh dấu tất cả đã đọc
        </button>
      </div>
      {(error || failure) && (
        <p role="alert" className="error">
          {error || failure}
        </p>
      )}
      {rows.map((n: any) => (
        <article key={n.id} className={n.read ? "" : "is-unread"}>
          <div>
            <strong>{n.title}</strong>
            <p>{n.detail}</p>
            <small>{n.read ? "Đã đọc" : "Chưa đọc"}</small>
          </div>
          <a
            href={academyHref(n.path)}
            onClick={(e) => {
              if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
                return;
              e.preventDefault();
              if (goAcademy(n.path)) void read([n.id]);
            }}
          >
            Xem nội dung →
          </a>
        </article>
      ))}
      {!rows.length && !error && (
        <p>
          Chưa có thông báo mới. Lịch học, bài tập, điểm và trạng thái thanh
          toán sẽ xuất hiện tại đây theo quyền tài khoản.
        </p>
      )}
    </section>
  );
}
