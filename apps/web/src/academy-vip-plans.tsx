import { useEffect, useState } from "react";
import { api } from "./api";
export function AcademyVIPPlans({ demo = false }: { demo?: boolean }) {
  const [rows, setRows] = useState<any[]>([]),
    [edit, setEdit] = useState<any>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setRows(
      demo
        ? [
            {
              id: "demo-plan",
              name: "VIP 30 ngày",
              price_vnd: 299000,
              days: 30,
              live_enabled: true,
              active: true,
              revision: 0,
            },
          ]
        : await api("/academy/admin/plans"),
    );
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [demo]);
  async function action(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (demo) {
        setNotice("Chế độ minh họa không thay đổi gói thật.");
        return;
      }
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(v: any) {
    await api("/academy/plans", {
      id: v.id || "",
      name: v.name,
      price_vnd: Number(v.price_vnd),
      days: Number(v.days),
      live_enabled: true,
      active: !!v.active,
      revision: v.revision || 0,
    });
    setNotice("Đã lưu gói VIP. Các đơn đã tạo giữ nguyên giá và quyền lợi.");
    setEdit(null);
  }
  return (
    <section className="academy-section academy-vip-plans">
      <h2>Quản lý gói VIP</h2>
      <p>
        Thêm, sửa, ngưng bán hoặc xóa gói. Xóa gói khỏi danh mục không xóa lịch
        sử thanh toán và quyền VIP đã cấp.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <button
        disabled={busy}
        onClick={() =>
          setEdit({
            name: "",
            price_vnd: 299000,
            days: 30,
            active: true,
            live_enabled: true,
          })
        }
      >
        + Thêm gói VIP
      </button>
      <div className="academy-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Gói</th>
              <th>Giá / thời hạn</th>
              <th>Trạng thái</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.name}
                  <small>
                    Video & Live
                  </small>
                </td>
                <td>
                  {Number(p.price_vnd).toLocaleString("vi-VN")} đ · {p.days}{" "}
                  ngày
                </td>
                <td>{p.active ? "Đang bán" : "Ngưng bán"}</td>
                <td>
                  <div className="academy-actions">
                    <button disabled={busy} onClick={() => setEdit({ ...p })}>
                      Sửa gói
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(() => save({ ...p, active: !p.active }))
                      }
                    >
                      {p.active ? "Ngưng bán" : "Mở bán lại"}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => {
                        const confirm = window.prompt(
                          "Nhập đúng tên gói để xóa khỏi danh mục: " + p.name,
                        );
                        if (confirm !== p.name) return;
                        void action(async () => {
                          await api(`/academy/plans/${p.id}/delete`, {
                            confirm,
                            revision: p.revision || 0,
                          });
                          setEdit(null);
                          setNotice(
                            "Đã xóa gói khỏi danh mục; giữ lịch sử và quyền VIP đã cấp.",
                          );
                        });
                      }}
                    >
                      Xóa gói
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action(() => save(edit));
          }}
        >
          <fieldset disabled={busy}>
            <legend>{edit.id ? "Sửa gói VIP" : "Thêm gói VIP"}</legend>
            <label>
              Tên gói
              <input
                required
                maxLength={160}
                value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
            </label>
            <label>
              Giá VND
              <input
                required
                type="number"
                min={1000}
                max={1000000000}
                value={edit.price_vnd}
                onChange={(e) =>
                  setEdit({ ...edit, price_vnd: e.target.value })
                }
              />
            </label>
            <label>
              Số ngày
              <input
                required
                type="number"
                min={1}
                max={3650}
                value={edit.days}
                onChange={(e) => setEdit({ ...edit, days: e.target.value })}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={true} disabled readOnly
              />
              Mọi gói VIP còn hạn đều có quyền Live
            </label>
            <label>
              <input
                type="checkbox"
                checked={!!edit.active}
                onChange={(e) => setEdit({ ...edit, active: e.target.checked })}
              />
              Đang bán
            </label>
            <button>Lưu gói VIP</button>
            <button type="button" onClick={() => setEdit(null)}>
              Hủy sửa
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
