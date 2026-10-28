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
