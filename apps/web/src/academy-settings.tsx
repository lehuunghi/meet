import { AcademyMailStatus } from "./academy-mail-status";
import { useEffect, useState, useRef } from "react";
import { api } from "./api";
import { confirmFormReload, markFormClean } from "./form-guard-core";

export function AcademySettings({ demo }: { demo: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setData(
      demo
        ? { settings: { free_videos: 4 }, revision: 0, secrets: {} }
        : await api("/academy/settings"),
    );
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [demo]);
  useEffect(() => {
    if (data) {
      formRef.current?.reset();
      markFormClean(formRef.current);
    }
  }, [data]);
  if (!data) return <section>{error || "Đang tải cấu hình…"}</section>;
  const field = (name: string, label: string, type = "text") => (
    <label key={name}>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={data.settings[name] || ""}
        placeholder={
          data.secrets?.[name] ? "Đã lưu; để trống để giữ nguyên" : ""
        }
        autoComplete={type === "password" ? "new-password" : "off"}
      />
    </label>
  );
  return (
    <section className="academy-section">
      <h2>Email & thanh toán</h2>
      <AcademyMailStatus demo={demo} />
      <p>
        Cấu hình kinh doanh chỉ quản lý trên website này. Cấu hình SFU, R2, VPS
        và nâng cấp do quản trị hạ tầng quản lý riêng.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <form
        ref={formRef}
        className="academy-settings-form"
        key={data.revision}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setNotice("");
          try {
            if (demo) {
              setNotice("Bản mẫu không lưu cấu hình thật.");
              return;
            }
            const settings: any = Object.fromEntries(
              new FormData(e.currentTarget),
            );
            settings.free_videos = Number(settings.free_videos);
            await api("/academy/settings", {
              settings,
              revision: data.revision,
            });
            await load();
            setNotice("Đã lưu và áp dụng trên website.");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h3>Học thử</h3>
        <label>
          Số bài học miễn phí mỗi tháng
          <input
            name="free_videos"
            type="number"
            min="1"
            max="100"
            required
            defaultValue={data.settings.free_videos || 4}
          />
        </label>
        <h3>Email xác thực</h3>
        {field("smtp_address", "SMTP host:587 (STARTTLS)")}
        {field("smtp_from", "Email gửi", "email")}
        {field("smtp_user", "Tên đăng nhập SMTP")}
        {field("smtp_password", "Mật khẩu SMTP", "password")}
        <h3>Chuyển khoản / QR</h3>
        {field("bank_bin", "Mã BIN ngân hàng")}
        {field("bank_account", "Số tài khoản")}
        {field("bank_name", "Tên người nhận")}
        <h3>Thanh toán tự động payOS</h3>
        {field("client_id", "Client ID")}
        {field("api_key", "API key", "password")}
        {field("checksum_key", "Checksum key", "password")}
        <p>
          Webhook: <code>{location.origin}/api/academy/webhooks/payos</code>
        </p>
        <p>
          Khóa bí mật không hiển thị lại; để trống để giữ nguyên. Chỉ tài khoản
          có quyền Tài chính / VIP được lưu.
        </p>
        <button disabled={busy}>{busy ? "Đang lưu…" : "Lưu cài đặt"}</button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (confirmFormReload(formRef.current))
              void load().catch((e) => setError(e.message));
          }}
        >
          Tải lại
        </button>
      </form>
    </section>
  );
}
