import { uiText } from "./ui-language";
import { submittingForm } from "./form-guard-core";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  signal?: AbortSignal,
): Promise<T> {
  const finish = method !== "GET" ? submittingForm() : () => {};
  try {
    const res = await fetch("/api" + path, {
      method,
      credentials: "same-origin",
      ...(signal ? { signal } : {}),
      headers:
        body instanceof FormData ? {} : { "Content-Type": "application/json" },
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
    });
    if (
      !res.ok &&
      res.status === 401 &&
      path !== "/login" &&
      !path.startsWith("/setup")
    )
      window.dispatchEvent(new Event("meet-session-ended"));
    let data: any;
    try {
      data = await res.json();
    } catch {
      throw new ApiError(
        uiText("Máy chủ chưa phản hồi hợp lệ. Vui lòng thử lại."),
        res.ok ? 502 : res.status,
      );
    }
    if (!res.ok) {
      throw new ApiError(
        uiText(
          typeof data?.error === "string" ? data.error : "Yêu cầu thất bại",
        ),
        res.status,
      );
    }
    const next = res.headers?.get("X-Next-Page") ?? null;
    if (
      method === "GET" &&
      next !== null &&
      /^\d+$/.test(next) &&
      Array.isArray(data)
    ) {
      const url = new URL(path, window.location.origin);
      const previous = Number(url.searchParams.get("page") || 0);
      if (Number(next) <= previous)
        throw new ApiError("Trang dữ liệu không hợp lệ", 502);
      url.searchParams.set("page", next);
      const more = await api<any[]>(
        url.pathname + url.search,
        undefined,
        "GET",
        signal,
      );
      data = [...data, ...more];
    }
    finish(true);
    return data;
  } catch (error) {
    finish(false);
    throw error;
  }
}
