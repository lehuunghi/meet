import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import mysql from "mysql2/promise";
import { createClient } from "redis";
import { chromium } from "playwright";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import {
  parseDSN,
  pinnedProvider,
  recordingKey,
  assertRemoteTracks,
  retentionDays,
  leaseTTL,
  renewScript,
  releaseScript,
  recordingStopReason,
} from "./core.mjs";
const run = promisify(execFile),
  spool = process.env.SPOOL_DIR || "/var/lib/meet-recorder";
const readSecret = async (name) =>
  (await fs.readFile(process.env[name + "_FILE"], "utf8")).trim();
const settings = async () =>
  JSON.parse(
    await fs.readFile(
      path.join(
        process.env.CONFIG_DIR || "/var/lib/meet-config",
        "settings.json",
      ),
      "utf8",
    ),
  );
const db = mysql.createPool(parseDSN(await readSecret("MYSQL_DSN")));
const redis = createClient({ url: await readSecret("REDIS_URL") });
redis.on("error", () => console.error("RECORDER_REDIS_UNAVAILABLE"));
await redis.connect();
await fs.mkdir(spool, { recursive: true, mode: 0o700 });
const bundle = await fs.readFile(
  new URL("./dist/browser.js", import.meta.url),
  "utf8",
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
const active = new Map();
const concurrency = Math.max(
  1,
  Math.min(8, Number(process.env.RECORDER_CONCURRENCY) || 1),
);
async function publications(job) {
  const [rows] = await db.execute(
    `SELECT p.session_id,p.track_name,p.user_id,u.name FROM publications p JOIN users u ON u.id=p.user_id AND u.school_id=p.school_id JOIN presence a ON a.school_id=p.school_id AND a.meeting_id=p.meeting_id AND a.user_id=p.user_id WHERE p.school_id=? AND p.meeting_id=? AND a.online=TRUE AND a.last_seen>=UTC_TIMESTAMP()-INTERVAL 45 SECOND LIMIT 200`,
    [job.school_id, job.meeting_id],
  );
  return rows;
}
async function state(job, state, error = "") {
  await redis.set(
    `server-recording:${job.school_id}:${job.meeting_id}`,
    JSON.stringify({ state, error, seen: Math.floor(Date.now() / 1000) }),
    { EX: 180 },
  );
}
async function upload(metaFile) {
  const meta = JSON.parse(await fs.readFile(metaFile, "utf8")),
    cfg = await settings();
  // Never silently move a pending recording into a different bucket/account.
  if (
    !cfg.r2?.enabled ||
    cfg.r2.bucket !== meta.bucket ||
    cfg.r2.account_id !== meta.account
  )
    throw new Error("R2_DISABLED_OR_CHANGED");
  const mediaFile = metaFile.replace(/\.json$/, ".webm"),
    stat = await fs.stat(mediaFile);
  const key = recordingKey(meta);
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${cfg.r2.account_id}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: cfg.r2.access_key_id,
      secretAccessKey: cfg.r2.secret_access_key,
    },
  });
  try {
    const [existing] = await db.execute(
      "SELECT status FROM recordings WHERE id=?",
      [meta.id],
    );
    if (existing[0]?.status !== "ready") {
      await db.execute(
        `INSERT IGNORE INTO recordings(id,school_id,meeting_id,owner_id,object_key,bucket,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)`,
        [
          meta.id,
          meta.school_id,
          meta.meeting_id,
          meta.owner_id,
          key,
          meta.bucket,
          new Date(meta.expires_at),
          new Date(meta.created_at),
        ],
      );
      const data = await fs.readFile(mediaFile);
      await client.send(
        new PutObjectCommand({
          Bucket: meta.bucket,
          Key: key,
          Body: data,
          ContentType: "video/webm",
          ContentLength: stat.size,
        }),
      );
      const head = await client.send(
        new HeadObjectCommand({ Bucket: meta.bucket, Key: key }),
      );
      if (head.ContentLength !== stat.size || head.ContentType !== "video/webm")
        throw new Error("R2_VERIFY_FAILED");
      await db.execute(
        "UPDATE recordings SET status='ready',size_bytes=? WHERE id=? AND school_id=? AND object_key=?",
        [stat.size, meta.id, meta.school_id, key],
      );
    }
    await fs.unlink(mediaFile);
    await fs.unlink(metaFile);
  } finally {
    client.destroy();
  }
}
async function seal(id) {
  const partial = path.join(spool, id + ".partial"),
    final = path.join(spool, id + ".webm"),
    temporary = path.join(spool, id + ".remux.webm");
  // Rebuild WebM duration/cues so the stored video is seekable. Keep partial on failure.
  await run(
    "ffmpeg",
    ["-nostdin", "-v", "error", "-y", "-i", partial, "-c", "copy", temporary],
    { timeout: 60000 },
  );
  await fs.rename(temporary, final);
  await fs.unlink(partial);
}
async function retrySpool() {
  for (const name of await fs.readdir(spool)) {
    if (stopping) break;
    if (!/^[a-f0-9]{32}\.json$/.test(name)) continue;
    const id = name.slice(0, 32);
    if ([...active.values()].some((j) => j.current === id)) continue;
    const filename = path.join(spool, name);
    try {
      const meta = JSON.parse(await fs.readFile(filename, "utf8"));
      const [saved] = await db.execute(
        "SELECT status FROM recordings WHERE id=?",
        [meta.id],
      );
      if (saved[0]?.status === "ready") {
        for (const ext of [".webm", ".partial", ".remux.webm", ".json"])
          await fs.rm(path.join(spool, id + ext), { force: true });
        continue;
      }
      if (new Date(meta.expires_at).getTime() <= Date.now()) {
        for (const ext of [".json", ".partial", ".webm"])
          await fs.rm(path.join(spool, id + ext), { force: true });
        continue;
      }
      try {
        await fs.access(path.join(spool, id + ".webm"));
      } catch {
        await seal(id);
      }
      await upload(filename);
    } catch {
      console.error("RECORDER_SPOOL_RETRY_PENDING", id);
    }
  }
}
async function record(job, lease) {
  const leaseKey = `server-recording-lease:${job.school_id}:${job.meeting_id}`;
  const local = { current: "", failure: false };
  active.set(job.meeting_id, local);
  let browser,
    context,
    page,
    handle,
    started = false,
    lost = false;
  const sessions = new Set();
  const renew = setInterval(async () => {
    try {
      if (
        !(await redis.eval(renewScript, {
          keys: [leaseKey],
          arguments: [lease, String(leaseTTL)],
        }))
      )
        lost = true;
    } catch {
      lost = true;
    }
  }, 10000);
  async function newSegment() {
    const disk = await fs.statfs(spool);
    if (Number(disk.bavail) * Number(disk.bsize) < 1024 ** 3)
      throw new Error("SPOOL_DISK_LOW");
    const cfg = await settings();
    if (!cfg.r2?.enabled) throw new Error("R2_DISABLED");
    const id = randomBytes(16).toString("hex"),
      now = Date.now();
    const meta = {
      ...job,
      id,
      bucket: cfg.r2.bucket,
      account: cfg.r2.account_id,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + retentionDays(cfg) * 86400000).toISOString(),
    };
    local.current = id;
    await fs.writeFile(path.join(spool, id + ".json"), JSON.stringify(meta), {
      mode: 0o600,
      flag: "wx",
      flush: true,
    });
    handle = await fs.open(path.join(spool, id + ".partial"), "wx", 0o600);
  }
  async function finalize() {
    await handle?.sync();
    await handle?.close();
    handle = undefined;
    const id = local.current;
    await seal(id);
    local.current = "";
    // Upload retries run separately, keeping recording independent of R2 latency.
  }
  async function cloud(op, body) {
    const cfg = await settings(),
      [rows] = await db.execute(
        "SELECT provider_id,app_id FROM meeting_sfu_bindings WHERE school_id=? AND meeting_id=?",
        [job.school_id, job.meeting_id],
      );
    if (!rows[0]) throw new Error("SFU_NOT_YET_BOUND");
    const provider = pinnedProvider(cfg, rows[0]);
    let suffix = "new",
      method = "POST",
      payload;
    if (op !== "new") {
      if (!sessions.has(body.session_id))
        throw new Error("UNKNOWN_RECORDER_SESSION");
      suffix = encodeURIComponent(body.session_id);
      if (op === "tracks") {
        assertRemoteTracks(body.tracks, await publications(job));
        suffix += "/tracks/new";
        payload = { tracks: body.tracks };
      } else if (op === "renegotiate") {
        suffix += "/renegotiate";
        method = "PUT";
        payload = { sessionDescription: body.sessionDescription };
      } else throw new Error("RECORDER_RECEIVE_ONLY");
    }
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/apps/${encodeURIComponent(provider.app_id)}/sessions/${suffix}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${provider.secret}`,
          "Content-Type": "application/json",
        },
        body: payload ? JSON.stringify(payload) : undefined,
        signal: AbortSignal.timeout(25000),
      },
    );
    if (!response.ok) throw new Error("SFU_PROVIDER_REJECTED");
    const result = await response.json();
    if (op === "new") {
      if (sessions.size >= 4 || !result.sessionId)
        throw new Error("RECORDER_SESSION_LIMIT");
      sessions.add(result.sessionId);
    }
    return result;
  }
  try {
    await state(job, "starting");
    await newSegment();
    browser = await chromium.launch({
      headless: true,
      args: [
        "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage",
      ],
    });
    context = await browser.newContext();
    page = await context.newPage();
    await page.route("**/*", (route) =>
      route.request().url() === "http://localhost/recorder"
        ? route.fulfill({
            contentType: "text/html",
            body: "<!doctype html><title>Meet server recorder</title><style>video{display:none}body{margin:0}</style>",
          })
        : route.abort(),
    );
    await page.exposeFunction("recorderRPC", async (url, body) => {
      if (lost || stopping) throw new Error("RECORDER_LEASE_LOST");
      if (url === `/meetings/${job.meeting_id}/ice`) return { iceServers: [] };
      if (url === `/meetings/${job.meeting_id}/sfu`)
        return cloud(body.op, body);
      throw new Error("RECORDER_RECEIVE_ONLY");
    });
    await page.exposeFunction("recorderChunk", async (encoded) => {
      try {
        if (lost) throw new Error("RECORDER_LEASE_LOST");
        const data = Buffer.from(encoded, "base64");
        if (data.length > 16 * 1024 * 1024) throw new Error("CHUNK_TOO_LARGE");
        await handle.write(data);
        await handle.sync();
      } catch (e) {
        local.failure = true;
        throw e;
      }
    });
    await page.exposeFunction("recorderSegment", finalize);
    await page.exposeFunction("recorderOpen", newSegment);
    await page.goto("http://localhost/recorder");
    await page.addScriptTag({ content: bundle });
    await page.evaluate((id) => window.capture.start(id), job.meeting_id);
    started = true;
    let rotated = Date.now(),
      emptySince = 0,
      accounted = Date.now(),
      limited = false;
    const durationKey = `server-recording-duration:${job.school_id}:${job.meeting_id}`;
    let seconds = Number(await redis.get(durationKey)) || 0;
    while (!stopping && !lost) {
      if (local.failure) throw new Error("SPOOL_WRITE_FAILED");
      const [rows] = await db.execute(
        "SELECT status,recording_allowed FROM meetings WHERE school_id=? AND id=?",
        [job.school_id, job.meeting_id],
      );
      if (
        rows[0]?.status !== "live" ||
        !rows[0].recording_allowed ||
        !(await settings()).r2?.enabled
      )
        break;
      const list = await publications(job);
      const [inkRows] = await db.execute(
        "SELECT content FROM meeting_drawing_state WHERE school_id=? AND meeting_id=?",
        [job.school_id, job.meeting_id],
      );
      let ink = inkRows[0]?.content || null;
      if (typeof ink === "string") ink = JSON.parse(ink);
      if (ink?.active && ink.mode === "screen") {
        const target = list.find(
          (p) =>
            createHash("sha256")
              .update(p.session_id + ":" + p.track_name)
              .digest("hex") === ink.target,
        );
        if (target) ink.target_user = target.user_id;
        else ink.active = false;
      }
      await page.evaluate(({ list, ink }) => window.capture.tick(list, ink), {
        list,
        ink,
      });
      const [participants] = await db.execute(
        "SELECT COUNT(*) AS n FROM presence WHERE school_id=? AND meeting_id=? AND online=TRUE AND last_seen>=UTC_TIMESTAMP()-INTERVAL 45 SECOND",
        [job.school_id, job.meeting_id],
      );
      emptySince = Number(participants[0].n) ? 0 : emptySince || Date.now();
      const elapsed = Math.floor((Date.now() - accounted) / 1000);
      if (elapsed) {
        accounted += elapsed * 1000;
        seconds = await redis.incrBy(durationKey, elapsed);
      }
      const reason = recordingStopReason(
        Number(participants[0].n),
        emptySince,
        seconds,
      );
      limited = reason === "limit";
      if (reason) break;
      await state(job, list.length ? "recording" : "waiting");
      if (Date.now() - rotated >= 300000) {
        await page.evaluate(() => window.capture.rotate());
        rotated = Date.now();
      }
      await sleep(3000);
    }
    await state(job, "saving");
    if (started && !lost) await page.evaluate(() => window.capture.stop());
    await state(job, lost ? "interrupted" : limited ? "limit" : "complete");
  } catch {
    if (started && !lost)
      await page?.evaluate(() => window.capture.stop()).catch(() => {});
    await state(
      job,
      "error",
      "Bộ ghi gián đoạn; tự thử lại. Kiểm tra SFU, R2 và dung lượng VPS.",
    ).catch(() => {});
    await redis
      .set(`server-recording-cooldown:${job.meeting_id}`, "1", { EX: 30 })
      .catch(() => {});
    console.error("RECORDER_JOB_RETRY", job.meeting_id);
  } finally {
    clearInterval(renew);
    await handle?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    // Remove only empty files from failed startup; never discard recorded bytes.
    if (local.current) {
      const f = path.join(spool, local.current + ".partial");
      const s = await fs.stat(f).catch(() => null);
      if (s?.size === 0) {
        await fs.rm(f, { force: true });
        await fs.rm(path.join(spool, local.current + ".json"), { force: true });
      }
    }
    active.delete(job.meeting_id);
    await redis
      .eval(releaseScript, { keys: [leaseKey], arguments: [lease] })
      .catch(() => {});
  }
}
let retrying = false;
while (!stopping) {
  try {
    await redis.set("server-recorder:seen", String(Date.now()), { EX: 30 });
    if (!retrying) {
      retrying = true;
      retrySpool()
        .catch(() => {})
        .finally(() => {
          retrying = false;
        });
    }
    const cfg = await settings();
    if (cfg.r2?.enabled && active.size < concurrency) {
      const [jobs] = await db.execute(
        `SELECT m.id AS meeting_id,m.school_id,c.teacher_id AS owner_id FROM meetings m JOIN meeting_teaching_windows tw ON tw.school_id=m.school_id AND tw.meeting_id=m.id AND tw.started_at IS NOT NULL AND tw.ended_at IS NULL JOIN courses c ON c.id=m.course_id AND c.school_id=m.school_id WHERE m.status='live' AND m.recording_allowed=TRUE AND c.teacher_id IS NOT NULL ORDER BY m.starts_at LIMIT 200`,
      );
      for (const job of jobs) {
        if (active.size >= concurrency) break;
        if (
          active.has(job.meeting_id) ||
          Number(
            await redis.get(
              `server-recording-duration:${job.school_id}:${job.meeting_id}`,
            ),
          ) >=
            8 * 3600 ||
          (await redis.exists(`server-recording-cooldown:${job.meeting_id}`))
        )
          continue;
        const lease = randomBytes(24).toString("hex"),
          key = `server-recording-lease:${job.school_id}:${job.meeting_id}`;
        if (await redis.set(key, lease, { NX: true, EX: leaseTTL }))
          void record(job, lease);
      }
    }
  } catch {
    console.error("RECORDER_POLL_RETRY");
  }
  await sleep(5000);
}
while (active.size || retrying) await sleep(500);
await db.end();
await redis.quit();
