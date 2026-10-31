import { useEffect, useRef, useState } from "react";
import { DrawingIcon } from "./drawing-icon";

export function DrawingToolMenu(p: {
  tool: string;
  color: string;
  canDraw: boolean;
  busy: boolean;
  manage: boolean;
  canAllow: boolean;
  allow: boolean;
  pending: boolean;
  screen: boolean;
  choose: (tool: string, text?: string) => void;
  setColor: (color: string) => void;
  toggleAllow: () => void;
  clear: () => void;
  stop: () => void;
}) {
  const [group, setGroup] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const d = ref.current?.closest("details");
    const reset = () => {
      if (d && !d.open) setGroup("");
    };
    const outside = (event: PointerEvent) => {
      if (d?.open && event.target instanceof Node && !d.contains(event.target))
        d.open = false;
    };
    const resize = () => {
      if (d) d.open = false;
    };
    d?.addEventListener("toggle", reset);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", resize);
    return () => {
      d?.removeEventListener("toggle", reset);
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", resize);
    };
  }, []);
  useEffect(() => {
    if (ref.current?.closest("details")?.open)
      ref.current
        .querySelector<HTMLButtonElement>("button:not(:disabled)")
        ?.focus({ preventScroll: true });
  }, [group]);
  const close = (el: HTMLElement) => {
    const d = el.closest("details");
    if (d) d.open = false;
    setGroup("");
  };
  const tool = (key: string, label: string) => (
    <button
      type="button"
      role="menuitemradio"
      key={key}
      aria-checked={p.tool === key}
      disabled={!p.canDraw}
      onClick={(e) => {
        p.choose(key);
        close(e.currentTarget);
      }}
    >
      <DrawingIcon kind={key} />
      <span>{label}</span>
    </button>
  );
  const next = (key: string, label: string, icon: string) => (
    <button
      type="button"
      role="menuitem"
      aria-haspopup="menu"
      onClick={() => setGroup(key)}
    >
      <DrawingIcon kind={icon} />
      <span>{label}</span>
      <DrawingIcon kind="chevron" />
    </button>
  );
  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Danh sách công cụ viết vẽ"
      onKeyDown={(e) => {
        if (group && (e.key === "Escape" || e.key === "ArrowLeft")) {
          e.preventDefault();
          e.stopPropagation();
          setGroup("");
        }
      }}
    >
      {group ? (
        <>
          <button
            type="button"
            role="menuitem"
            className="drawing-menu-back"
            onClick={() => setGroup("")}
          >
            <DrawingIcon kind="back" />
            <span>
              {group === "shapes"
                ? "Đường kẻ và hình dạng"
                : group === "color"
                  ? "Màu"
                  : "Hình dán"}
            </span>
          </button>
          <div role="separator" />
          {group === "shapes" && (
            <>
              {tool("pointer", "Con trỏ")}
              {tool("line", "Đường thẳng")}
              {tool("arrow", "Mũi tên")}
              {tool("rect", "Hình chữ nhật")}
              {tool("ellipse", "Hình elip")}
            </>
          )}
          {group === "color" && (
            <div className="drawing-menu-colors">
              {[
                ["#0B4ED8", "Xanh"],
                ["#00C2E8", "Xanh ngọc"],
                ["#FFAA1D", "Cam"],
                ["#FF4D4F", "Đỏ"],
                ["#162B49", "Đen"],
                ["#FFFFFF", "Trắng"],
                ["#006F86", "Xanh đậm"],
                ["#34A853", "Xanh lá"],
              ].map(([value, label]) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-label={label}
                  aria-checked={p.color === value}
                  disabled={!p.canDraw}
                  key={value}
                  onClick={(e) => {
                    p.setColor(value);
                    close(e.currentTarget);
                  }}
                >
                  <i style={{ background: value }} />
                  {p.color === value && <span>✓</span>}
                  <span className="drawing-sr-only">{label}</span>
                </button>
              ))}
            </div>
          )}
          {group === "stamp" && (
            <div className="drawing-menu-stamps">
              {["⭐", "👍", "✅", "❓", "❤️"].map((value) => (
                <button
                  type="button"
                  role="menuitem"
                  aria-label={"Hình dán " + value}
                  disabled={!p.canDraw}
                  key={value}
                  onClick={(e) => {
                    p.choose("stamp", value);
                    close(e.currentTarget);
                  }}
                >
                  {value}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {next("stamp", "Hình dán", "stamp")}
          {tool("pen", "Bút")}
          {tool("laser", "Mực biến mất")}
          {tool("text", "Hộp văn bản")}
          {tool("note", "Ghi chú cố định")}
          {next("shapes", "Đường kẻ và hình dạng", "shapes")}
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            onClick={() => setGroup("color")}
          >
            <i className="drawing-menu-color" style={{ background: p.color }} />
            <span>Màu</span>
            <DrawingIcon kind="chevron" />
          </button>
          <div role="separator" />
          {p.manage && (
            <button
              type="button"
              role="menuitem"
              disabled={p.busy || p.pending}
              onClick={(e) => {
                p.clear();
                close(e.currentTarget);
              }}
            >
              <DrawingIcon kind="trash" />
              <span>Xóa tất cả</span>
            </button>
          )}
          {tool("erase", "Tẩy")}
          {p.canAllow && (
            <>
              <div role="separator" />
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={p.allow}
                disabled={p.busy}
                onClick={p.toggleAllow}
              >
                <DrawingIcon kind="people" />
                <span>Cho phép người khác chú thích</span>
                {p.allow && <span aria-hidden="true">✓</span>}
              </button>
            </>
          )}
          {p.manage && (
            <>
              <button
                type="button"
                role="menuitem"
                disabled={p.busy || p.pending}
                onClick={(e) => {
                  p.stop();
                  close(e.currentTarget);
                }}
              >
                <DrawingIcon kind="stop" />
                <span>
                  {p.screen ? "Dừng chú thích" : "Đóng bảng cho cả lớp"}
                </span>
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
