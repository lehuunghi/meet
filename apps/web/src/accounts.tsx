import { vnDateTime } from "./date-format";
import { useEffect, useState } from "react";
import { api } from "./api";
const permissions = [
  ["academic", "Học vụ"],
  ["accounts", "Quản lý tài khoản"],
  ["attendance", "Điểm danh"],
  ["meetings", "Buổi học"],
  ["recordings", "Ghi hình"],
  ["audit", "Nhật ký"],
  ["content", "Nội dung khóa học"],
 ["communications", "Thông báo & email"],
  ["finance", "Tài chính / VIP"],
];
export function Accounts({ demo }: { demo: boolean }) {
  const [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<{
    url: string;
    expires_at: string;
  } | null>(null);
  async function load() {
    if (demo) {
      setRows([
        {
          id: "root",
          short_id: "QT0001",
          name: "Quản trị gốc",
          email: "admin@example.test",
          role: "admin",
          state: "active",
          permissions: null,
        },
      ]);
      return;
    }
    setRows(
      (await api<any[]>("/accounts")).map((r) => ({
        ...r,
        permissions:
          typeof r.permissions === "string"
            ? JSON.parse(r.permissions)
            : r.permissions,
      })),
    );
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [demo]);
  async function save(row: any) {
    setBusy(true);
    setError("");
    try {
      if (demo) throw Error("Bản mẫu không lưu máy chủ");
      await api("/accounts", {
        id: row.id || "",
        email: row.email || "",
        name: row.name || "",
        password: row.password || "",
        state: row.state,
        permissions: row.permissions || [],
        revision: row.revision || 0,
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="section">
      <h2>Tài khoản và phân quyền</h2>
      <p>
        Quản trị gốc được bảo vệ. Vô hiệu hóa hoặc tạm ngưng sẽ chấm dứt quyền
        truy cập của tài khoản. Mỗi lần đăng nhập mới sẽ thoát phiên đăng nhập
        cũ.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {recovery && (
        <div className="banner">
          <strong>Liên kết khôi phục dùng một lần</strong>
          <p>
            Chỉ giao trực tiếp cho đúng chủ tài khoản. Hết hạn lúc{" "}
            {vnDateTime(recovery.expires_at)}. Không gửi vào nhóm chung.
          </p>
          <input
            aria-label="Liên kết khôi phục"
            readOnly
            value={recovery.url}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button className="secondary" onClick={() => setRecovery(null)}>
            Ẩn liên kết
          </button>
        </div>
      )}
      <button
        className="secondary"
        disabled={busy}
        onClick={() =>
          setRows((r) => [
            ...r,
            {
              id: "",
              key: crypto.randomUUID(),
              role: "admin",
              name: "",
              email: "",
              password: "",
              state: "active",
              permissions: [],
            },
          ])
        }
      >
        + Thêm quản trị viên
      </button>
      <div className="academic-admin">
        <table className="academic-table accounts-table">
          <thead>
            <tr>
              <th>Tài khoản</th>
              <th>Trạng thái</th>
              <th>Quyền quản trị</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id || r.key}>
                <td data-label="Tài khoản">
                  {r.id ? (
                    <>
                      <strong>
                        {r.short_id} · {r.name}
                      </strong>
                      <small>
                        {r.email} ·{" "}
                        {r.role === "admin"
                          ? "Quản trị"
                          : r.role === "teacher"
                            ? "Giáo viên"
                            : "Học sinh"}
                      </small>
                    </>
                  ) : (
                    <>
                      <input
                        aria-label="Tên quản trị mới"
                        placeholder="Họ tên"
                        value={r.name}
                        onChange={(e) =>
                          setRows(
                            rows.map((v, n) =>
                              n === i ? { ...v, name: e.target.value } : v,
                            ),
                          )
                        }
                      />
                      <input
                        aria-label="Email quản trị mới"
                        type="email"
                        placeholder="Email"
                        value={r.email}
                        onChange={(e) =>
                          setRows(
                            rows.map((v, n) =>
                              n === i ? { ...v, email: e.target.value } : v,
                            ),
                          )
                        }
                      />
                      <input
                        aria-label="Mật khẩu quản trị mới"
                        type="password"
                        autoComplete="new-password"
                        placeholder="Mật khẩu 12–72 byte"
                        value={r.password}
                        onChange={(e) =>
                          setRows(
                            rows.map((v, n) =>
                              n === i ? { ...v, password: e.target.value } : v,
                            ),
                          )
                        }
                      />
                    </>
                  )}
                </td>
                <td data-label="Trạng thái">
                  <select
                    disabled={r.role === "admin" && r.permissions === null}
                    value={r.state}
                    onChange={(e) =>
                      setRows(
                        rows.map((v, n) =>
                          n === i ? { ...v, state: e.target.value } : v,
                        ),
                      )
                    }
                  >
                    <option value="active">Kích hoạt</option>
                    <option value="suspended">Tạm ngưng</option>
                    <option value="disabled">Vô hiệu hóa</option>
                  </select>
                </td>
                <td data-label="Quyền">
                  {r.role === "admin"
                    ? r.permissions === null
                      ? "Quản trị gốc"
                      : permissions.map(([id, label]) => (
                          <label key={id}>
                            <input
                              type="checkbox"
                              checked={r.permissions.includes(id)}
                              onChange={(e) =>
                                setRows(
                                  rows.map((v, n) =>
                                    n === i
                                      ? {
                                          ...v,
                                          permissions: e.target.checked
                                            ? [...v.permissions, id]
                                            : v.permissions.filter(
                                                (p: string) => p !== id,
                                              ),
                                        }
                                      : v,
                                  ),
                                )
                              }
                            />
                            {label}
                          </label>
                        ))
                    : "Theo vai trò"}
                </td>
                <td data-label="Thao tác">
                  {!demo &&
                    r.id &&
                    !(r.role === "admin" && r.permissions === null) && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          setBusy(true);
                          setRecovery(null);
                          void api<{ url: string; expires_at: string }>(
                            `/accounts/${r.id}/recovery`,
                            {},
                          )
                            .then(setRecovery)
                            .catch((e) => setError(e.message))
                            .finally(() => setBusy(false));
                        }}
                      >
                        Cấp lại mật khẩu
                      </button>
                    )}
                  {!(r.role === "admin" && r.permissions === null) && (
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (!r.id) {
                          setRows(rows.filter((_, n) => n !== i));
                          return;
                        }
                        const confirm = window.prompt(
                          "Xóa tài khoản sẽ thu hồi đăng nhập và xóa hồ sơ cá nhân; giữ lịch sử học/thanh toán. Nhập đúng email: " +
                            r.email,
                        );
                        if (confirm !== r.email) return;
                        setBusy(true);
                        setError("");
                        void api(`/accounts/${r.id}/delete`, {
                          confirm,
                          revision: r.revision || 0,
                        })
                          .then(load)
                          .catch((e) => setError(e.message))
                          .finally(() => setBusy(false));
                      }}
                    >
                      Xóa tài khoản
                    </button>
                  )}
                  <button
                    disabled={
                      busy || (r.role === "admin" && r.permissions === null)
                    }
                    onClick={() => void save(r)}
                  >
                    Lưu tài khoản
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
