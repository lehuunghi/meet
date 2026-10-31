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
export const microphoneConstraints=(id?:string):MediaTrackConstraints=>({echoCancellation:true,noiseSuppression:true,autoGainControl:true,...(id?{deviceId:{exact:id}}:{})});
export const cameraConstraints=(id?:string):MediaTrackConstraints=>({width:{ideal:640},height:{ideal:360},frameRate:{ideal:15,max:30},...(id?{deviceId:{exact:id}}:{})});
export async function captureDevices(
  mic: boolean,
  camera: boolean,
  devices: { audio?: string; video?: string } = {},
): Promise<MediaStream> {
  if (!mic && !camera) return new MediaStream();
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error(
      "Trình duyệt chưa hỗ trợ camera/micro hoặc trang chưa được mở qua HTTPS. Có thể chọn vào lớp không dùng camera/micro.",
    );
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: mic ? microphoneConstraints(devices.audio) : false,
      video: camera ? cameraConstraints(devices.video) : false,
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
        { audio: microphoneConstraints(devices.audio), video: false },
        { audio: false, video: cameraConstraints(devices.video) },
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
