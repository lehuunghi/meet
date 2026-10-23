import { afterEach, expect, it, vi } from "vitest";
import { api } from "./api";
afterEach(() => vi.unstubAllGlobals());
it("sends cookie-based requests without exposing credentials", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ id: "u" }) });
  vi.stubGlobal("fetch", fetch);
  expect(await api("/me")).toEqual({ id: "u" });
  expect(fetch.mock.calls[0][1].credentials).toBe("same-origin");
});
it("surfaces API failure and rejects unsuccessful requests", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Forbidden" }),
      }),
  );
  await expect(api("/meetings/x")).rejects.toThrow("Forbidden");
});
