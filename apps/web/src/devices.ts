export function deviceError(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError")
    return "Camera/micro đang bị chặn. Bấm biểu tượng quyền cạnh địa chỉ trang để cho phép, hoặc chọn vào lớp không dùng camera/micro.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError")
    return "Không tìm thấy camera hoặc micro phù hợp. Kiểm tra thiết bị, hoặc chọn vào lớp không dùng camera/micro.";
  if (name === "NotReadableError" || name === "TrackStartError")
    return "Không mở được camera/micro. Thiết bị có thể đang được ứng dụng khác sử dụng; đóng ứng dụng đó hoặc vào lớp không dùng thiết bị.";
  return error instanceof Error ? error.message : "Không mở được camera/micro";
}
export async function captureDevices(
  mic: boolean,
  camera: boolean,
): Promise<MediaStream> {
  if (!mic && !camera) return new MediaStream();
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error(
      "Trình duyệt chưa hỗ trợ camera/micro hoặc trang chưa được mở qua HTTPS. Có thể chọn vào lớp không dùng camera/micro.",
    );
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: mic,
      video: camera ? { width: 640, height: 360 } : false,
    });
  } catch (e) {
    // A missing camera must not prevent a working microphone from joining.
    if (
      mic &&
      camera &&
      e instanceof Error &&
      ["NotFoundError", "OverconstrainedError"].includes(e.name)
    ) {
      for (const request of [
        { audio: true, video: false },
        { audio: false, video: true },
      ]) {
        try {
          return await navigator.mediaDevices.getUserMedia(request);
        } catch (next) {
          if (next instanceof Error && next.name === "NotAllowedError")
            throw new Error(deviceError(next));
        }
      }
    }
    throw new Error(deviceError(e));
  }
}
