import { useEffect, useState, useRef } from "react";
import { api } from "./api";
type Poll = {
  id: string;
  question: string;
  options: string[];
  active: boolean;
  counts: number[];
  my_choice: number;
};
export function RoomPolls({
  meeting,
  canManage,
  joined,
  demo = false,
}: {
  meeting: string;
  canManage: boolean;
  joined: boolean;
  demo?: boolean;
}) {
  const [polls, setPolls] = useState<Poll[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false),
    active = useRef(true);
  async function reload() {
    if (demo) return;
    const data = await api<Poll[]>(`/meetings/${meeting}/polls`);
    if (active.current) setPolls(data);
  }
  useEffect(() => {
    active.current = true;
    if (demo) {
      setPolls([
        {
          id: "sample",
          question: "Bạn đã hiểu nội dung hôm nay?",
          options: ["Đã hiểu", "Cần giảng lại"],
          active: true,
          counts: [3, 2],
          my_choice: -1,
        },
      ]);
      return;
    }
    if (!joined && !canManage) return;
    const poll = () => {
      if (!pending.current)
        void reload().catch((e) => {
          if (active.current) setError(e.message);
        });
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => {
      active.current = false;
      clearInterval(timer);
    };
  }, [meeting, joined, canManage, demo]);
  async function act(fn: () => Promise<void>) {
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="room-polls">
      <h3>Khảo sát trong buổi học</h3>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {canManage && (
        <details>
          <summary>Tạo khảo sát</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                values = new FormData(form);
              const question = String(values.get("question") || "").trim(),
                options = String(values.get("options") || "")
                  .split(/\r?\n/)
                  .map((v) => v.trim())
                  .filter(Boolean);
              if (
                !question ||
                options.length < 2 ||
                options.length > 6 ||
                new Set(options.map((v) => v.toLowerCase())).size !==
                  options.length
              ) {
                setError(
                  "Nhập câu hỏi và 2–6 lựa chọn khác nhau, mỗi lựa chọn một dòng",
                );
                return;
              }
              void act(async () => {
                if (demo)
                  setPolls((v) =>
                    [
                      {
                        id: crypto.randomUUID(),
                        question,
                        options,
                        active: true,
                        counts: options.map(() => 0),
                        my_choice: -1,
                      },
                      ...v,
                    ].slice(0, 10),
                  );
                else
                  await api(`/meetings/${meeting}/polls`, {
                    question,
                    options,
                  });
                form.reset();
              });
            }}
          >
            <label>
              Câu hỏi
              <input name="question" required maxLength={200} />
            </label>
            <label>
              Lựa chọn · mỗi dòng một lựa chọn
              <textarea
                name="options"
                rows={4}
                required
                placeholder={"Lựa chọn 1\nLựa chọn 2"}
              />
            </label>
            <button disabled={busy}>Mở khảo sát</button>
          </form>
        </details>
      )}
      {!joined && !canManage ? (
        <p>Tham gia buổi học để trả lời khảo sát.</p>
      ) : polls.length === 0 ? (
        <p>Chưa có khảo sát.</p>
      ) : (
        polls.map((p) => {
          const total = p.counts.reduce((a, b) => a + b, 0);
          return (
            <article className="room-poll" key={p.id}>
              <h4>{p.question}</h4>
              <small>
                {p.active ? "Đang mở" : "Đã đóng"} · {total} phiếu
              </small>
              <div>
                {p.options.map((option, index) => (
                  <button
                    className={p.my_choice === index ? "selected" : "secondary"}
                    key={index}
                    disabled={busy || !joined || canManage || !p.active}
                    aria-pressed={p.my_choice === index}
                    onClick={() =>
                      void act(async () => {
                        if (demo)
                          setPolls((rows) =>
                            rows.map((v) => {
                              if (v.id !== p.id) return v;
                              const counts = [...v.counts];
                              if (v.my_choice >= 0) counts[v.my_choice]--;
                              counts[index]++;
                              return { ...v, counts, my_choice: index };
                            }),
                          );
                        else
                          await api(`/meetings/${meeting}/polls/${p.id}`, {
                            action: "vote",
                            choice: index,
                          });
                      })
                    }
                  >
                    <span>
                      {option}
                      {p.my_choice === index ? " · Bạn đã chọn" : ""}
                    </span>
                    <small>{p.counts[index]} phiếu</small>
                    <progress
                      aria-label={"Kết quả " + option}
                      max={Math.max(total, 1)}
                      value={p.counts[index]}
                    />
                  </button>
                ))}
              </div>
              {canManage && p.active && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      if (demo)
                        setPolls((v) =>
                          v.map((x) =>
                            x.id === p.id ? { ...x, active: false } : x,
                          ),
                        );
                      else
                        await api(`/meetings/${meeting}/polls/${p.id}`, {
                          action: "close",
                        });
                    })
                  }
                >
                  Đóng khảo sát
                </button>
              )}
            </article>
          );
        })
      )}
    </div>
  );
}
