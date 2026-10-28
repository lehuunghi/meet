import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
export function MeetingTooltips() {
  const [tip, setTip] = useState<{
      label: string;
      x: number;
      y: number;
      below: boolean;
    } | null>(null),
    active = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const clear = () => {
      if (
        active.current?.getAttribute("aria-describedby") ===
        "meeting-control-tip"
      )
        active.current.removeAttribute("aria-describedby");
      active.current = null;
      setTip(null);
    };
    const show = (e: Event) => {
      const node = (e.target as Element)?.closest<HTMLElement>(
        "[data-meet-tip]",
      );
      if (!node?.closest(".room")) {
        clear();
        return;
      }
      const label = node.dataset.meetTip;
      if (!label) return;
      clear();
      active.current = node;
      node.setAttribute("aria-describedby", "meeting-control-tip");
      const r = node.getBoundingClientRect(),
        below = r.top < 70;
      setTip({
        label,
        x: Math.max(130, Math.min(innerWidth - 130, r.left + r.width / 2)),
        y: below ? r.bottom + 10 : r.top - 10,
        below,
      });
    };
    const out = (e: Event) => {
      if (active.current?.contains((e as PointerEvent).relatedTarget as Node))
        return;
      clear();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") clear();
    };
    document.addEventListener("pointerover", show);
    document.addEventListener("focusin", show);
    document.addEventListener("pointerout", out);
    document.addEventListener("focusout", out);
    document.addEventListener("pointerdown", clear);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", clear, true);
    window.addEventListener("resize", clear);
    return () => {
      clear();
      document.removeEventListener("pointerover", show);
      document.removeEventListener("focusin", show);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("focusout", out);
      document.removeEventListener("pointerdown", clear);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", clear, true);
      window.removeEventListener("resize", clear);
    };
  }, []);
  return tip
    ? createPortal(
        <div
          id="meeting-control-tip"
          role="tooltip"
          className="meeting-control-tip"
          data-below={tip.below}
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.label}
        </div>,
        document.body,
      )
    : null;
}
