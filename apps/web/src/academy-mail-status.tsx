import { useEffect, useState } from "react";
import { api } from "./api";
export function AcademyMailStatus({ demo = false }: { demo?: boolean }) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    if (!demo) setData(await api("/academy/mail-status"));
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [demo]);
  return (
    <section className="academy-mail-status">
      <h3>Email xác thực thành viên</h3>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <p>
            {data.smtp_configured
              ? "Đã có cấu hình gửi email."
              : "Chưa có cấu hình gửi email. Điền thông tin máy chủ thư bên dưới để gửi liên kết xác thực."}{" "}
            Đang chờ: {data.pending || 0} · Cần thử lại: {data.failed || 0}.
          </p>
          <p>
            Hệ thống tự thử lại thư chưa gửi sau 5 phút. Liên kết có hiệu lực 24
            giờ.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void load().catch((e) => setError(e.message))}
          >
            Tải lại trạng thái email
          </button>
          <button
            type="button"
            disabled={busy || !data.pending || !data.smtp_configured}
            onClick={() => {
              setBusy(true);
              setError("");
              void api("/academy/mail-status", {})
                .then(load)
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            Thử gửi lại email đang chờ
          </button>
        </>
      )}
    </section>
  );
}
