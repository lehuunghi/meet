import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { MeetingModal } from "./meeting-controls";
import "./meeting-breakouts.css";
type Person = {
  id: string;
  name: string;
  role: string;
  room_id: string;
  current_room_id: string;
};
type Group = { id: string; name: string };
export type BreakoutState = {
  round_id: string;
  status: string;
  revision: number;
  rooms: Group[];
  participants: Person[];
  assigned_room_id: string;
  current_room_id: string;
  can_manage: boolean;
};
const empty = (): BreakoutState => ({
  round_id: "",
  status: "",
  revision: 0,
  rooms: [],
  participants: [],
  assigned_room_id: "",
  current_room_id: "",
  can_manage: false,
});
export function MeetingBreakouts(p: {
  parent: string;
  current: string;
  user: { id: string; name: string };
  manage: boolean;
  joined: boolean;
  open: boolean;
  onClose: () => void;
  onMove: (id: string, restore?: boolean) => Promise<void>;
  demo?: boolean;
  resumeMeeting?: string;
}) {
  const [data, setData] = useState<BreakoutState>(() =>
    p.demo
      ? {
          ...empty(),
          can_manage: p.manage,
          participants: [
            {
              id: p.user.id,
              name: p.user.name,
              role: "teacher",
              room_id: "",
              current_room_id: "",
            },
            {
              id: "student-a",
              name: "Nguyễn Hoàng An",
              role: "student",
              room_id: "",
              current_room_id: "",
            },
            {
              id: "student-b",
              name: "Lê Thanh Bình",
              role: "student",
              room_id: "",
              current_room_id: "",
            },
          ],
        }
      : empty(),
  );
  const [count, setCount] = useState(2),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loadError, setLoadError] = useState(""),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [names, setNames] = useState<Record<string, string>>({});
  const current = p.demo ? data.current_room_id || p.current : p.current;
  const writing = useRef(false),
    serial = useRef(0),
    moving = useRef(false),
    latest = useRef(data);
  latest.current = data;
  const reload = useRef(() => {});
  useEffect(() => {
    if (p.demo) return;
    let live = true,
      timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    const poll = async () => {
      const version = serial.current;
      try {
        const r = await api<BreakoutState>(
          `/meetings/${p.parent}/breakouts`,
          undefined,
          "GET",
          AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
        );
        if (
          live &&
          version === serial.current &&
          !writing.current &&
          r &&
          Array.isArray(r.rooms)
        ) {
          setData(r);
          setLoadError("");
        }
      } catch (e) {
        if (live) setLoadError((e as Error).message);
      } finally {
        if (live)
          timer = setTimeout(
            poll,
            latest.current.status === "active" ? 2000 : 5000,
          );
      }
    };
    reload.current = () => {
      clearTimeout(timer);
      void poll();
    };
    void poll();
    return () => {
      live = false;
      abort.abort();
      clearTimeout(timer);
    };
  }, [p.parent, p.demo]);
  const move = async (id: string, restore = false) => {
    if (moving.current) return;
    moving.current = true;
    setBusy(true);
    setError("");
    try {
      if (p.demo) {
        setData((d) => ({
          ...d,
          current_room_id: id === p.parent ? "" : id,
          participants: d.participants.map((v) =>
            v.id === p.user.id
              ? { ...v, current_room_id: id === p.parent ? "" : id }
              : v,
          ),
        }));
        return;
      }
      await p.onMove(id, restore);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      moving.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    if (p.demo) return;
    if (
      p.current !== p.parent &&
      data.round_id &&
      data.current_room_id !== p.current
    )
      void move(data.current_room_id || p.parent);
    else if (
      p.current === p.parent &&
      data.status === "active" &&
      data.current_room_id &&
      (p.joined ||
        p.resumeMeeting === data.current_room_id ||
        p.resumeMeeting === p.parent)
    )
      void move(data.current_room_id, true);
  }, [
    data.current_room_id,
    data.status,
    data.round_id,
    p.current,
    p.joined,
    p.resumeMeeting,
  ]);
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    if (writing.current) return;
    writing.current = true;
    serial.current++;
    setBusy(true);
    setError("");
    try {
      if (p.demo) {
        setData((d) => {
          let n = {
            ...d,
            rooms: d.rooms.map((x) => ({ ...x })),
            participants: d.participants.map((x) => ({ ...x })),
            revision: d.revision + 1,
          };
          const room = String(extra.room_id || "");
          if (action === "create")
            n = {
              ...n,
              round_id: crypto.randomUUID(),
              status: "draft",
              rooms: Array.from({ length: count }, (_, i) => ({
                id: crypto.randomUUID(),
                name: "Nhóm " + (i + 1),
              })),
              participants: n.participants.map((x) => ({
                ...x,
                room_id: "",
                current_room_id: "",
              })),
            };
          if (action === "add")
            n.rooms.push({
              id: crypto.randomUUID(),
              name: "Nhóm " + (n.rooms.length + 1),
            });
          if (action === "rename")
            n.rooms = n.rooms.map((x) =>
              x.id === room ? { ...x, name: String(extra.name) } : x,
            );
          if (action === "delete") {
            n.rooms = n.rooms.filter((x) => x.id !== room);
            n.participants = n.participants.map((x) =>
              x.room_id === room ? { ...x, room_id: "" } : x,
            );
          }
          if (action === "assign")
            n.participants = n.participants.map((x) =>
              (extra.users as string[]).includes(x.id)
                ? { ...x, room_id: room }
                : x,
            );
          if (action === "shuffle") {
            let i = 0;
            n.participants = n.participants.map((x) =>
              x.role === "student"
                ? { ...x, room_id: n.rooms[i++ % n.rooms.length].id }
                : x,
            );
          }
          if (action === "start") n.status = "active";
          if (action === "close") {
            n.status = "closed";
            n.current_room_id = "";
            n.participants = n.participants.map((x) => ({
              ...x,
              current_room_id: "",
            }));
          }
          return n;
        });
      } else {
        const r = await api<BreakoutState>(`/meetings/${p.parent}/breakouts`, {
          action,
          revision: data.revision,
          count,
          ...extra,
        });
        setData(r);
      }
      setSelected([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      serial.current++;
      writing.current = false;
      setBusy(false);
    }
  };
  const mark = (id: string) =>
    setSelected((a) =>
      a.includes(id) ? a.filter((x) => x !== id) : [...a, id],
    );
  const person = (v: Person) => (
    <label
      className={
        "breakout-person " + (selected.includes(v.id) ? "is-selected" : "")
      }
      key={v.id}
      draggable={data.status === "draft" && !busy}
      onDragStart={(e) => {
        const ids = selected.includes(v.id) ? selected : [v.id];
        e.dataTransfer.setData(
          "application/x-meet-members",
          JSON.stringify(ids),
        );
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <input
        type="checkbox"
        checked={selected.includes(v.id)}
        disabled={busy || data.status !== "draft"}
        onChange={() => mark(v.id)}
      />
      <span className="breakout-avatar">{v.name[0]}</span>
      <span>
        {v.name}
        {v.id === p.user.id ? " (Bạn)" : ""}
      </span>
    </label>
  );
  const assign = (room: string, users = selected) =>
    void act("assign", { room_id: room, users });
  const banner =
    current !== p.parent || (data.status === "active" && data.assigned_room_id);
  return (
    <>
      {error && !p.open && (
        <div className="breakout-error" role="alert">
          {error}
          <button disabled={busy} onClick={() => reload.current()}>
            Kiểm tra lại
          </button>
        </div>
      )}
      {banner && (
        <div className="breakout-banner" role="status">
          <span>
            {current !== p.parent
              ? "Bạn đang ở phòng thảo luận nhóm"
              : `Bạn được mời vào ${data.rooms.find((v) => v.id === data.assigned_room_id)?.name || "phòng nhóm"}`}
          </span>
          <button
            disabled={busy || !p.joined}
            onClick={() =>
              void move(current !== p.parent ? p.parent : data.assigned_room_id)
            }
          >
            {current !== p.parent ? "Về phòng chính" : "Vào nhóm"}
          </button>
        </div>
      )}
      {p.open && (
        <MeetingModal
          title="Phòng họp nhóm"
          onClose={() => {
            if (!busy) p.onClose();
          }}
        >
          <div className="breakout-panel">
            {(error || loadError) && (
              <p className="breakout-error" role="alert">
                {error || loadError}
                <button disabled={busy} onClick={() => reload.current()}>
                  Tải lại
                </button>
              </p>
            )}
            {!p.joined && <p>Vào lớp trước khi bắt đầu hoặc tham gia nhóm.</p>}
            {p.manage && (!data.round_id || data.status === "closed") ? (
              <div className="breakout-create">
                <h3>Tạo phòng thảo luận</h3>
                <label>
                  Số phòng nhóm
                  <div className="breakout-stepper">
                    <button
                      aria-label="Giảm số nhóm"
                      disabled={busy || count <= 2}
                      onClick={() => setCount((n) => n - 1)}
                    >
                      −
                    </button>
                    <input
                      aria-label="Số phòng nhóm"
                      type="number"
                      min="2"
                      max="20"
                      value={count}
                      onChange={(e) =>
                        setCount(
                          Math.max(
                            2,
                            Math.min(20, Number(e.target.value) || 2),
                          ),
                        )
                      }
                    />
                    <button
                      aria-label="Tăng số nhóm"
                      disabled={busy || count >= 20}
                      onClick={() => setCount((n) => n + 1)}
                    >
                      +
                    </button>
                  </div>
                </label>
                <p>
                  Có {data.participants.length} người trong lớp. Sau khi tạo có
                  thể phân nhóm thủ công hoặc chia đều học sinh.
                </p>
                <button
                  className="breakout-primary"
                  disabled={busy || !p.joined}
                  onClick={() => void act("create")}
                >
                  Tạo phòng nhóm
                </button>
              </div>
            ) : (
              <>
                <div className="breakout-top">
                  <input
                    type="search"
                    aria-label="Tìm người tham gia nhóm"
                    placeholder="Tìm thành viên…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {p.manage && data.status === "draft" && (
                    <>
                      <button
                        disabled={busy || data.rooms.length < 2}
                        onClick={() => void act("shuffle")}
                      >
                        Chia đều ngẫu nhiên
                      </button>
                      <button
                        disabled={busy || data.rooms.length >= 20}
                        onClick={() => void act("add")}
                      >
                        + Thêm nhóm
                      </button>
                    </>
                  )}
                </div>
                <div
                  className={
                    "breakout-columns " + (!p.manage ? "breakout-student" : "")
                  }
                >
                  {p.manage && (
                    <section className="breakout-main">
                      <h3>
                        Phòng chính (
                        {data.participants.filter((v) => !v.room_id).length})
                      </h3>
                      {data.participants
                        .filter(
                          (v) =>
                            !v.room_id &&
                            v.name
                              .toLocaleLowerCase("vi")
                              .includes(search.toLocaleLowerCase("vi")),
                        )
                        .map(person)}
                      {selected.length > 0 && data.status === "draft" && (
                        <button disabled={busy} onClick={() => assign("")}>
                          Đưa {selected.length} người về phòng chính
                        </button>
                      )}
                      <small>
                        Chọn nhiều người rồi bấm phân nhóm, hoặc kéo thả bằng
                        chuột.
                      </small>
                    </section>
                  )}
                  <section
                    className="breakout-rooms"
                    aria-label="Danh sách phòng nhóm"
                  >
                    {data.rooms.map((room) => (
                      <article
                        className="breakout-room"
                        key={room.id}
                        onDragOver={(e) => {
                          if (data.status === "draft") e.preventDefault();
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (data.status !== "draft" || busy) return;
                          try {
                            const ids = JSON.parse(
                              e.dataTransfer.getData(
                                "application/x-meet-members",
                              ),
                            );
                            if (
                              Array.isArray(ids) &&
                              ids.every((x) => typeof x === "string")
                            )
                              assign(room.id, ids);
                          } catch {
                            setError(
                              "Không đọc được thành viên đã kéo. Dùng ô chọn để phân nhóm.",
                            );
                          }
                        }}
                      >
                        <header>
                          {p.manage && data.status === "draft" ? (
                            <>
                              <input
                                aria-label={"Tên " + room.name}
                                maxLength={80}
                                value={names[room.id] ?? room.name}
                                onChange={(e) =>
                                  setNames((d) => ({
                                    ...d,
                                    [room.id]: e.target.value,
                                  }))
                                }
                              />
                              <button
                                disabled={
                                  busy || !(names[room.id] ?? room.name).trim()
                                }
                                onClick={() =>
                                  void act("rename", {
                                    room_id: room.id,
                                    name: names[room.id] ?? room.name,
                                  })
                                }
                              >
                                Lưu tên
                              </button>
                              <button
                                className="breakout-danger"
                                aria-label={"Xóa " + room.name}
                                disabled={busy}
                                onClick={() => {
                                  if (
                                    confirm(
                                      "Xóa " +
                                        room.name +
                                        "? Thành viên được đưa về danh sách phòng chính.",
                                    )
                                  )
                                    void act("delete", { room_id: room.id });
                                }}
                              >
                                Xóa
                              </button>
                            </>
                          ) : (
                            <h3>{room.name}</h3>
                          )}
                        </header>
                        {p.manage && (
                          <>
                            <p>
                              {
                                data.participants.filter(
                                  (v) => v.room_id === room.id,
                                ).length
                              }{" "}
                              người được phân công
                            </p>
                            {data.participants
                              .filter(
                                (v) =>
                                  v.room_id === room.id &&
                                  v.name
                                    .toLocaleLowerCase("vi")
                                    .includes(search.toLocaleLowerCase("vi")),
                              )
                              .map(person)}
                          </>
                        )}
                        {data.status === "draft" && p.manage && (
                          <button
                            disabled={busy || !selected.length}
                            onClick={() => assign(room.id)}
                          >
                            Phân {selected.length || "người đã chọn"} vào nhóm
                          </button>
                        )}
                        {data.status === "active" &&
                          (p.manage || room.id === data.assigned_room_id) && (
                            <button
                              className="breakout-primary"
                              disabled={
                                busy || !p.joined || current === room.id
                              }
                              onClick={() => void move(room.id)}
                            >
                              {current === room.id ? "Đang ở nhóm" : "Vào nhóm"}
                            </button>
                          )}
                      </article>
                    ))}
                    {!data.rooms.length && <p>Giáo viên chưa mở phòng nhóm.</p>}
                  </section>
                </div>
                {p.manage && (
                  <footer className="breakout-footer">
                    <span>
                      {data.status === "active"
                        ? "Phòng nhóm đang mở. Ghi hình chỉ ghi phòng chính."
                        : `${data.rooms.length} nhóm · ${selected.length} người đang chọn`}
                    </span>
                    {data.status === "draft" ? (
                      <button
                        className="breakout-primary"
                        disabled={busy || !p.joined || data.rooms.length < 2}
                        onClick={() => void act("start")}
                      >
                        Bắt đầu thảo luận nhóm
                      </button>
                    ) : (
                      <button
                        className="breakout-danger"
                        disabled={busy}
                        onClick={() => {
                          if (
                            confirm(
                              "Đóng tất cả nhóm và đưa mọi người về phòng chính?",
                            )
                          )
                            void act("close");
                        }}
                      >
                        Đóng tất cả nhóm
                      </button>
                    )}
                  </footer>
                )}
              </>
            )}
            {p.demo && (
              <small>
                Bản xem trước: phân nhóm chỉ mô phỏng, không có cuộc gọi thật.
              </small>
            )}
          </div>
        </MeetingModal>
      )}
    </>
  );
}
