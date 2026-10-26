import { useEffect, useState } from "react";
export function RoomDevices({
  onInput,
  onOutput,
  refreshKey,
  expanded = false,
}: {
  onInput: (kind: "audio" | "video", id: string) => Promise<void>;
  onOutput: (id: string) => Promise<void>;
  refreshKey?: string;
  expanded?: boolean;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function reload() {
    try {
      setDevices((await navigator.mediaDevices?.enumerateDevices?.()) || []);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void reload();
    navigator.mediaDevices?.addEventListener?.("devicechange", reload);
    return () =>
      navigator.mediaDevices?.removeEventListener?.("devicechange", reload);
  }, [refreshKey]);
  const select = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="room-device-settings" open={expanded || undefined}>
      <summary>Thiết bị âm thanh & hình ảnh</summary>
      <div className="device-options">
        {[
          ["audioinput", "Micro", "audio"],
          ["videoinput", "Camera", "video"],
          ["audiooutput", "Loa / tai nghe", "output"],
        ].map(([kind, label, type]) => (
          <label key={kind}>
            {label}
            <select
              disabled={
                busy ||
                (type === "output" &&
                  !("setSinkId" in HTMLMediaElement.prototype))
              }
              defaultValue=""
              onChange={(e) =>
                void select(() =>
                  type === "output"
                    ? onOutput(e.target.value)
                    : onInput(type as "audio" | "video", e.target.value),
                )
              }
            >
              <option value="">Mặc định hệ thống</option>
              {devices
                .filter((d) => d.kind === kind && d.deviceId !== "default")
                .map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `${label} ${i + 1}`}
                  </option>
                ))}
            </select>
          </label>
        ))}
      </div>
      <button
        className="secondary"
        onClick={() => void reload()}
        disabled={busy}
      >
        Làm mới thiết bị
      </button>
      <p>
        Nếu chưa có tên thiết bị, đóng cài đặt rồi bật mic/camera để cấp quyền. Chọn loa
        phụ thuộc trình duyệt.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
