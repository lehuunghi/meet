import { afterEach, expect, it, vi } from "vitest";
import { captureDevices } from "./devices";
afterEach(() => vi.unstubAllGlobals());
it("falls back to microphone when the selected camera does not exist", async () => {
  const error = new Error("missing");
  error.name = "NotFoundError";
  const stream = { getTracks: () => [] };
  const getUserMedia = vi
    .fn()
    .mockRejectedValueOnce(error)
    .mockResolvedValueOnce(stream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  expect(await captureDevices(true, true)).toBe(stream);
  expect(getUserMedia.mock.calls[1][0]).toEqual({ audio: true, video: false });
});
it("explains denied permission and does not repeatedly request devices", async () => {
  const error = new Error("denied");
  error.name = "NotAllowedError";
  const getUserMedia = vi.fn().mockRejectedValue(error);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  await expect(captureDevices(true, true)).rejects.toThrow("đang bị chặn");
  expect(getUserMedia).toHaveBeenCalledOnce();
});
it("listen-only never requests access to microphone or camera", async () => {
  const getUserMedia = vi.fn();
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("MediaStream", class {});
  await captureDevices(false, false);
  expect(getUserMedia).not.toHaveBeenCalled();
});
