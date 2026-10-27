import { vnTime } from "./date-format";
import { useEffect, useState } from "react";
import { VNDateInput } from "./date-input";
import { api } from "./api";
export function AttendancePolicy({ demo }: { demo: boolean }) {
  const [p, setP] = useState({
      late_minutes: 10,
      early_minutes: 10,
      min_percent: 75,
    }),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (!demo)
      api<any[]>("/attendance/policy")
        .then((v) => setP(v[0]))
        .catch((e) => setMessage(e.message));
  }, [demo]);
  return (
    <details className="compact-details school-attendance-policy">
      <summary>Quy tắc điểm danh của trường</summary>
      <p>
        Đạt khi đủ tỷ lệ thời gian, vào không trễ quá ngưỡng và ra không sớm quá
        ngưỡng. Buổi đang học chưa kết luận. Mặc định buổi dài 60 phút; chọn một
        buổi để chỉnh khung giờ chung.
      </p>
      <form
        className="inline-form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            if (!demo) await api("/attendance/policy", p);
            setMessage(demo ? "Đã sửa bản mẫu" : "Đã lưu quy tắc");
          } catch (e) {
            setMessage((e as Error).message);
          }
        }}
      >
        {[
          ["late_minutes", "Cho phép vào muộn (phút)"],
          ["early_minutes", "Cho phép ra sớm (phút)"],
          ["min_percent", "Thời gian tối thiểu (%)"],
        ].map(([k, label]) => (
          <label key={k}>
            {label}
            <input
              type="number"
              min={k === "min_percent" ? 1 : 0}
              max={k === "min_percent" ? 100 : 240}
              value={p[k as keyof typeof p]}
              onChange={(e) => setP({ ...p, [k]: Number(e.target.value) })}
              required
            />
          </label>
        ))}
        <button>Lưu quy tắc</button>
      </form>
      <p role="status">{message}</p>
    </details>
  );
}
export function LessonTiming({
  meeting,
  classId,
  courseId,
  demo,
  start,
  title,
  onSaved,
}: {
  meeting: string;
  classId: string;
  courseId: string;
  demo: boolean;
  start?: string;
  title?: string;
  onSaved: () => void;
}) {
  const [window, setWindow] = useState<any>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setMessage("");
    setWindow(null);
    if (!meeting) return;
    setLoading(true);
    const begin = start || "2026-10-24T01:00:00Z";
    const request = demo
      ? Promise.resolve({
          starts_at: begin,
          ends_at: new Date(new Date(begin).getTime() + 3600000).toISOString(),
          title: title || "Buổi học đã chọn",
        })
      : api(
          "/attendance/timing?" +
            new URLSearchParams({
              meeting_id: meeting,
              class_id: classId,
              course_id: courseId,
            }),
        );
    request
      .then((v) => {
        if (active) setWindow(v);
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [meeting, classId, courseId, demo, start, title]);
  async function save(form: HTMLFormElement) {
    if (busy || !window || !form.reportValidity()) return;
    setBusy(true);
    setMessage("");
    try {
      const f = new FormData(form),
        starts = new Date(String(f.get("start"))).toISOString(),
        ends = new Date(String(f.get("end"))).toISOString();
      if (new Date(ends) <= new Date(starts))
        throw Error("Giờ ra phải sau giờ vào.");
      if (!demo)
        await api("/attendance/timing", {
          meeting_id: meeting,
          class_id: classId,
          course_id: courseId,
          starts_at: starts,
          ends_at: ends,
          expected_starts_at: window.starts_at,
          expected_ends_at: window.ends_at,
        });
      setWindow({ ...window, starts_at: starts, ends_at: ends });
      setMessage(
        demo
          ? "Đã cập nhật khung giờ mẫu cho cả buổi."
          : "Đã áp dụng khung giờ cho toàn bộ buổi học.",
      );
      onSaved();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!meeting)
    return (
      <p className="lesson-timing-hint">
        Chọn một buổi học để thiết lập giờ vào/ra chung cho toàn bộ lớp.
      </p>
    );
  return (
    <details key={meeting} className="lesson-timing compact-details">
      <summary>
        Khung giờ điểm danh chung
        {window
          ? " · " + vnTime(window.starts_at) + " – " + vnTime(window.ends_at)
          : ""}
      </summary>
      <p>
        Áp dụng cho tất cả học sinh của buổi này. Giờ kết nối thực tế của từng
        người được giữ nguyên.
      </p>
      {loading ? (
        <p>Đang tải khung giờ…</p>
      ) : (
        window && (
          <form
            key={meeting + window.starts_at + window.ends_at}
            className="lesson-timing-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save(e.currentTarget);
            }}
          >
            <label>
              Giờ vào chung
              <VNDateInput
                dateTime
                name="start"
                defaultValue={window.starts_at}
                required
                disabled={busy}
              />
            </label>
            <label>
              Giờ ra chung
              <VNDateInput
                dateTime
                name="end"
                defaultValue={window.ends_at}
                required
                disabled={busy}
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={(e) => {
                const form = e.currentTarget.form;
                if (form) void save(form);
              }}
            >
              Áp dụng cho cả buổi
            </button>
          </form>
        )
      )}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
