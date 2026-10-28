import { afterEach, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { drawingRequest, retryDrawing } from "./drawing-request";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("retries transport and capacity errors but never permission or stale-page failures", () => {
  for (const status of [408, 429, 500, 502, 503])
    expect(retryDrawing(new ApiError("temporary", status))).toBe(true);
  for (const status of [400, 401, 403, 404, 409, 413])
    expect(retryDrawing(new ApiError("permanent", status))).toBe(false);
  expect(retryDrawing(new TypeError("network"))).toBe(true);
});
it("aborts a stalled drawing request instead of keeping the queue locked forever", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, options) =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener("abort", () =>
            reject(new DOMException("Timed out", "AbortError")),
          ),
        ),
    ),
  );
  const assertion = expect(
    drawingRequest("/meetings/net/drawing"),
  ).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(15000);
  await assertion;
});
