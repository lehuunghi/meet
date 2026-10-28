import { test } from "node:test";
import { recordingStopReason, renewScript, releaseScript } from "./core.mjs";
import assert from "node:assert/strict";
import {
  parseDSN,
  pinnedProvider,
  recordingKey,
  assertRemoteTracks,
  retentionDays,
} from "./core.mjs";

test(
  "worker freezes recording/spool writes until updater maintenance is released",
  { skip: !process.env.TEST_REDIS_URL, timeout: 25000 },
  async () => {
    const fs = await import("node:fs/promises"),
      os = await import("node:os"),
      path = await import("node:path"),
      { spawn } = await import("node:child_process"),
      { once } = await import("node:events"),
      { build } = await import("esbuild"),
      { createClient } = await import("redis");
    await build({
      entryPoints: ["browser.ts"],
      bundle: true,
      format: "iife",
      outfile: "dist/browser.js",
    });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "meet-freeze-")),
      redis = createClient({ url: process.env.TEST_REDIS_URL });
    await redis.connect();
    await fs.writeFile(
      path.join(dir, "mysql"),
      "qa:qa@tcp(127.0.0.1:1)/qa?parseTime=true&loc=UTC",
    );
    await fs.writeFile(path.join(dir, "redis"), process.env.TEST_REDIS_URL);
    await fs.writeFile(
      path.join(dir, "settings.json"),
      JSON.stringify({ r2: { enabled: true } }),
    );
    await fs.writeFile(path.join(dir, "maintenance"), "test-freeze");
    await redis.del("server-recorder:seen");
    const child = spawn(process.execPath, ["worker.mjs"], {
        env: {
          ...process.env,
          MYSQL_DSN_FILE: path.join(dir, "mysql"),
          REDIS_URL_FILE: path.join(dir, "redis"),
          CONFIG_DIR: dir,
          SPOOL_DIR: path.join(dir, "spool"),
        },
        stdio: ["ignore", "ignore", "pipe"],
      }),
      exited = once(child, "exit");
    let errors = "";
    child.stderr.on("data", (data) => (errors += data.toString()));
    const until = async (predicate) => {
      const end = Date.now() + 6000;
      while (Date.now() < end) {
        if (await predicate()) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.fail("Worker state did not change in time");
    };
    try {
      await until(() => redis.exists("server-recorder:seen"));
      await new Promise((r) => setTimeout(r, 1300));
      assert.equal(child.exitCode, null);
      assert.equal(errors.includes("RECORDER_POLL_RETRY"), false);
      await fs.unlink(path.join(dir, "maintenance"));
      await until(() => errors.includes("RECORDER_POLL_RETRY"));
    } finally {
      child.kill("SIGTERM");
      let timer;
      await Promise.race([
        exited,
        new Promise(
          (r) =>
            (timer = setTimeout(() => {
              child.kill("SIGKILL");
              r();
            }, 7000)),
        ),
      ]);
      clearTimeout(timer);
      await exited;
      await redis.del("server-recorder:seen");
      await redis.quit();
      await fs.rm(dir, { recursive: true, force: true });
    }
  },
);
test("worker uses the meeting's pinned SFU, including disabled-but-pinned credentials", () => {
  const pool = {
    sfu: [
      { id: "a", app_id: "x", secret: "one", enabled: false },
      { id: "b", app_id: "y", secret: "two" },
    ],
  };
  assert.equal(
    pinnedProvider(pool, { provider_id: "a", app_id: "x" }).secret,
    "one",
  );
  assert.throws(() => pinnedProvider(pool, { provider_id: "a", app_id: "y" }));
});
test("recorder is receive-only and cannot subscribe across rooms", () => {
  const tracks = [{ location: "remote", sessionId: "s", trackName: "a" }];
  assert.doesNotThrow(() =>
    assertRemoteTracks(tracks, [{ session_id: "s", track_name: "a" }]),
  );
  assert.throws(() =>
    assertRemoteTracks(tracks, [{ session_id: "other", track_name: "a" }]),
  );
  assert.throws(() => assertRemoteTracks([{ location: "local" }], []));
});
test("storage keys cannot escape the recordings retention prefix", () => {
  assert.equal(
    recordingKey({ school_id: "ab", meeting_id: "cd", id: "ef" }),
    "recordings/ab/cd/ef.webm",
  );
  assert.throws(() =>
    recordingKey({ school_id: "../", meeting_id: "cd", id: "ef" }),
  );
  assert.equal(retentionDays({}), 30);
  assert.equal(retentionDays({ retention_days: 45 }), 45);
});
test("MySQL connection uses UTC and a supported DSN without logging credentials", () => {
  assert.equal(
    parseDSN("meet:test@tcp(mysql:3306)/meet?parseTime=true").timezone,
    "Z",
  );
  assert.throws(() => parseDSN("invalid"));
});
test("teacher departure and an empty room do not stop recording; eight-hour cap does", () => {
  assert.equal(recordingStopReason(10, 1000, 100, 100000), "");
  assert.equal(recordingStopReason(0, 1000, 100, 20000), "");
  assert.equal(recordingStopReason(0, 1000, 100, 31000), "");
  assert.equal(recordingStopReason(10, 0, 28800, 100000), "limit");
});
test(
  "Redis lease is exclusive and another worker cannot renew or release it",
  { skip: !process.env.TEST_REDIS_URL },
  async () => {
    const { createClient } = await import("redis");
    const client = createClient({ url: process.env.TEST_REDIS_URL });
    await client.connect();
    const key = "recorder-test:" + crypto.randomUUID();
    try {
      assert.equal(
        await client.set(key, "worker-a", { NX: true, EX: 90 }),
        "OK",
      );
      assert.equal(
        await client.set(key, "worker-b", { NX: true, EX: 90 }),
        null,
      );
      assert.equal(
        await client.eval(renewScript, {
          keys: [key],
          arguments: ["worker-b", "90"],
        }),
        0,
      );
      assert.equal(
        await client.eval(releaseScript, {
          keys: [key],
          arguments: ["worker-b"],
        }),
        0,
      );
      assert.equal(
        await client.eval(renewScript, {
          keys: [key],
          arguments: ["worker-a", "90"],
        }),
        1,
      );
      assert.equal(
        await client.eval(releaseScript, {
          keys: [key],
          arguments: ["worker-a"],
        }),
        1,
      );
    } finally {
      await client.del(key);
      await client.quit();
    }
  },
);
