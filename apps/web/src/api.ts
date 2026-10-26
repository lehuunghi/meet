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
): Promise<T> {
  const finish = method !== "GET" ? submittingForm() : () => {};
  try {
    const res = await fetch("/api" + path, {
      method,
      credentials: "same-origin",
      headers:
        body instanceof FormData ? {} : { "Content-Type": "application/json" },
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401 && path !== "/login" && !path.startsWith("/setup"))
        window.dispatchEvent(new Event("meet-session-ended"));
      throw new ApiError(data.error || "Yêu cầu thất bại", res.status);
    }
    finish(true);
    return data;
  } catch (error) {
    finish(false);
    throw error;
  }
}
