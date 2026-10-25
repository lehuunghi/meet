import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import "./room-tools.css";
import { RoomModeration } from "./room-moderation";
import { RoomPolls } from "./room-polls";
export function RoomTools({
  meeting,
  user,
  joined,
  demo = false,
  canManage = false,
  chatEnabled = true,
  onReactions,
  open = true,
  onClose,
  onWaitingChange,
}: {
  meeting: string;
  user: { id: string; name: string };
  joined: boolean;
  demo?: boolean;
  canManage?: boolean;
  chatEnabled?: boolean;
  onReactions?: (events: { id: string; name: string; emoji: string }[]) => void;
  open?: boolean;
  onClose?: () => void;
  onWaitingChange?: (count: number) => void;
}) {
  const [tab, setTab] = useState("people"),
    [people, setPeople] = useState<any[]>([]),
    [messages, setMessages] = useState<any[]>([]),
    [text, setText] = useState(""),
    [raised, setRaised] = useState(false),
    [error, setError] = useState(""),
    [sending, setSending] = useState(false);
  const cursor = useRef(0);
  useEffect(() => {
    if (demo) {
      setPeople([
        {
          id: user.id,
          name: user.name,
          role: canManage ? "teacher" : "student",
          hand_raised: false,
        },
        {
          id: "teacher",
          name: canManage ? "Nguyễn Hoàng An" : "Nguyễn Minh Anh",
          role: canManage ? "student" : "teacher",
          hand_raised: false,
        },
      ]);
      return;
    }
    if (!joined) return;
    let active = true,
      busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const [p, m, reactions] = await Promise.all([
          api<any[]>(`/meetings/${meeting}/participants`),
          api<any[]>(`/meetings/${meeting}/messages?after=${cursor.current}`),
          api<any[]>(`/meetings/${meeting}/reactions`),
        ]);
        if (!active) return;
        setPeople(p);
        onReactions?.(reactions);
        setRaised(!!p.find((v) => v.id === user.id)?.hand_raised);
        if (m.length) {
          cursor.current = Number(m[m.length - 1].id);
          setMessages((v) => [...v, ...m].slice(-500));
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        busy = false;
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [joined, meeting, demo, canManage, user.id, user.name]);
  return (
    <section
      className="section room-tools"
      id="room-tools-panel"
      hidden={!open}
      aria-label="Công cụ lớp học"
    >
      {onClose && (
        <div className="room-panel-heading">
          <strong>Người tham gia & trò chuyện</strong>
          <button
            className="secondary"
            aria-label="Đóng công cụ"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      )}
      {canManage && (
        <RoomModeration
          meeting={meeting}
          demo={demo}
          onWaitingChange={onWaitingChange}
        />
      )}
      <div className="room-tool-tabs">
        <button
          className={tab === "polls" ? "selected" : "secondary"}
          onClick={() => setTab("polls")}
        >
          Khảo sát
        </button>
        <button
          className={tab === "people" ? "selected" : "secondary"}
          onClick={() => setTab("people")}
        >
          Thành viên ({people.length})
        </button>
        <button
          className={tab === "chat" ? "selected" : "secondary"}
          onClick={() => setTab("chat")}
        >
          Tin nhắn ({messages.length})
        </button>
        <button
          className="secondary"
          disabled={!joined || sending}
          aria-pressed={raised}
          onClick={async () => {
            setSending(true);
            setError("");
            try {
              if (!demo)
                await api(`/meetings/${meeting}/hand`, { raised: !raised });
              setRaised(!raised);
              if (demo)
                setPeople((v) =>
                  v.map((p) =>
                    p.id === user.id ? { ...p, hand_raised: !raised } : p,
                  ),
                );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setSending(false);
            }
          }}
        >
          {raised ? "✋ Hạ tay" : "✋ Giơ tay"}
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!joined && <p>Tham gia buổi học để trò chuyện và giơ tay.</p>}
      <div className="room-reaction-buttons" aria-label="Phản ứng">
        {["👍", "👏", "❤️", "😂", "🎉"].map((emoji) => (
          <button
            aria-label={"Phản ứng " + emoji}
            key={emoji}
            disabled={!joined || sending}
            onClick={() => {
              setSending(true);
              setError("");
              void (
                demo
                  ? Promise.resolve(
                      onReactions?.([
                        { id: crypto.randomUUID(), name: user.name, emoji },
                      ]),
                    )
                  : api(`/meetings/${meeting}/reactions`, { emoji })
              )
                .catch((e) => setError(e.message))
                .finally(() => setSending(false));
            }}
          >
            {emoji}
          </button>
        ))}
      </div>
      {tab === "polls" ? (
        <RoomPolls
          meeting={meeting}
          canManage={canManage}
          joined={joined}
          demo={demo}
        />
      ) : tab === "people" ? (
        <div className="room-people">
          {people.map((p) => (
            <div key={p.id}>
              <span className="avatar">{p.name[0]}</span>
              <strong>
                {p.name}
                {p.id === user.id ? " (Bạn)" : ""}
              </strong>
              <small>
                {p.role === "teacher"
                  ? "Giáo viên"
                  : p.role === "admin"
                    ? "Admin"
                    : "Học sinh"}{" "}
                {p.hand_raised ? "· ✋ Đang giơ tay" : ""}
              </small>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div
            className="room-messages"
            role="log"
            aria-label="Tin nhắn trong lớp"
          >
            {messages.length === 0 && <p>Chưa có tin nhắn.</p>}
            {messages.map((m) => (
              <article key={m.id}>
                <strong>{m.name}</strong>
                <small>
                  {new Date(m.created_at).toLocaleTimeString("vi-VN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </small>
                <p>{m.content}</p>
              </article>
            ))}
          </div>
          <form
            className="room-chat-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!text.trim()) return;
              setSending(true);
              setError("");
              try {
                if (demo)
                  setMessages((v) => [
                    ...v,
                    {
                      id: Date.now(),
                      name: user.name,
                      content: text,
                      created_at: new Date().toISOString(),
                    },
                  ]);
                else
                  await api(`/meetings/${meeting}/messages`, { content: text });
                setText("");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setSending(false);
              }
            }}
          >
            <label>
              Tin nhắn
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={2000}
                disabled={!joined || (!chatEnabled && !canManage)}
                placeholder="Gửi đến người trong lớp…"
              />
            </label>
            <button
              disabled={
                !joined ||
                sending ||
                !text.trim() ||
                (!chatEnabled && !canManage)
              }
            >
              Gửi
            </button>
          </form>
          {!chatEnabled && !canManage && <p>Giáo viên đã tắt gửi tin nhắn.</p>}
        </>
      )}
    </section>
  );
}
