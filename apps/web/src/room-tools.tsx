import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import "./room-tools.css";
import { RoomModeration } from "./room-moderation";
import { RoomPolls } from "./room-polls";
import type { MeetingPanel } from './meeting-controls';
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
  panelTab, onPanelTabChange, handRaised, onHandChange, onStats,
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
  panelTab?: MeetingPanel;
  onPanelTabChange?: (tab:MeetingPanel)=>void;
  handRaised?: boolean;
  onHandChange?: (raised:boolean)=>void;
  onStats?: (stats:{people:number;unread:number})=>void;
}) {
  const [tab, setTab] = useState("people"),
    [people, setPeople] = useState<any[]>([]),
    [messages, setMessages] = useState<any[]>([]),
    [text, setText] = useState(""),
    [raised, setRaised] = useState(false),
    [error, setError] = useState(""),
    [sending, setSending] = useState(false);
  const cursor = useRef(0), initialized = useRef(false);
  const [unread,setUnread]=useState(0),[search,setSearch]=useState('');
  const chatVisible=useRef(false);chatVisible.current=open&&tab==='chat';
  useEffect(()=>{if(panelTab)setTab(panelTab);},[panelTab]);
  useEffect(()=>{if(handRaised!==undefined){setRaised(handRaised);if(demo)setPeople(rows=>rows.map(p=>p.id===user.id?{...p,hand_raised:handRaised}:p));}},[handRaised]);
  useEffect(()=>{if(open&&tab==='chat')setUnread(0);},[open,tab]);
  useEffect(()=>{onStats?.({people:people.length,unread});},[people.length,unread]);
  const choose=(next:MeetingPanel)=>{setTab(next);onPanelTabChange?.(next);};
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
          id: "preview-peer",
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
        const hand=!!p.find((v) => v.id === user.id)?.hand_raised;
        setRaised(hand);onHandChange?.(hand);
        if (m.length) {
          if(initialized.current&&!chatVisible.current)setUnread(v=>v+m.filter(row=>row.user_id!==user.id).length);
          cursor.current = Number(m[m.length - 1].id);
          setMessages((v) => [...v, ...m].slice(-500));
        }
        initialized.current=true;
        setError("");
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        busy = false;
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 5000);
    const changed=(e:Event)=>{if((e as CustomEvent).detail===meeting)void tick();};
    window.addEventListener('meeting:refresh',changed);
    return () => {
      active = false;
      clearInterval(id);
      window.removeEventListener('meeting:refresh',changed);
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
          <strong>{{people:'Người tham gia',chat:'Trò chuyện trong lớp',polls:'Khảo sát',host:'Điều hành phòng'}[tab]||'Công cụ lớp học'}</strong>
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
        <div hidden={tab!=='host'}>
        <RoomModeration
          meeting={meeting}
          demo={demo}
          onWaitingChange={onWaitingChange}
        />
        </div>
      )}
      <div className="room-tool-tabs">
        <button
          className={tab === "polls" ? "selected" : "secondary"}
          onClick={() => choose("polls")}
        >
          Khảo sát
        </button>
        <button
          className={tab === "people" ? "selected" : "secondary"}
          onClick={() => choose("people")}
        >
          Thành viên ({people.length})
        </button>
        <button
          className={tab === "chat" ? "selected" : "secondary"}
          onClick={() => choose("chat")}
        >
          Tin nhắn ({messages.length})
        </button>
        {canManage&&<button className={tab==='host'?'selected':'secondary'} onClick={()=>choose('host')}>Điều hành</button>}
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
              onHandChange?.(!raised);
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
      ) : tab === "host" ? null : tab === "people" ? (
        <><label className="room-people-search">Tìm người tham gia<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Tên hoặc mã học sinh"/></label>
        <div className="room-people">
          {people.filter(p=>(p.name+' '+(p.short_id||'')).toLocaleLowerCase('vi').includes(search.toLocaleLowerCase('vi'))).map((p) => (
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
        </>
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
                if(!demo)window.dispatchEvent(new CustomEvent('meeting:refresh',{detail:meeting}));
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
