import { afterEach, expect, it, vi } from "vitest";
import { ClassroomMedia, gather, classroomIceServers } from "./media";
afterEach(() => vi.unstubAllGlobals());
it("switches camera devices without unmuting the camera or restarting other media", async () => {
  const old = { id: "old", kind: "video", enabled: false, stop: vi.fn() },
    next = { id: "next", kind: "video", enabled: true, stop: vi.fn() };
  let tracks: any[] = [old];
  const local = {
    getTracks: () => tracks,
    removeTrack: (t: any) => {
      tracks = tracks.filter((x) => x !== t);
    },
    addTrack: (t: any) => tracks.push(t),
  };
  const sender = { track: old, replaceTrack: vi.fn(async () => {}) };
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [next] })),
    },
  });
  const media = new ClassroomMedia("lesson", () => {});
  Object.assign(media, { local, peers: [{ getSenders: () => [sender] }] });
  await media.changeDevice("video", "camera-two");
  expect(next.enabled).toBe(false);
  expect(old.stop).toHaveBeenCalledOnce();
  expect(sender.replaceTrack).toHaveBeenCalledWith(next);
  expect(local.getTracks()).toEqual([next]);
});
it("rebuilds failed connections without stopping local devices or enabling muted tracks", async () => {
  const camera = { kind: "video", enabled: false, stop: vi.fn() },
    stream = { getTracks: () => [camera] };
  const removed = vi.fn(),
    status = vi.fn(),
    closed = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })),
  );
  const media = new ClassroomMedia("lesson", () => {}, removed, status);
  Object.assign(media, {
    local: stream,
    peers: [{ connectionState: "failed", close: closed }],
    remoteStreams: new Map([["other", { getTracks: () => [] }]]),
  });
  const publish = vi
    .spyOn(media as any, "publishInternal")
    .mockResolvedValue(undefined);
  await media.recover();
  expect(closed).toHaveBeenCalledOnce();
  expect(camera.stop).not.toHaveBeenCalled();
  expect(camera.enabled).toBe(false);
  expect(publish).toHaveBeenCalledWith(stream);
  expect(removed).toHaveBeenCalledWith("other");
  expect(status).toHaveBeenLastCalledWith("Đã kết nối lại");
});
it("serializes media mutations across the offer and answer exchange", async () => {
  const media = new ClassroomMedia("lesson", () => {});
  let release!: () => void;
  vi.spyOn(media as any, "publishInternal").mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const subscribe = vi
    .spyOn(media as any, "subscribeInternal")
    .mockResolvedValue(undefined);
  const publishing = media.publish({} as MediaStream),
    subscribing = media.subscribe([], "self");
  await Promise.resolve();
  expect(subscribe).not.toHaveBeenCalled();
  release();
  await publishing;
  await subscribing;
  expect(subscribe).toHaveBeenCalledOnce();
});
it("backs off failed recovery attempts instead of allocating sessions in a tight loop", async () => {
  const fetcher = vi.fn(async () => {
    throw new Error("offline");
  });
  vi.stubGlobal("fetch", fetcher);
  const media = new ClassroomMedia("lesson", () => {});
  await expect(media.recover(true)).rejects.toThrow("offline");
  await media.recover(true);
  expect(fetcher).toHaveBeenCalledOnce();
});
it("stops replaced screen captures and releases devices when leaving", async () => {
  const camera = { kind: "video", stop: vi.fn() },
    first = { kind: "video", stop: vi.fn(), onended: null },
    second = { kind: "video", stop: vi.fn(), onended: null };
  const stream = (track: any) => ({
    getTracks: () => [track],
    getVideoTracks: () => [track],
  });
  const sender = {
    track: camera as any,
    replaceTrack: vi.fn(async (track: any) => {
      sender.track = track;
    }),
  };
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getDisplayMedia: vi
        .fn()
        .mockResolvedValueOnce(stream(first))
        .mockResolvedValueOnce(stream(second)),
    },
  });
  const media = new ClassroomMedia("meeting", () => {});
  (media as any).local = stream(camera);
  (media as any).peers = [{ getSenders: () => [sender], close: vi.fn() }];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })),
  );
  const publish = vi
    .spyOn(media as any, "publishInternal")
    .mockImplementation(async (s: any, presentation: any) => {
      expect(presentation).toBe(true);
      const pc = {
        getSenders: () => s.getTracks().map((track: any) => ({ track })),
        close: vi.fn(),
      };
      (media as any).peers.push(pc);
      (media as any).sessionIDs.set(pc, "screen-session");
    });
  await media.share();
  expect(first.stop).not.toHaveBeenCalled();
  await media.share();
  expect(first.stop).toHaveBeenCalledOnce();
  expect(sender.track).toBe(camera);
  expect(camera.stop).not.toHaveBeenCalled();
  await media.share();
  expect(publish).toHaveBeenCalledTimes(2);
  media.close();
  expect(second.stop).toHaveBeenCalled();
  expect(camera.stop).toHaveBeenCalled();
});

it("does not negotiate an empty publisher when joining listen-only", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const media = new ClassroomMedia("lesson", () => {});
  await media.publish({ getTracks: () => [] } as unknown as MediaStream);
  expect(fetcher).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it("merges remote microphone and camera into one participant stream", async () => {
  class Stream {
    tracks: any[] = [];
    constructor(tracks: any[] = []) {
      this.tracks = [...tracks];
    }
    getTracks() {
      return [...this.tracks];
    }
    addTrack(t: any) {
      this.tracks.push(t);
    }
    removeTrack(t: any) {
      this.tracks = this.tracks.filter((x) => x !== t);
    }
  }
  let pc: any;
  class Peer {
    ontrack: any;
    constructor() {
      pc = this;
    }
    getSenders() {
      return [];
    }
    close() {}
  }
  vi.stubGlobal("MediaStream", Stream);
  vi.stubGlobal("RTCPeerConnection", Peer);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options) => {
      const body = options?.body ? JSON.parse(options.body) : {};
      return {
        ok: true,
        json: async () =>
          body.op === "new"
            ? { sessionId: "receiver" }
            : body.op === "tracks"
              ? { tracks: [{ mid: "0" }, { mid: "1" }, { mid: "2" }] }
              : { iceServers: [] },
      };
    }),
  );
  const received = vi.fn(),
    media = new ClassroomMedia("lesson", received);
  await media.subscribe(
    [
      {
        session_id: "sender",
        track_name: "audio",
        user_id: "teacher",
        name: "Thầy A",
      },
      {
        session_id: "sender",
        track_name: "video",
        user_id: "teacher",
        name: "Thầy A",
      },
      {
        session_id: "screen-sender",
        track_name: "screen-video-test",
        user_id: "teacher",
        name: "Thầy A",
      },
    ],
    "student",
  );
  pc.ontrack({
    transceiver: { mid: "0" },
    track: { id: "a", kind: "audio", stop: vi.fn() },
  });
  pc.ontrack({
    transceiver: { mid: "1" },
    track: { id: "v", kind: "video", stop: vi.fn() },
  });
  expect(received.mock.lastCall?.[0]).toBe("teacher");
  expect(received.mock.lastCall?.[1].getTracks()).toHaveLength(2);
  pc.ontrack({
    transceiver: { mid: "2" },
    track: { id: "s", kind: "video", stop: vi.fn() },
  });
  expect(received.mock.lastCall?.[0]).toBe("teacher:screen");
  expect(received.mock.lastCall?.[1].getTracks()).toHaveLength(1);
  expect((media as any).remoteStreams.get("teacher").getTracks()).toHaveLength(
    2,
  );
  media.close();
});

it("uses gathered candidates when STUN stalls, but rejects a completely empty ICE offer", async () => {
  vi.useFakeTimers();
  try {
    const pc: any = {
      iceGatheringState: "gathering",
      localDescription: {
        sdp: "v=0\r\na=candidate:1 1 udp 2122260223 192.0.2.1 1234 typ host\r\n",
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const pending = gather(pc);
    await vi.advanceTimersByTimeAsync(10000);
    await expect(pending).resolves.toBeUndefined();
    expect(pc.removeEventListener).toHaveBeenCalled();
    pc.localDescription = { sdp: "v=0\r\n" };
    const empty = gather(pc);
    const assertion = expect(empty).rejects.toThrow("TURN");
    await vi.advanceTimersByTimeAsync(10000);
    await assertion;
  } finally {
    vi.useRealTimers();
  }
});

it("does not stall direct SFU calls on STUN-only pools, and preserves authenticated TURN pools", () => {
  expect(
    classroomIceServers([{ urls: "stun:stun.cloudflare.com:3478" }]),
  ).toEqual([]);
  const pool = [
    {
      urls: ["stun:stun.cloudflare.com:3478", "turns:turn.cloudflare.com:5349"],
      username: "ephemeral",
      credential: "ephemeral-secret",
    },
  ];
  expect(classroomIceServers(pool)).toBe(pool);
});
