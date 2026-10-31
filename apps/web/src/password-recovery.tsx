import { useEffect, useState } from "react";
import { api } from "./api";
export function PasswordRecovery() {
  const [token] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get("token") || "",
  );
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [done, setDone] = useState(false);
  useEffect(() => {
    history.replaceState(null, "", location.pathname);
  }, []);
  return (
    <main className="login">
      <div className="login-art">
        <span className="brand">
          m<span>●</span> meet
        </span>
        <h1>Khôi phục tài khoản</h1>
        <p>
          Liên kết do quản trị viên cấp, dùng một lần trong 30 phút. Tài khoản
          đã bật 2FA vẫn cần mã xác thực.
        </p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          setBusy(true);
          void api("/reset-password", {
            token,
            password: form.get("password"),
            code: form.get("code") || "",
          })
            .then(() => {
              setDone(true);
              setMessage(
                "Đã đổi mật khẩu và kết thúc các phiên cũ. Đăng nhập lại để tiếp tục.",
              );
            })
            .catch((e) => setMessage(e.message))
            .finally(() => setBusy(false));
        }}
      >
        <h2>Đặt mật khẩu mới</h2>
        {message && <p role="status">{message}</p>}
        {!done && (
          <>
            <label>
              Mật khẩu mới
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={6}
                maxLength={72}
                required
              />
            </label>
            <label>
              Mã 2FA nếu đã bật
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
              />
            </label>
            <button disabled={busy || !token}>
              {busy ? "Đang lưu…" : "Đổi mật khẩu"}
            </button>
          </>
        )}
        <a href="/">Quay lại đăng nhập</a>
      </form>
    </main>
  );
}
