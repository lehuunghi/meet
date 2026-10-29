import {
  drawingPage,
  paintDrawing,
  type DrawingState,
} from "../web/src/drawing-model";
import { ClassroomMedia } from "../web/src/media";
declare global {
  interface Window {
    recorderRPC: (path: string, body?: unknown) => Promise<any>;
    recorderChunk: (chunk: string) => Promise<void>;
    recorderSegment: () => Promise<void>;
    recorderOpen: () => Promise<void>;
    capture: any;
  }
}
const canvas = document.createElement("canvas");
canvas.width = 1280;
canvas.height = 720;
document.body.append(canvas);
const ctx = canvas.getContext("2d")!;
const audio = new AudioContext();
const mix = audio.createMediaStreamDestination();
// Keep one stable audio track even while the room is temporarily empty.
const silent = audio.createOscillator(),
  gain = audio.createGain();
gain.gain.value = 0;
silent.connect(gain).connect(mix);
silent.start();
const tiles = new Map<
  string,
  { video: HTMLVideoElement; source?: MediaStreamAudioSourceNode; name: string }
>();
let media: ClassroomMedia,
  recorder: MediaRecorder,
  timer: number,
  writes = Promise.resolve(),
  stopping = false;
let speaker = "";
let ink: (DrawingState & { target_user?: string }) | null = null;
function remove(key: string) {
  const tile = tiles.get(key);
  tile?.source?.disconnect();
  tile?.video.remove();
  tiles.delete(key);
}
function draw() {
  ctx.fillStyle = "#202124";
  ctx.fillRect(0, 0, 1280, 720);
  const all = [...tiles.entries()];
  const inkPage = ink?.active ? drawingPage(ink) : null;
  if (ink?.active && ink.mode === "board" && inkPage) {
    paintDrawing(ctx, inkPage, 1280, 720, true);
    return;
  }
  const screen =
    (ink?.mode === "screen" && ink.target_user
      ? all.find(([key]) => key === ink!.target_user + ":screen")
      : undefined) || all.find(([key]) => key.endsWith(":screen"));
  const person =
    all.find(([key]) => key === speaker) ||
    all.find(([key]) => !key.endsWith(":screen"));
  const selected = screen ? [screen] : person ? [person] : [];
  if (!selected.length) {
    ctx.fillStyle = "#e8eaed";
    ctx.font = "28px sans-serif";
    ctx.fillText("Đang chờ người tham gia", 40, 360);
  }
  const cols = Math.ceil(Math.sqrt(selected.length || 1)),
    rows = Math.ceil(selected.length / cols);
  selected.forEach(([, tile], i) => {
    const w = 1280 / cols,
      h = 720 / rows,
      x = (i % cols) * w,
      y = Math.floor(i / cols) * h;
    if (tile.video.videoWidth) {
      const scale = Math.min(
        w / tile.video.videoWidth,
        h / tile.video.videoHeight,
      );
      const vw = tile.video.videoWidth * scale,
        vh = tile.video.videoHeight * scale;
      ctx.drawImage(tile.video, x + (w - vw) / 2, y + (h - vh) / 2, vw, vh);
      if (
        ink?.active &&
        ink.mode === "screen" &&
        inkPage &&
        screen?.[1] === tile
      ) {
        ctx.save();
        ctx.translate(x + (w - vw) / 2, y + (h - vh) / 2);
        paintDrawing(ctx, inkPage, vw, vh);
        ctx.restore();
      }
    }
    ctx.fillStyle = "#202124cc";
    ctx.fillRect(x, y + h - 34, w, 34);
    ctx.fillStyle = "#fff";
    ctx.font = "18px sans-serif";
    ctx.fillText(tile.name.slice(0, 70), x + 10, y + h - 10, w - 20);
  });
  if (screen && person) {
    const v = person[1].video;
    ctx.fillStyle = "#303134";
    ctx.fillRect(1000, 16, 264, 160);
    if (v.videoWidth) ctx.drawImage(v, 1000, 16, 264, 148);
    ctx.fillStyle = "#fff";
    ctx.font = "16px sans-serif";
    ctx.fillText(person[1].name.slice(0, 30), 1008, 168, 248);
  }
}
function startSegment() {
  const output = canvas.captureStream(15);
  mix.stream.getAudioTracks().forEach((t) => output.addTrack(t));
  recorder = new MediaRecorder(output, {
    mimeType: "video/webm;codecs=vp8,opus",
    videoBitsPerSecond: 1500000,
    audioBitsPerSecond: 96000,
  });
  recorder.ondataavailable = (e) => {
    if (e.data.size)
      writes = writes.then(async () => {
        const bytes = new Uint8Array(await e.data.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        await window.recorderChunk(btoa(binary));
      });
  };
  recorder.start(2000);
}
async function finishSegment() {
  if (recorder.state === "inactive") return;
  await new Promise<void>((resolve) => {
    recorder.addEventListener("stop", () => resolve(), { once: true });
    recorder.stop();
  });
  await writes;
  await window.recorderSegment();
  recorder.stream.getVideoTracks().forEach((t) => t.stop());
}
window.capture = {
  async start(id: string) {
    await audio.resume();
    media = new ClassroomMedia(
      id,
      (key, stream, name) => {
        remove(key);
        const video = document.createElement("video");
        video.muted = true;
        video.autoplay = true;
        video.srcObject = stream;
        document.body.append(video);
        void video.play().catch(() => {});
        let source: MediaStreamAudioSourceNode | undefined;
        if (stream.getAudioTracks().length) {
          source = audio.createMediaStreamSource(stream);
          source.connect(mix);
        }
        tiles.set(key, { video, source, name });
      },
      remove,
      () => {},
      window.recorderRPC as any,
    );
    timer = window.setInterval(draw, 1000 / 15);
    startSegment();
  },
  async tick(
    list: any[],
    drawing: (DrawingState & { target_user?: string }) | null = null,
  ) {
    ink = drawing;
    try {
      await media.recover();
      await media.subscribe(list, "__server_recorder__");
    } catch { return; } // Keep the recording/spool alive through SFU recovery.

    const levels = await media.audioLevels();
    const loudest = Object.entries(levels)
      .filter(([key]) => !key.endsWith(":screen"))
      .sort((a, b) => b[1] - a[1])[0];
    if (loudest && loudest[1] > 0.02) speaker = loudest[0];
  },
  async rotate() {
    if (stopping) return;
    await finishSegment();
    await window.recorderOpen();
    startSegment();
  },
  async stop() {
    stopping = true;
    try {
      await finishSegment();
    } finally {
      clearInterval(timer);
      media?.close();
      [...tiles.keys()].forEach(remove);
      await audio.close();
    }
  },
};
