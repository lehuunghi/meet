import { useEffect, useState } from "react";
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
    <details className="academic-paste">
      <summary>Quy tắc điểm danh của trường</summary>
      <p>
        Đạt khi đủ tỷ lệ thời gian, vào không trễ quá ngưỡng và ra không sớm quá
        ngưỡng. Buổi đang học chưa kết luận. Mặc định buổi dài 60 phút; chọn một
        buổi bên dưới để chỉnh giờ riêng.
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
export function AttendanceEdit({
  row,
  demo,
  onSaved,
}: {
  row: any;
  demo: boolean;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false),
    [message, setMessage] = useState("");
  const local = (s: string) => {
    if (!s) return "";
    const d = new Date(s);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  };
  return (
    <div>
      <button className="secondary" onClick={() => setOpen(!open)}>
        Chỉnh giờ vào / ra
      </button>
      {open && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              if (!demo)
                await api("/attendance/adjust", {
                  meeting_id: row.meeting_id,
                  user_id: row.id,
                  joined_at: new Date(String(f.get("joined"))).toISOString(),
                  left_at: new Date(String(f.get("left"))).toISOString(),
                  reason: f.get("reason"),
                });
              setOpen(false);
              onSaved();
            } catch (e) {
              setMessage((e as Error).message);
            }
          }}
        >
          <label>
            Giờ vào
            <input
              name="joined"
              type="datetime-local"
              defaultValue={local(row.joined_at)}
              required
            />
          </label>
          <label>
            Giờ ra
            <input
              name="left"
              type="datetime-local"
              defaultValue={local(row.last_seen)}
              required
            />
          </label>
          <label>
            Lý do
            <input name="reason" required minLength={3} maxLength={500} />
          </label>
          <button>Lưu điều chỉnh</button>
          <p role="alert">{message}</p>
        </form>
      )}
    </div>
  );
}
export function LessonTiming({
  meeting,
  demo,
  onSaved,
}: {
  meeting: string;
  demo: boolean;
  onSaved: () => void;
}) {
  const [message, setMessage] = useState("");
  return (
    <details className="academic-paste">
      <summary>Chỉnh khoảng thời gian tính điểm danh cho buổi đã chọn</summary>
      <form
        className="inline-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            if (!demo)
              await api("/attendance/timing", {
                meeting_id: meeting,
                starts_at: new Date(String(f.get("start"))).toISOString(),
                ends_at: new Date(String(f.get("end"))).toISOString(),
              });
            setMessage("Đã lưu khoảng buổi học");
            onSaved();
          } catch (e) {
            setMessage((e as Error).message);
          }
        }}
      >
        <label>
          Bắt đầu
          <input name="start" type="datetime-local" required />
        </label>
        <label>
          Kết thúc
          <input name="end" type="datetime-local" required />
        </label>
        <button>Lưu giờ buổi học</button>
      </form>
      <p role="status">{message}</p>
    </details>
  );
}
