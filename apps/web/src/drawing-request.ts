import { api, ApiError } from "./api";
export function retryDrawing(error: unknown) {
  return (
    !(error instanceof ApiError) ||
    [408, 425, 429].includes(error.status) ||
    error.status >= 500
  );
}
export async function drawingRequest<T>(
  path: string,
  body?: unknown,
): Promise<T> {
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 15000);
  try {
    return await api<T>(
      path,
      body,
      body === undefined ? "GET" : "POST",
      controller.signal,
    );
  } finally {
    clearTimeout(timeout);
  }
}
