import { useEffect, useState, useRef } from "react";
import { api } from "./api";
export type RoomRules = {
  lobby: boolean;
  chat_enabled: boolean;
  present_enabled: boolean;
  revision: number;
};
export function RoomModeration({
  meeting,
  demo = false,
  onWaitingChange,
}: {
  meeting: string;
  demo?: boolean;
  onWaitingChange?: (count: number) => void;
}) {
  const [rules, setRules] = useState<RoomRules>({
      lobby: false,
      chat_enabled: true,
      present_enabled: true,
      revision: 0,
    }),
    [members, setMembers] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false),
    generation = useRef(0),
    panel = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    onWaitingChange?.(members.filter((m) => m.state === "waiting").length);
  }, [members, onWaitingChange]);
  async function reload() {
    const revision = generation.current;
    const [s, list] = await Promise.all([
      api<{ rules: RoomRules }>(`/meetings/${meeting}`),
      api<any[]>(`/meetings/${meeting}/members`),
    ]);
    if (revision !== generation.current) return;
    if (s.rules) setRules(s.rules);
    setMembers(list);
  }
  useEffect(() => {
    if (demo) {
      setMembers([
        {
          id: "preview-waiting",
          short_id: "SV0003",
          name: "Trần Gia Hân",
          role: "student",
          state: "waiting",
        },
        {
          id: "preview-admitted",
          short_id: "SV0001",
          name: "Nguyễn Hoàng An",
          role: "student",
          state: "admitted",
        },
      ]);
      return;
    }
    let active = true;
    const poll = () => {
      if (active && !pending.current)
        void reload().catch((e) => {
          if (active) setError(e.message);
        });
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [meeting, demo]);
  async function act(action: string, id: string) {
    pending.current = true;
    generation.current++;
    setBusy(true);
    setError("");
    try {
      if (demo) {
        setMembers((rows) =>
          rows.map((m) =>
            m.id === id
              ? {
                  ...m,
                  state:
                    action === "admit"
                      ? "admitted"
                      : action === "deny"
                        ? "denied"
                        : action === "remove"
                          ? "removed"
                          : m.state,
                }
              : m,
          ),
        );
        return;
      }
      await api(`/meetings/${meeting}/moderate`, { action, user_id: id });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const waiting = members.filter((m) => m.state === "waiting"),
    limited = members.filter(
      (m) => m.state === "denied" || m.state === "removed",
    );
  useEffect(() => {
    if (waiting.length && panel.current) panel.current.open = true;
  }, [waiting.length]);
  return (
    <details className="room-moderation" ref={panel}>
      <summary>Điều hành phòng · {waiting.length} đang chờ</summary>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="room-controls">
        {[
          ["lobby", "Duyệt học sinh trước khi vào"],
          ["chat_enabled", "Cho học sinh gửi tin nhắn"],
          ["present_enabled", "Cho học sinh trình bày"],
        ].map(([key, label]) => (
          <label className="checkbox" key={key}>
            <input
              type="checkbox"
              disabled={busy}
              checked={Boolean(rules[key as keyof RoomRules])}
              onChange={(e) => {
                if (demo) {
                  setRules((v) => ({
                    ...v,
                    [key]: e.target.checked,
                    revision: v.revision + 1,
                  }));
                  return;
                }
                const next = { ...rules, [key]: e.target.checked };
                setRules(next);
                pending.current = true;
                generation.current++;
                setBusy(true);
                setError("");
                void api(`/meetings/${meeting}/controls`, next)
                  .then(reload)
                  .catch((e) => {
                    setError(e.message);
                    setRules(rules);
                    void reload().catch(() => {});
                  })
                  .finally(() => {
                    pending.current = false;
                    setBusy(false);
                  });
              }}
            />
            {label}
          </label>
        ))}
      </div>
      <div className="member-actions">
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void act("request_mute_all", "")}
        >
          Yêu cầu tất cả tắt mic
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void act("lower_hands_all", "")}
        >
          Hạ tất cả tay
        </button>
      </div>
      {waiting.map((m) => (
        <article key={m.id}>
          <strong>{m.name}</strong>
          <small>{m.short_id} · Xin vào lớp</small>
          <div className="member-actions">
            <button disabled={busy} onClick={() => void act("admit", m.id)}>
              Cho vào
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void act("deny", m.id)}
            >
              Từ chối
            </button>
          </div>
        </article>
      ))}
      <details>
        <summary>Quản lý học sinh đã duyệt</summary>
        {members
          .filter((m) => m.state === "admitted" && m.role === "student")
          .map((m) => (
            <article key={m.id}>
              <strong>{m.name}</strong>
              <div className="member-actions">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void act("request_mute", m.id)}
                >
                  Yêu cầu tắt mic
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Mời ${m.name} ra khỏi buổi học?`))
                      void act("remove", m.id);
                  }}
                >
                  Mời ra
                </button>
              </div>
            </article>
          ))}
      </details>
      {limited.length > 0 && (
        <details>
          <summary>Đã từ chối / mời ra ({limited.length})</summary>
          {limited.map((m) => (
            <article key={m.id}>
              <strong>{m.name}</strong>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void act("admit", m.id)}
              >
                Cho phép vào lại
              </button>
            </article>
          ))}
        </details>
      )}
      <p>
        Yêu cầu tắt mic áp dụng trên ứng dụng; học sinh có thể bật lại. Không có
        thao tác tự bật mic/camera của người khác.
      </p>
    </details>
  );
}
