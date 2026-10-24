import { useEffect, useState } from "react";
import { api } from "./api";
export function AccountSecurity({ demo }: { demo: boolean }) {
  const [profile, setProfile] = useState<any>({}),
    [pending, setPending] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (demo) {
      setProfile({
        short_id: "QT0001",
        name: "Quản trị trường",
        email: "admin@example.test",
        school_name: "Trường Nguyễn Trãi",
        role: "admin",
        active: 1,
        two_factor: 0,
      });
      return;
    }
    api<any[]>("/profile")
      .then((v) => setProfile(v[0]))
      .catch((e) => setError(e.message));
  }, [demo]);
  return (
    <section className="section">
      <h2>Thông tin tài khoản</h2>
      <p>Thông tin chỉ xem. Liên hệ quản trị trường nếu cần điều chỉnh.</p>
      <dl>
        {[
          ["ID", profile.short_id],
          ["Họ tên", profile.name],
          ["Email", profile.email],
          ["Mã SV", profile.student_code],
          ["Trường", profile.school_name],
          ["Vai trò", profile.role],
          ["Trạng thái", profile.active ? "Đang hoạt động" : "Tạm ngưng"],
        ].map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v || "—"}</dd>
          </div>
        ))}
      </dl>
      <h2>Xác thực hai bước (tùy chọn)</h2>
      <p>
        {profile.two_factor ? "Đã bật" : "Chưa bật"}. Dùng ứng dụng xác thực
        TOTP. Giữ khóa thiết lập tại nơi an toàn để khôi phục trên thiết bị
        khác.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form
        className="inline-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const f = new FormData(e.currentTarget);
          try {
            const action = profile.two_factor
              ? "disable"
              : pending
                ? "enable"
                : "setup";
            const v = await api("/2fa", {
              action,
              password: f.get("password"),
              code: f.get("code") || "",
            });
            if (action === "setup") setPending(v.secret);
            else location.href = "/";
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Mật khẩu hiện tại
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        {pending && (
          <p>
            Nhập khóa này vào ứng dụng xác thực (hết hạn sau 5 phút):{" "}
            <code style={{ overflowWrap: "anywhere" }}>{pending}</code>
          </p>
        )}
        {(pending || profile.two_factor) && (
          <label>
            Mã xác thực 6 số
            <input
              name="code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              autoComplete="one-time-code"
              required
            />
          </label>
        )}
        <button disabled={busy || demo}>
          {profile.two_factor
            ? "Tắt 2FA"
            : pending
              ? "Xác nhận bật 2FA"
              : "Thiết lập 2FA"}
        </button>
      </form>
      <p>
        Sau khi bật hoặc tắt 2FA, đăng nhập lại. Không chia sẻ khóa thiết lập.
      </p>
    </section>
  );
}
