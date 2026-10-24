import { useEffect, useState } from "react";
import { api } from "./api";
type Entry = {
  id: number;
  actor_name: string;
  actor_code: string;
  action: string;
  target: string;
  at: string;
};
export function AuditLog({ demo }: { demo: boolean }) {
  const [rows, setRows] = useState<Entry[]>([]),
    [action, setAction] = useState(""),
    [filter, setFilter] = useState(""),
    [cursors, setCursors] = useState<number[]>([0]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const cursor = cursors[cursors.length - 1];
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    const params = new URLSearchParams();
    if (cursor) params.set("before", String(cursor));
    if (filter) params.set("action", filter);
    const load = demo
      ? Promise.resolve([
          {
            id: 1,
            actor_name: "Lê Thu Hà",
            actor_code: "QT0001",
            action: "attendance.timing",
            target: "Buổi học minh họa",
            at: new Date().toISOString(),
          },
        ])
      : api<Entry[]>("/audit?" + params);
    void load
      .then((data) => {
        if (active) setRows(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [demo, cursor, filter]);
  return (
    <section className="section">
      <div className="section-title">
        <div>
          <h2>Nhật ký hoạt động</h2>
          <p>Tra cứu người thực hiện, thao tác và đối tượng trong trường.</p>
        </div>
        <span className="pill">Chỉ xem</span>
      </div>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter(action.trim());
          setCursors([0]);
        }}
      >
        <label>
          Thao tác chính xác
          <input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="attendance.timing / account.save"
            maxLength={80}
          />
        </label>
        <button disabled={busy}>Lọc nhật ký</button>
        <button
          className="secondary"
          type="button"
          onClick={() => {
            setAction("");
            setFilter("");
            setCursors([0]);
          }}
        >
          Tất cả
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div
        className="comparison-scroll"
        role="region"
        aria-label="Bảng nhật ký"
        tabIndex={0}
      >
        <table className="comparison-table">
          <thead>
            <tr>
              <th>Người thực hiện</th>
              <th>Thời gian</th>
              <th>Thao tác</th>
              <th>Đối tượng</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 50).map((row) => (
              <tr key={row.id}>
                <td>
                  {row.actor_name}
                  <small>{row.actor_code}</small>
                </td>
                <td>{new Date(row.at).toLocaleString("vi-VN")}</td>
                <td>{row.action}</td>
                <td>{row.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!busy && !rows.length && <p>Chưa có nhật ký phù hợp.</p>}
      <div className="report-pagination">
        <button
          className="secondary"
          disabled={busy || cursors.length === 1}
          onClick={() => setCursors(cursors.slice(0, -1))}
        >
          ← Trang trước
        </button>
        <span>{busy ? "Đang tải…" : `Trang ${cursors.length}`}</span>
        <button
          className="secondary"
          disabled={busy || rows.length <= 50}
          onClick={() => setCursors([...cursors, rows[49].id])}
        >
          Trang sau →
        </button>
      </div>
    </section>
  );
}
