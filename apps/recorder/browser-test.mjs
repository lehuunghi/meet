// Tests the actual canvas/audio/MediaRecorder pipeline with synthetic SFU inputs.
// No claim of Cloudflare transport or R2 acceptance is made by this test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
test(
  "server compositor records audio/video across teacher-page closure and creates independent WebM segments",
  { timeout: 60000 },
  async () => {
    const result = await build({
      entryPoints: ["browser.ts"],
      bundle: true,
      write: false,
      format: "iife",
      plugins: [
        {
          name: "synthetic-tracks",
          setup(b) {
            b.onResolve({ filter: /web\/src\/media$/ }, () => ({
              path: "synthetic",
              namespace: "test",
            }));
            b.onLoad({ filter: /.*/, namespace: "test" }, () => ({
              loader: "js",
              contents: `
 export class ClassroomMedia {
 constructor(id,onTrack){this.onTrack=onTrack;this.streams=[];}
 async subscribe(){if(this.streams.length)return;const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const c=canvas.getContext('2d');c.fillStyle='#0055ff';c.fillRect(0,0,640,360);const audio=new AudioContext();await audio.resume();const osc=audio.createOscillator(),dest=audio.createMediaStreamDestination();osc.connect(dest);osc.start();const stream=new MediaStream([...canvas.captureStream(15).getTracks(),...dest.stream.getTracks()]);this.streams.push(stream);this.audio=audio;this.onTrack('student:screen',stream,'Học sinh · Màn hình');}
 async audioLevels(){return {};}
 async recover(){}
 close(){this.streams.forEach(s=>s.getTracks().forEach(t=>t.stop()));this.audio?.close();}
 }`,
            }));
          },
        },
      ],
    });
    const browser = await chromium.launch({
      headless: true,
      ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
      args: ["--autoplay-policy=no-user-gesture-required"],
    });
    try {
      const context = await browser.newContext();
      const teacher = await context.newPage(),
        page = await context.newPage();
      await page.route("**/*", (r) =>
        r.fulfill({
          contentType: "text/html",
          body: "<!doctype html><title>Recorder compositor test</title>",
        }),
      );
      await page.goto("http://localhost/recorder");
      let chunks = [],
        segments = [],
        total = 0;
      await page.exposeFunction("recorderRPC", () => {});
      await page.exposeFunction("recorderChunk", (data) => {
        chunks.push(Buffer.from(data, "base64"));
        total++;
      });
      await page.exposeFunction("recorderSegment", () => {
        segments.push(Buffer.concat(chunks));
        chunks = [];
      });
      await page.exposeFunction("recorderOpen", () => {});
      await page.addScriptTag({ content: result.outputFiles[0].text });
      await page.evaluate(async () => {
        await window.capture.start("test");
        await window.capture.tick([]);
      });
      while (total < 2) await new Promise((r) => setTimeout(r, 250));
      const before = total;
      await teacher.close();
      while (total < before + 2) await new Promise((r) => setTimeout(r, 250));
      await page.evaluate(() => window.capture.rotate());
      while (chunks.length < 2) await new Promise((r) => setTimeout(r, 250));
      await page.evaluate(() => window.capture.stop());
      assert.equal(segments.length, 2);
      for (const segment of segments) {
        assert.ok(segment.length > 1000);
        assert.equal(segment.subarray(0, 4).toString("hex"), "1a45dfa3");
      }
      const dimensions = await page.evaluate(async (bytes) => {
        const v = document.createElement("video");
        v.muted = true;
        v.src = URL.createObjectURL(
          new Blob([new Uint8Array(bytes)], { type: "video/webm" }),
        );
        await new Promise((resolve, reject) => {
          v.onloadedmetadata = resolve;
          v.onerror = reject;
        });
        return [v.videoWidth, v.videoHeight];
      }, Array.from(segments[0]));
      assert.deepEqual(dimensions, [1280, 720]);
      if (process.platform !== "win32") {
        const dir = await fs.mkdtemp(
          path.join(os.tmpdir(), "meet-recorder-test-"),
        );
        const input = path.join(dir, "capture.partial"),
          output = path.join(dir, "capture.webm");
        try {
          await fs.writeFile(input, segments[0]);
          await promisify(execFile)("ffmpeg", [
            "-nostdin",
            "-v",
            "error",
            "-i",
            input,
            "-c",
            "copy",
            output,
          ]);
          const result = await promisify(execFile)("ffprobe", [
            "-v",
            "error",
            "-show_entries",
            "stream=codec_name,codec_type:format=duration",
            "-of",
            "json",
            output,
          ]);
          const metadata = JSON.parse(result.stdout);
          assert.ok(
            metadata.streams.some(
              (s) => s.codec_name === "vp8" && s.codec_type === "video",
            ),
          );
          assert.ok(
            metadata.streams.some(
              (s) => s.codec_name === "opus" && s.codec_type === "audio",
            ),
          );
          assert.ok(Number(metadata.format.duration) > 2);
        } finally {
          await fs.rm(input, { force: true });
          await fs.rm(output, { force: true });
          await fs.rmdir(dir);
        }
      }
    } finally {
      await browser.close();
    }
  },
);
