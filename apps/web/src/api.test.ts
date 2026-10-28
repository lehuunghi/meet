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
    vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Forbidden" }),
    }),
  );
  await expect(api("/meetings/x")).rejects.toThrow("Forbidden");
});

it("keeps the HTTP status when a gateway returns HTML instead of JSON", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => {
        throw new SyntaxError("HTML");
      },
    }),
  );
  await expect(api("/meetings/x/drawing")).rejects.toMatchObject({
    status: 503,
  });
});

it("passes cancellation through to fetch", async () => {
  const signal = new AbortController().signal,
    fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetch);
  await api("/me", undefined, "GET", signal);
  expect(fetch.mock.calls[0][1].signal).toBe(signal);
});
