import { useState } from "react";
import { api } from "./api";
export function ClassManager({
  demo,
  rows,
  onUpdated,
  onDemo,
  onInspect,
}: any) {
  const [edit, setEdit] = useState<any>(null),
    [showDeleted, setShowDeleted] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const labels: any = {
    active: "Đang hoạt động",
    suspended: "Tạm ngưng",
    deleted: "Đã xóa / lưu lịch sử",
  };
  async function save(row: any, state: string, confirm = "") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (demo)
        onDemo(
          rows.map((r: any) =>
            r.id === row.id
              ? { ...r, name: row.name, state, revision: (r.revision || 0) + 1 }
              : r,
          ),
        );
      else {
        await api(`/classes/${row.id}/manage`, {
          name: row.name,
          state,
          confirm,
          revision: row.revision || 0,
        });
        await onUpdated();
      }
      setEdit(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="section class-manager">
      <h2>Quản lý lớp học</h2>
      <p>
        Sửa tên, tạm ngưng, kích hoạt lại hoặc xóa lớp. Xóa giữ lịch sử và video
        khóa học; lớp còn buổi đang học phải kết thúc buổi trước.
      </p>
      {error && <p role="alert">{error}</p>}
      <label>
        <input
          type="checkbox"
          checked={showDeleted}
          onChange={(e) => setShowDeleted(e.target.checked)}
        />
        Hiện lớp đã xóa để đối chiếu lịch sử
      </label>
      <div className="academy-table-scroll">
        <table className="academic-table">
          <thead>
            <tr>
              <th>Lớp</th>
              <th>Môn / học sinh</th>
              <th>Trạng thái</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((c: any) => showDeleted || c.state !== "deleted")
              .map((c: any) => (
                <tr key={c.id}>
                  <td data-label="Lớp">
                    {c.short_id} · {c.name}
                  </td>
                  <td data-label="Môn / học sinh">
                    {c.subject_count || 0} môn · {c.student_count || 0} học sinh
                  </td>
                  <td data-label="Trạng thái">{labels[c.state || "active"]}</td>
                  <td data-label="Thao tác">
                    <div className="academy-actions">
                      <button type="button" onClick={() => onInspect(c.id)}>
                        Môn & danh sách lớp
                      </button>
                      {c.state !== "deleted" && (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setEdit({ ...c })}
                          >
                            Sửa lớp
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void save(
                                c,
                                c.state === "suspended"
                                  ? "active"
                                  : "suspended",
                              )
                            }
                          >
                            {c.state === "suspended"
                              ? "Kích hoạt lớp"
                              : "Ngưng lớp"}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              const confirm = window.prompt(
                                "Nhập đúng tên lớp để xóa và giữ lịch sử: " +
                                  c.name,
                              );
                              if (confirm !== null && confirm === c.name)
                                void save(c, "deleted", confirm);
                            }}
                          >
                            Xóa lớp
                          </button>
                        </>
                      )}
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
            void save(edit, edit.state || "active");
          }}
        >
          <label>
            Tên lớp mới
            <input
              required
              maxLength={100}
              value={edit.name}
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
            />
          </label>
          <button disabled={busy}>Lưu lớp</button>
          <button type="button" onClick={() => setEdit(null)}>
            Hủy sửa lớp
          </button>
        </form>
      )}
    </section>
  );
}
