import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DrawingToolMenu } from "./drawing-tool-menu";
import { DrawingIcon } from "./drawing-icon";
import { drawingRequest, retryDrawing } from "./drawing-request";
import {
  drawingContext,
  drawingPage,
  emptyDrawing,
  hitStroke,
  paintDrawing,
  type DrawPoint,
  type DrawPage,
  type DrawStroke,
  type DrawingState,
} from "./drawing-model";
import "./meeting-drawing.css";
const drawingTools = [
  ["pointer", "Con trỏ"],
  ["pen", "Bút"],
  ["marker", "Đánh dấu"],
  ["laser", "Mực biến mất"],
  ["note", "Ghi chú cố định"],
  ["stamp", "Hình dán"],
  ["line", "Đường thẳng"],
  ["arrow", "Mũi tên"],
  ["rect", "Hình chữ nhật"],
  ["ellipse", "Hình elip"],
  ["text", "Hộp văn bản"],
  ["erase", "Tẩy"],
];
type Target = { key: string; user_id: string; name: string };
type Envelope = { state?: DrawingState; revision: number; targets: Target[] };
export function requestDrawing(meeting: string, mode: string) {
  window.dispatchEvent(
    new CustomEvent("meeting:drawing", { detail: { meeting, mode } }),
  );
}
function DrawingCanvas({
  page,
  editable,
  tool,
  color,
  width,
  text,
  onStroke,
  onErase,
  onNode,
  overlay = false,
}: {
  page: DrawPage;
  editable: boolean;
  tool: string;
  color: string;
  width: number;
  text: string;
  onStroke: (stroke: DrawStroke) => void;
  onErase: (p: DrawPoint) => void;
  onNode?: (node: HTMLCanvasElement | null) => void;
  overlay?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null),
    gesture = useRef<DrawStroke | null>(null);
  const props = useRef({ onStroke, onErase });
  props.current = { onStroke, onErase };
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    onNode?.(canvas);
    const render = () => {
      const r = canvas.getBoundingClientRect(),
        dpr = Math.min(2, devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      const ctx = canvas.getContext("2d");
      if (ctx) paintDrawing(ctx, page, canvas.width, canvas.height, !overlay);
    };
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    render();
    const fading = page.strokes.some((s) => s.kind === "laser")
      ? setInterval(render, 100)
      : null;
    return () => {
      if (fading) clearInterval(fading);
      observer.disconnect();
      onNode?.(null);
    };
  }, [page, overlay]);
  const point = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x:
        Math.round(
          Math.max(0, Math.min(1600, ((e.clientX - r.left) / r.width) * 1600)) *
            100,
        ) / 100,
      y:
        Math.round(
          Math.max(0, Math.min(900, ((e.clientY - r.top) / r.height) * 900)) *
            100,
        ) / 100,
    };
  };
  const finish = (e: React.PointerEvent) => {
    if (!gesture.current) return;
    const g = gesture.current;
    g.seq++;
    props.current.onStroke({ ...g, points: [...g.points] });
    gesture.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };
  return (
    <canvas
      ref={ref}
      className={"meeting-drawing-canvas" + (overlay ? " is-overlay" : "")}
      aria-label={
        overlay ? "Chú thích trên màn hình chia sẻ" : "Bảng trắng dùng chung"
      }
      style={{
        touchAction: editable && tool !== "pointer" ? "none" : "auto",
        pointerEvents:
          overlay && (!editable || tool === "pointer") ? "none" : "auto",
        cursor: editable && tool !== "pointer" ? "crosshair" : "default",
      }}
      onPointerDown={(e) => {
        if (!editable || tool === "pointer" || !e.isPrimary || e.button !== 0)
          return;
        e.preventDefault();
        const p = point(e);
        if (tool === "erase") {
          props.current.onErase(p);
          return;
        }
        if ((tool === "text" || tool === "note") && !text.trim()) return;
        const g: DrawStroke = {
          id: crypto.randomUUID(),
          owner: "",
          kind: tool,
          color,
          width,
          points: [p],
          text: ["text", "note", "stamp"].includes(tool) ? text : "",
          expires_at: tool === "laser" ? Date.now() + 5000 : undefined,
          seq: 1,
        };
        if (["text", "note", "stamp"].includes(tool)) {
          props.current.onStroke(g);
          return;
        }
        gesture.current = g;
        e.currentTarget.setPointerCapture(e.pointerId);
        props.current.onStroke({ ...g, points: [...g.points] });
      }}
      onPointerMove={(e) => {
        const g = gesture.current;
        if (!g || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const p = point(e);
        if (g.kind === "pen" || g.kind === "marker" || g.kind === "laser") {
          if (
            g.points.length >= 1000 ||
            Math.hypot(p.x - g.points.at(-1)!.x, p.y - g.points.at(-1)!.y) < 2
          )
            return;
          g.points.push(p);
        } else g.points = [g.points[0], p];
        g.seq++;
        props.current.onStroke({ ...g, points: [...g.points] });
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
    />
  );
}
export function MeetingDrawing({
  meeting,
  user,
  joined,
  canManage,
  demo = false,
  onBoardChange,
}: {
  meeting: string;
  user: { id: string; name: string };
  joined: boolean;
  canManage: boolean;
  demo?: boolean;
  onBoardChange?: (open: boolean) => void;
}) {
  const [state, setState] = useState<DrawingState>(emptyDrawing),
    [targets, setTargets] = useState<Target[]>([]),
    [error, setError] = useState(""),
    [pollError, setPollError] = useState(""),
    [syncError, setSyncError] = useState(""),
    [tools, setTools] = useState(true),
    [expandedTools, setExpandedTools] = useState(false),
    [tool, setTool] = useState("pointer"),
    [color, setColor] = useState("#0B4ED8"),
    [width, setWidth] = useState(4),
    [text, setText] = useState(""),
    [hosts, setHosts] = useState<HTMLElement[]>([]),
    [stage, setStage] = useState<HTMLElement | null>(null),
    [pendingCount, setPendingCount] = useState(0),
    [busy, setBusy] = useState(false);
  const anchor = useRef<HTMLDivElement>(null),
    current = useRef(state),
    version = useRef(-1),
    pending = useRef(
      new Map<string, { stroke: DrawStroke; context: string; epoch: number }>(),
    ),
    serial = useRef(Promise.resolve()),
    canvas = useRef<HTMLCanvasElement | null>(null),
    alive = useRef(true),
    pumping = useRef(false),
    polling = useRef(false),
    retry = useRef({ failures: 0, at: 0 }),
    presentationAttempt = useRef(0),
    targetRef = useRef(targets);
  current.current = state;
  targetRef.current = targets;
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!stage) return;
    const node = document.createElement("div");
    node.className = "meeting-drawing-slot";
    stage.prepend(node);
    setSlot(node);
    return () => node.remove();
  }, [stage]);
  const page = drawingPage(state),
    context = drawingContext(state),
    target = targets.find((t) => t.key === state.target),
    owner = state.mode === "screen" && target?.user_id === user.id,
    screenLive = state.mode !== "screen" || !!target,
    canDraw =
      joined &&
      state.active &&
      screenLive &&
      (canManage || owner || state.allow_students);
  const receive = (v: Envelope) => {
    if (!alive.current || v.revision < version.current) return;
    version.current = v.revision;
    if (v.state) {
      current.current = v.state;
      setState(v.state);
    }
    setTargets(v.targets || []);
  };
  async function load(force = false) {
    if (demo)
      return {
        state: current.current,
        targets: targetRef.current,
        revision: version.current,
      };
    const v = await drawingRequest<Envelope>(
      `/meetings/${meeting}/drawing` +
        (force ? "" : `?since=${Math.max(0, version.current)}`),
    );
    receive(v);
    return v;
  }
  function mutate(input: any): Promise<void> {
    const task = serial.current.then(async () => {
      if (!alive.current) return;
      if (demo) {
        const s = structuredClone(current.current),
          p = drawingPage(s)!;
        if (input.action === "open_board") {
          s.active = true;
          s.mode = "board";
        } else if (
          input.action === "open_screen" ||
          input.action === "show_presentation"
        ) {
          s.active = input.action !== "show_presentation";
          s.mode = "screen";
          s.target = input.target;
          s.screens[input.target] ||= {
            id: input.target,
            name: "Chú thích màn hình",
            epoch: 0,
            strokes: [],
            deleted: [],
          };
        } else if (input.action === "allow")
          s.allow_students = input.allow_students;
        else if (input.action === "close") s.active = false;
        else if (input.action === "page_add") {
          const id = crypto.randomUUID();
          s.pages.push({
            id,
            name: "Trang " + (s.pages.length + 1),
            epoch: 0,
            strokes: [],
            deleted: [],
          });
          s.page = id;
        } else if (input.action === "page_select") s.page = input.page;
        else if (input.action === "page_delete") {
          s.pages = s.pages.filter((v) => v.id !== s.page);
          s.page = s.pages[0].id;
        } else if (input.action === "clear") {
          p.strokes = [];
          p.deleted = [];
          p.epoch++;
        } else if (input.action === "stroke") {
          const stroke = { ...input.stroke, owner: user.id };
          p.strokes = [...p.strokes.filter((v) => v.id !== stroke.id), stroke];
        } else if (input.action === "erase") {
          p.strokes = p.strokes.filter((v) => v.id !== input.id);
          p.deleted.push(input.id);
        }
        s.control_revision++;
        receive({
          state: s,
          revision: version.current + 1,
          targets: targetRef.current,
        });
        return;
      }
      const result = await drawingRequest<Envelope>(
        `/meetings/${meeting}/drawing`,
        {
          ...input,
          revision: current.current.control_revision || 0,
        },
      );
      receive(result);
    });
    serial.current = task.catch(() => {});
    return task;
  }
  async function act(input: any) {
    setBusy(true);
    setError("");
    try {
      if (
        ["open_board", "open_screen", "show_presentation", "close"].includes(
          input.action,
        )
      ) {
        for (const [id, entry] of [...pending.current]) {
          await mutate({ action: "stroke", ...entry });
          if (pending.current.get(id)?.stroke.seq === entry.stroke.seq)
            pending.current.delete(id);
        }
        setPendingCount(pending.current.size);
        if (!pending.current.size) {
          setSyncError("");
          retry.current = { failures: 0, at: 0 };
        }
      }
      await mutate(input);
    } catch (e) {
      setError((e as Error).message);
      await load(true).catch(() => {});
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const pump = async () => {
    if (
      pumping.current ||
      !pending.current.size ||
      !joined ||
      Date.now() < retry.current.at
    )
      return;
    pumping.current = true;
    const [id, entry] = pending.current.entries().next().value!;
    try {
      await mutate({ action: "stroke", ...entry });
      retry.current = { failures: 0, at: 0 };
      if (alive.current) setSyncError("");
      if (pending.current.get(id)?.stroke.seq === entry.stroke.seq)
        pending.current.delete(id);
    } catch (e) {
      if (retryDrawing(e)) {
        retry.current.failures++;
        retry.current.at =
          Date.now() +
          Math.min(10000, 500 * 2 ** Math.min(retry.current.failures, 5));
      } else {
        pending.current.delete(id);
        retry.current = { failures: 0, at: 0 };
      }
      if (alive.current) {
        setSyncError(
          retryDrawing(e)
            ? "Kết nối chập chờn. Nét vẽ đang được giữ và sẽ tự gửi lại. Đừng tải lại hoặc rời lớp khi chưa lưu xong."
            : (e as Error).message,
        );
        await load(true).catch(() => {});
      }
    } finally {
      pumping.current = false;
      if (alive.current) setPendingCount(pending.current.size);
    }
  };
  useEffect(() => {
    alive.current = true;
    let stopped = false;
    const tick = async () => {
      if (polling.current) return;
      polling.current = true;
      try {
        await load();
        if (!stopped) setPollError("");
      } catch (e) {
        if (!stopped) setPollError((e as Error).message);
      } finally {
        polling.current = false;
      }
    };
    if (joined && !demo) tick();
    if (demo)
      setTargets([
        {
          key: "demo-screen",
          user_id: canManage ? user.id : "teacher",
          name: "Màn hình trình bày minh họa",
        },
      ]);
    const id = setInterval(() => {
        if (joined && !demo) tick();
      }, 1200),
      p = setInterval(() => void pump(), 200);
    return () => {
      stopped = true;
      alive.current = false;
      presentationAttempt.current++;
      clearInterval(id);
      clearInterval(p);
    };
  }, [meeting, joined, demo]);
  useEffect(() => {
    const protect = (e: BeforeUnloadEvent) => {
      if (pending.current.size) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, []);
  useEffect(() => {
    const room = anchor.current?.closest(".room");
    if (!room) return;
    const inspect = () => {
      const list = Array.from(
        room.querySelectorAll<HTMLElement>("[data-presentation]"),
      );
      setHosts((old) =>
        old.length === list.length && old.every((v, i) => v === list[i])
          ? old
          : list,
      );
      const next =
        room.querySelector<HTMLElement>(".video-grid") ||
        room.querySelector<HTMLElement>(".preview-classroom > section");
      setStage((old) => (old === next ? old : next));
    };
    const observer = new MutationObserver(inspect);
    observer.observe(room, { subtree: true, childList: true });
    inspect();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d.meeting !== meeting || !joined) return;
      if (!["board", "present"].includes(d.mode)) return;
      const attempt = ++presentationAttempt.current;
      setTools(true);
      if (d.mode === "board") {
        if (!canManage) {
          if (!current.current.active) setError("Giáo viên chưa mở bảng trắng");
          return;
        }
        void act({ action: "open_board" });
      } else if (d.mode === "present") {
        void (async () => {
          for (let i = 0; i < 8; i++) {
            if (!alive.current || attempt !== presentationAttempt.current)
              return;
            try {
              const v = await load(true);
              if (!alive.current || attempt !== presentationAttempt.current)
                return;
              const own = v.targets.find((t) => t.user_id === user.id);
              if (own)
                return act({ action: "show_presentation", target: own.key });
            } catch (e) {
              if (!retryDrawing(e)) throw e;
            }
            await new Promise((r) => setTimeout(r, 400));
          }
          if (alive.current && attempt === presentationAttempt.current)
            throw Error(
              "Chưa chuyển được màn hình. Khi kết nối ổn định, chọn Quay lại trình bày.",
            );
        })().catch((e) => setError(e.message));
      }
    };
    window.addEventListener("meeting:drawing", handler);
    return () => window.removeEventListener("meeting:drawing", handler);
  }, [meeting, joined, canManage]);
  useEffect(() => {
    const board = state.active && state.mode === "board";
    onBoardChange?.(board);
    const room = anchor.current?.closest<HTMLElement>(".room");
    if (room) room.dataset.sharedSurface = board ? "board" : "presentation";
    hosts.forEach((h) => {
      h.dataset.presentationSuppressed = String(board);
    });
    return () => {
      if (room) delete room.dataset.sharedSurface;
      hosts.forEach((h) => delete h.dataset.presentationSuppressed);
    };
  }, [state.active, state.mode, target?.key, hosts, onBoardChange]);
  useEffect(() => {
    const close = (e: Event) => {
      anchor.current
        ?.querySelectorAll<HTMLDetailsElement>(".drawing-labelled-menu[open]")
        .forEach((d) => {
          if (!d.contains(e.target as Node)) d.open = false;
        });
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const add = (stroke: DrawStroke) => {
    const p = drawingPage(current.current);
    if (!p) return;
    const id = stroke.id.startsWith(user.id + "-")
      ? stroke.id
      : user.id + "-" + stroke.id;
    pending.current.set(id, {
      stroke: {
        ...stroke,
        id,
        owner: user.id,
        expires_at: stroke.kind === "laser" ? Date.now() + 5000 : undefined,
      },
      context: drawingContext(current.current),
      epoch: p.epoch,
    });
    setPendingCount(pending.current.size);
  };
  const strokes = page
    ? [
        ...page.strokes.filter((s) => !pending.current.has(s.id)),
        ...Array.from(pending.current.values())
          .filter(
            (v) =>
              v.context === context &&
              v.epoch === page.epoch &&
              !page.deleted.includes(v.stroke.id),
          )
          .map((v) => v.stroke),
      ]
    : [];
  const view = page ? { ...page, strokes } : null;
  const erase = (p: DrawPoint) => {
    const s = [...strokes]
      .reverse()
      .find(
        (s) => (canManage || owner || s.owner === user.id) && hitStroke(s, p),
      );
    if (s) void act({ action: "erase", context, epoch: page!.epoch, id: s.id });
  };
  const undo = () => {
    const last = [...strokes].reverse().find((v) => v.owner === user.id);
    if (last)
      void act({ action: "erase", context, epoch: page!.epoch, id: last.id });
  };
  const exportPNG = async () => {
    if (!canvas.current || !view) return;
    try {
      const out = document.createElement("canvas");
      const host = hosts.find(
          (h) => h.dataset.presentation === target?.user_id,
        ),
        video = host?.querySelector("video");
      out.width =
        state.mode === "screen" && video?.videoWidth
          ? Math.min(1920, video.videoWidth)
          : 1600;
      out.height =
        state.mode === "screen" && video?.videoWidth
          ? Math.round((out.width * video.videoHeight) / video.videoWidth)
          : 900;
      const ctx = out.getContext("2d")!;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, out.width, out.height);
      if (state.mode === "screen" && video?.videoWidth)
        ctx.drawImage(video, 0, 0, out.width, out.height);
      paintDrawing(ctx, view, out.width, out.height);
      const blob = await new Promise<Blob | null>((r) =>
        out.toBlob(r, "image/png"),
      );
      if (!blob) throw Error("Chưa xuất được ảnh");
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = `bang-${meeting}-${page!.id.slice(0, 12)}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const surface = (overlay = false) => (
    <DrawingCanvas
      page={view!}
      editable={canDraw && tools}
      tool={tool}
      color={color}
      width={tool === "marker" ? 12 : width}
      text={text}
      onStroke={add}
      onErase={erase}
      onNode={(node) => {
        if (node) canvas.current = node;
      }}
      overlay={overlay}
    />
  );
  return (
    <div ref={anchor} className="meeting-drawing-anchor">
      {(error ||
        pollError ||
        syncError ||
        (state.active && state.mode === "board" && tools)) && (
        <section
          className={
            "meeting-drawing-tools" + (!expandedTools ? " drawing-compact" : "")
          }
          aria-label="Công cụ viết vẽ"
        >
          <header>
            <strong>
              Bảng trắng
              {pendingCount > 0 ? " · Đang lưu…" : ""}
            </strong>
            <button
              type="button"
              onClick={() => {
                setTools(false);
              }}
            >
              <DrawingIcon kind="close" />
              <span className="drawing-sr-only">Ẩn công cụ</span>
            </button>
          </header>
          {state.active &&
            state.mode === "board" &&
            canManage &&
            targets.length > 0 && (
              <div className="drawing-surface-switch">
                <span>
                  Bảng trắng đang hiển thị cho cả lớp · màn hình chia sẻ tạm ẩn
                </span>
                <button
                  disabled={busy || pendingCount > 0}
                  onClick={() =>
                    void act({
                      action: "show_presentation",
                      target: target?.key || targets[0].key,
                    })
                  }
                >
                  Quay lại trình bày
                </button>
              </div>
            )}
          {(error || syncError || pollError) && (
            <p role="alert">{error || syncError || pollError}</p>
          )}
          {state.active && state.mode === "board" && (
            <>
              <details
                className="drawing-labelled-menu"
                onToggle={(e) => {
                  const d = e.currentTarget;
                  if (d.open) {
                    const anchor = d
                      .querySelector("summary")!
                      .getBoundingClientRect();
                    const above = Math.max(0, anchor.top - 20);
                    const below = Math.max(0, innerHeight - anchor.bottom - 20);
                    const up = above > below;
                    d.dataset.side = up ? "up" : "down";
                    d.style.setProperty(
                      "--drawing-menu-space",
                      `${Math.max(0, up ? above : below)}px`,
                    );
                    if (
                      document.activeElement === d.querySelector("summary") ||
                      !d.contains(document.activeElement)
                    )
                      d.querySelector<HTMLElement>(
                        '[aria-checked="true"]',
                      )?.focus({ preventScroll: true });
                  }
                }}
                onKeyDown={(e) => {
                  const d = e.currentTarget;
                  if (e.key === "Escape") {
                    d.open = false;
                    d.querySelector<HTMLElement>("summary")?.focus();
                  }
                  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
                    e.preventDefault();
                    const items = Array.from(
                      d.querySelectorAll<HTMLButtonElement>(
                        '[role="menuitemradio"], [role="menuitem"], [role="menuitemcheckbox"]',
                      ),
                    );
                    const index = items.indexOf(
                      document.activeElement as HTMLButtonElement,
                    );
                    const next =
                      e.key === "Home"
                        ? 0
                        : e.key === "End"
                          ? items.length - 1
                          : (index +
                              (e.key === "ArrowDown" ? 1 : -1) +
                              items.length) %
                            items.length;
                    items[next]?.focus();
                  }
                }}
              >
                <summary
                  data-meet-tip="Chọn công cụ viết vẽ"
                  aria-label="Chọn công cụ viết vẽ"
                  aria-description={
                    "Công cụ đang chọn: " +
                    (drawingTools.find(([key]) => key === tool)?.[1] || "Bút")
                  }
                >
                  <DrawingIcon kind={tool} />
                  <span className="drawing-current-tool">
                    {drawingTools.find(([key]) => key === tool)?.[1] ||
                      "Công cụ"}
                  </span>
                  <span aria-hidden="true">⌄</span>
                </summary>
                <DrawingToolMenu
                  tool={tool}
                  color={color}
                  canDraw={canDraw}
                  busy={busy}
                  manage={canManage || owner}
                  canAllow={canManage}
                  allow={state.allow_students}
                  pending={pendingCount > 0}
                  screen={false}
                  choose={(next, value) => {
                    setTool(next);
                    if (["text", "note"].includes(next)) setExpandedTools(true);
                    if (next === "stamp") setText(value || "⭐");
                  }}
                  setColor={setColor}
                  toggleAllow={() => {
                    if (canManage)
                      void act({
                        action: "allow",
                        allow_students: !state.allow_students,
                      });
                  }}
                  clear={() => {
                    if (confirm("Xóa toàn bộ nét vẽ trên trang hiện tại?"))
                      void act({
                        action: "clear",
                        context,
                        epoch: page!.epoch,
                      });
                  }}
                  stop={() => void act({ action: "close" })}
                />
              </details>
              {state.mode === "board" && (
                <>
                  {!expandedTools && (
                    <button
                      className="drawing-dock-action"
                      disabled={
                        !canDraw ||
                        pendingCount > 0 ||
                        !strokes.some((v) => v.owner === user.id)
                      }
                      onClick={undo}
                      aria-label="Hoàn tác nét của tôi"
                      data-meet-tip="Hoàn tác nét của tôi"
                    >
                      <DrawingIcon kind="undo" />
                    </button>
                  )}
                  <button
                    className="drawing-dock-action"
                    aria-label="Tùy chỉnh bút"
                    data-meet-tip="Tùy chỉnh bút"
                    aria-expanded={expandedTools}
                    onClick={() => setExpandedTools((v) => !v)}
                  >
                    <DrawingIcon kind="more" />
                  </button>
                </>
              )}
              <div
                className="drawing-tool-row"
                role="toolbar"
                aria-label="Bút và hình vẽ"
              >
                {drawingTools.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={tool === key}
                    disabled={!canDraw}
                    aria-label={label}
                    data-meet-tip={label}
                    onClick={() => {
                      setTool(key);
                      if (key === "stamp") setText("⭐");
                    }}
                  >
                    <DrawingIcon kind={key} />
                    <span className="drawing-sr-only">{label}</span>
                  </button>
                ))}
                <label>
                  Màu
                  <select
                    aria-label="Màu bút"
                    value={color}
                    disabled={!canDraw}
                    onChange={(e) => setColor(e.target.value)}
                  >
                    {[
                      ["#0B4ED8", "Xanh"],
                      ["#00C2E8", "Xanh ngọc"],
                      ["#FFAA1D", "Cam"],
                      ["#FF4D4F", "Đỏ"],
                      ["#162B49", "Đen"],
                      ["#FFFFFF", "Trắng"],
                      ["#006F86", "Xanh đậm"],
                      ["#34A853", "Xanh lá"],
                    ].map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Nét
                  <select
                    aria-label="Độ dày bút"
                    value={width}
                    disabled={!canDraw}
                    onChange={(e) => setWidth(Number(e.target.value))}
                  >
                    <option value={2}>Mảnh</option>
                    <option value={4}>Vừa</option>
                    <option value={8}>Đậm</option>
                  </select>
                </label>
              </div>
              {tool === "stamp" && (
                <div className="drawing-stamps" aria-label="Chọn hình dán">
                  {["⭐", "👍", "✅", "❓", "❤️"].map((emoji) => (
                    <button
                      title={"Hình dán " + emoji}
                      aria-label={"Hình dán " + emoji}
                      aria-pressed={text === emoji}
                      onClick={() => setText(emoji)}
                      key={emoji}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
              {["text", "note"].includes(tool) && (
                <label>
                  Nội dung chữ
                  <input
                    aria-label="Nội dung chữ trên bảng"
                    value={text}
                    maxLength={500}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Nhập chữ rồi chạm vào bảng"
                  />
                  <button
                    type="button"
                    disabled={!canDraw || !text.trim()}
                    onClick={() =>
                      add({
                        id: crypto.randomUUID(),
                        owner: user.id,
                        kind: tool,
                        color,
                        width,
                        points: [{ x: 600, y: 350 }],
                        text,
                        seq: 1,
                      })
                    }
                  >
                    Thêm chữ ở giữa
                  </button>
                </label>
              )}
              <div className="drawing-actions">
                <button
                  disabled={
                    !canDraw ||
                    pendingCount > 0 ||
                    !strokes.some((v) => v.owner === user.id)
                  }
                  onClick={undo}
                  data-meet-tip="Hoàn tác nét của tôi"
                  aria-label="Hoàn tác nét của tôi"
                >
                  <DrawingIcon kind="undo" />
                  <span className="drawing-sr-only">Hoàn tác nét của tôi</span>
                </button>
                <button
                  disabled={!view}
                  data-meet-tip="Tải ảnh PNG"
                  aria-label="Tải ảnh PNG"
                  onClick={() => void exportPNG()}
                >
                  <DrawingIcon kind="download" />
                  <span className="drawing-sr-only">Tải ảnh PNG</span>
                </button>
                {canManage && (
                  <label>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={state.allow_students}
                      onChange={(e) =>
                        void act({
                          action: "allow",
                          allow_students: e.target.checked,
                        })
                      }
                    />
                    Cho học sinh cùng vẽ
                  </label>
                )}
                {(canManage || owner) && (
                  <>
                    <button
                      disabled={busy || pendingCount > 0}
                      onClick={() => {
                        if (confirm("Xóa toàn bộ nét vẽ trên trang hiện tại?"))
                          void act({
                            action: "clear",
                            context,
                            epoch: page!.epoch,
                          });
                      }}
                    >
                      <DrawingIcon kind="trash" />
                      <span>Xóa nét trên trang</span>
                    </button>
                    <button
                      disabled={busy || pendingCount > 0}
                      onClick={() => void act({ action: "close" })}
                    >
                      <DrawingIcon kind="close" />
                      <span>Đóng cho cả lớp</span>
                    </button>
                  </>
                )}
              </div>
              {!canDraw && (
                <small>
                  Đang xem · Giáo viên có thể cho phép học sinh cùng vẽ.
                </small>
              )}
            </>
          )}
        </section>
      )}
      {state.active &&
        state.mode === "board" &&
        view &&
        slot &&
        createPortal(
          <section
            className="drawing-board-stage"
            aria-label="Bảng trắng của lớp"
          >
            <div className="drawing-pages">
              <strong>{page?.name}</strong>
              <select
                aria-label="Trang bảng trắng"
                value={state.page}
                disabled={!canManage || busy || pendingCount > 0}
                onChange={(e) =>
                  void act({ action: "page_select", page: e.target.value })
                }
              >
                {state.pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {canManage && (
                <>
                  <button
                    disabled={
                      busy || pendingCount > 0 || state.pages.length >= 20
                    }
                    onClick={() => void act({ action: "page_add" })}
                  >
                    Thêm trang
                  </button>
                  <button
                    disabled={
                      busy || pendingCount > 0 || state.pages.length <= 1
                    }
                    onClick={() => {
                      if (confirm("Xóa trang bảng trắng hiện tại?"))
                        void act({ action: "page_delete" });
                    }}
                  >
                    Xóa trang
                  </button>
                </>
              )}
              <button onClick={() => setTools((v) => !v)}>Công cụ vẽ</button>
            </div>
            {surface()}
          </section>,
          slot,
        )}
    </div>
  );
}
