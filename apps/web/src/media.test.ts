import { afterEach, expect, it, vi } from "vitest";
import { ClassroomMedia } from "./media";
afterEach(() => vi.unstubAllGlobals());
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
  await media.share();
  expect(first.stop).not.toHaveBeenCalled();
  await media.share();
  expect(first.stop).toHaveBeenCalledOnce();
  expect(sender.track).toBe(second);
  media.close();
  expect(second.stop).toHaveBeenCalled();
  expect(camera.stop).toHaveBeenCalled();
});
