export type DrawPoint = { x: number; y: number };
export type DrawStroke = {
  id: string;
  owner: string;
  kind: string;
  color: string;
  width: number;
  points: DrawPoint[];
  text: string;
  seq: number;
};
export type DrawPage = {
  id: string;
  name: string;
  epoch: number;
  strokes: DrawStroke[];
  deleted: string[];
};
export type DrawingState = {
  active: boolean;
  mode: string;
  target: string;
  page: string;
  allow_students: boolean;
  control_revision: number;
  pages: DrawPage[];
  screens: Record<string, DrawPage>;
};
export const emptyDrawing = (): DrawingState => ({
  active: false,
  mode: "board",
  target: "",
  page: "p1",
  allow_students: false,
  control_revision: 0,
  pages: [{ id: "p1", name: "Trang 1", epoch: 0, strokes: [], deleted: [] }],
  screens: {},
});
export function drawingPage(s: DrawingState) {
  return s.mode === "screen"
    ? s.screens[s.target]
    : s.pages.find((p) => p.id === s.page);
}
export function drawingContext(s: DrawingState) {
  return s.mode === "screen" ? "screen:" + s.target : "board:" + s.page;
}
export function paintStroke(ctx: CanvasRenderingContext2D, s: DrawStroke) {
  const p = s.points;
  if (!p.length) return;
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = s.kind === "marker" ? 0.28 : 1;
  const a = p[0],
    b = p[p.length - 1];
  ctx.beginPath();
  if (s.kind === "text") {
    ctx.font = '32px "Segoe UI",Arial,sans-serif';
    s.text
      .split("\n")
      .slice(0, 15)
      .forEach((line, i) =>
        ctx.fillText(line, a.x, a.y + 32 + i * 38, 1600 - a.x),
      );
  } else if (s.kind === "rect") {
    ctx.strokeRect(
      Math.min(a.x, b.x),
      Math.min(a.y, b.y),
      Math.abs(b.x - a.x),
      Math.abs(b.y - a.y),
    );
  } else if (s.kind === "ellipse") {
    ctx.ellipse(
      (a.x + b.x) / 2,
      (a.y + b.y) / 2,
      Math.max(0.5, Math.abs(b.x - a.x) / 2),
      Math.max(0.5, Math.abs(b.y - a.y) / 2),
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  } else if (p.length === 1) {
    ctx.arc(a.x, a.y, s.width / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.moveTo(a.x, a.y);
    (s.kind === "line" ? [b] : p.slice(1)).forEach((v) => ctx.lineTo(v.x, v.y));
    ctx.stroke();
  }
  ctx.restore();
}
export function paintDrawing(
  ctx: CanvasRenderingContext2D,
  page: DrawPage,
  width: number,
  height: number,
  white = false,
) {
  ctx.save();
  if (white) {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.scale(width / 1600, height / 900);
  page.strokes.forEach((s) => paintStroke(ctx, s));
  ctx.restore();
}
export function hitStroke(s: DrawStroke, p: DrawPoint) {
  const a = s.points[0],
    b = s.points.at(-1)!;
  if (!a) return false;
  const segment = (a: DrawPoint, b: DrawPoint) => {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      l = dx * dx + dy * dy,
      t = l
        ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l))
        : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) < 18 + s.width;
  };
  if (s.kind === "text")
    return (
      p.x >= a.x &&
      p.x <= Math.min(1600, a.x + s.text.length * 22) &&
      p.y >= a.y &&
      p.y <= a.y + 40 * s.text.split("\n").length
    );
  if (s.kind === "rect")
    return (
      segment(a, { x: b.x, y: a.y }) ||
      segment({ x: b.x, y: a.y }, b) ||
      segment(b, { x: a.x, y: b.y }) ||
      segment({ x: a.x, y: b.y }, a)
    );
  if (s.kind === "ellipse") {
    const rx = Math.abs(b.x - a.x) / 2,
      ry = Math.abs(b.y - a.y) / 2;
    return (
      rx > 0 &&
      ry > 0 &&
      Math.abs(
        Math.hypot((p.x - (a.x + b.x) / 2) / rx, (p.y - (a.y + b.y) / 2) / ry) -
          1,
      ) <
        25 / Math.max(1, Math.min(rx, ry))
    );
  }
  if (s.kind === "line") return segment(a, b);
  return s.points.some((v, i) => segment(v, s.points[Math.max(0, i - 1)]));
}
