import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { vnDateTime } from "./date-format";
import { markFormClean } from "./form-guard-core";
export function BroadcastManager({
  demo,
  onChanged,
}: {
  demo: boolean;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const request = useRef(crypto.randomUUID());
  const form = useRef<HTMLFormElement>(null);
  const load = async () => {
    if (!demo) setRows(await api<any[]>("/academy/broadcasts"));
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [demo]);
  return (
    <section className="academy-section">
      <h2>Gửi thông báo toàn nền tảng</h2>
      <p>
        Mọi tài khoản quản trị, giáo viên và học sinh đều nhận trong website.
        Thông báo tự cập nhật khi tài khoản đang mở trang.
      </p>
      <form
        ref={form}
        className="academy-communication-form"
        onChange={() => {
          request.current = crypto.randomUUID();
        }}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setMessage("");
          const el = e.currentTarget,
            data = new FormData(el);
          try {
            if (demo) {
              setMessage("Đã mô phỏng gửi thông báo; không gửi email thật.");
              return;
            }
            const r = await api("/academy/broadcasts", {
              title: data.get("title"),
              body: data.get("body"),
              email: data.get("email") === "on",
              request_id: request.current,
            });
            request.current = crypto.randomUUID();
            el.reset();
            markFormClean(el);
            await load();
            onChanged();
            setMessage(
              r.email_recipients
                ? `Đã đăng thông báo và xếp hàng ${r.email_recipients} email.`
                : "Đã đăng thông báo cho tất cả tài khoản.",
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Tiêu đề thông báo
          <input name="title" required maxLength={200} />
        </label>
        <label>
          Nội dung thông báo
          <textarea name="body" required maxLength={20000} rows={5} />
        </label>
        <label className="academy-check">
          <input type="checkbox" name="email" />
          Đồng thời gửi thông báo đến email
        </label>
        <button className="academy-primary" disabled={busy}>
          {busy ? "Đang gửi…" : "Gửi thông báo"}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <h3>Thông báo đã đăng</h3>
      <div className="academy-broadcast-list">
        {rows.map((row) => (
          <article key={row.id}>
            <div>
              <strong>{row.title}</strong>
              <p>{row.body}</p>
              <small>
                {vnDateTime(row.created_at)} ·{" "}
                {row.email_requested ? "Có gửi email" : "Chỉ trên website"}
              </small>
            </div>
            <button
              className="secondary danger"
              disabled={busy}
              onClick={async () => {
                if (
                  !confirm(
                    "Xóa thông báo khỏi tất cả tài khoản? Email chưa gửi sẽ bị hủy; email đã gửi không thể thu hồi.",
                  )
                )
                  return;
                setBusy(true);
                setError("");
                try {
                  await api(`/academy/broadcasts/${row.id}/delete`, {
                    confirm: "XOA THONG BAO",
                  });
                  await load();
                  onChanged();
                  setMessage(
                    "Đã xóa thông báo khỏi hệ thống và hủy email chưa gửi.",
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Xóa thông báo
            </button>
          </article>
        ))}
        {!rows.length && <p>Chưa có thông báo chung.</p>}
      </div>
    </section>
  );
}
export function AcademyMailCenter({ demo }: { demo: boolean }) {
  const [templates, setTemplates] = useState<any[]>([]),
    [kind, setKind] = useState("verification"),
    [campaigns, setCampaigns] = useState<any[]>([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const templateForm = useRef<HTMLFormElement>(null),
    composeForm = useRef<HTMLFormElement>(null),
    request = useRef(crypto.randomUUID());
  async function loadCampaigns() {
    if (!demo) setCampaigns(await api<any[]>("/academy/mail-campaigns"));
  }
  useEffect(() => {
    if (demo) {
      setTemplates([
        {
          kind: "verification",
          subject: "Xác thực email tài khoản học tập",
          body: "Chào {{name}},\n\nBấm {{verification_link}} để xác thực email.",
          revision: 0,
        },
        {
          kind: "notification",
          subject: "{{title}}",
          body: "Chào {{name}},\n\n{{content}}\n\n{{notification_link}}",
          revision: 0,
        },
      ]);
      return;
    }
    void api<any[]>("/academy/mail-templates")
      .then(setTemplates)
      .catch((e) => setError(e.message));
    void loadCampaigns().catch((e) => setError(e.message));
    const timer = setInterval(
      () => void loadCampaigns().catch(() => {}),
      10000,
    );
    return () => clearInterval(timer);
  }, [demo]);
  const current = templates.find((t) => t.kind === kind);
  const change = (field: string, value: string) =>
    setTemplates((rows) =>
      rows.map((t) => (t.kind === kind ? { ...t, [field]: value } : t)),
    );
  return (
    <>
      <section className="academy-section">
        <h2>Nội dung email tự động</h2>
        <p>
          Email dạng văn bản tiếng Việt, không chèn mã HTML. Có thể dùng{" "}
          <code>{"{{name}}, {{email}}, {{site_url}}"}</code>. Mẫu xác thực phải
          giữ liên kết xác thực.
        </p>
        <div className="academy-tabs">
          {[
            ["verification", "Xác thực tài khoản"],
            ["notification", "Thông báo chung"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={kind === key ? "academy-primary" : "secondary"}
              onClick={() => setKind(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {current && (
          <form
            ref={templateForm}
            className="academy-communication-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              setMessage("");
              try {
                if (!demo) {
                  const r = await api("/academy/mail-templates", current);
                  setTemplates((rows) =>
                    rows.map((t) =>
                      t.kind === kind ? { ...t, revision: r.revision } : t,
                    ),
                  );
                }
                markFormClean(templateForm.current);
                setMessage(
                  demo ? "Đã cập nhật mẫu minh họa." : "Đã lưu mẫu email.",
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Tiêu đề email tự động
              <input
                required
                maxLength={200}
                value={current.subject}
                onChange={(e) => change("subject", e.target.value)}
              />
            </label>
            <label>
              Nội dung email tự động
              <textarea
                required
                rows={9}
                maxLength={20000}
                value={current.body}
                onChange={(e) => change("body", e.target.value)}
              />
            </label>
            <small>
              {kind === "verification"
                ? "Biến bắt buộc: {{verification_link}}"
                : "Biến thông báo: {{title}}, {{content}}, {{notification_link}}"}
            </small>
            <button className="academy-primary" disabled={busy}>
              Lưu mẫu email
            </button>
          </form>
        )}
      </section>
      <section className="academy-section">
        <h2>Soạn và gửi email</h2>
        <p>
          Gửi đến tài khoản đang hoạt động trong nền tảng này. Email được xếp
          hàng, theo dõi kết quả và thử lại khi SMTP tạm thời lỗi. Cấu hình máy
          chủ gửi tại Email & thanh toán.
        </p>
        <form
          ref={composeForm}
          className="academy-communication-form"
          onChange={() => {
            request.current = crypto.randomUUID();
          }}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setMessage("");
            const el = e.currentTarget,
              data = new FormData(el);
            try {
              if (demo) {
                setMessage("Gửi email mô phỏng; không gửi thư thật.");
                return;
              }
              const r = await api("/academy/mail-campaigns", {
                subject: data.get("subject"),
                body: data.get("body"),
                audience: data.get("audience"),
                request_id: request.current,
              });
              request.current = crypto.randomUUID();
              el.reset();
              markFormClean(el);
              await loadCampaigns();
              setMessage(`Đã xếp hàng ${r.recipients} email.`);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Người nhận
            <select name="audience">
              <option value="self">Chỉ gửi thử đến tài khoản của tôi</option>
              <option value="all">Tất cả tài khoản đang hoạt động</option>
              <option value="student">Tất cả học sinh</option>
              <option value="teacher">Tất cả giáo viên</option>
              <option value="admin">Tất cả quản trị viên</option>
            </select>
          </label>
          <label>
            Tiêu đề email
            <input name="subject" required maxLength={200} />
          </label>
          <label>
            Nội dung email
            <textarea name="body" required maxLength={20000} rows={7} />
          </label>
          <p>
            Cá nhân hóa bằng <code>{"{{name}}, {{email}}, {{site_url}}"}</code>.
          </p>
          <button className="academy-primary" disabled={busy}>
            {busy ? "Đang xếp hàng…" : "Xác nhận gửi email"}
          </button>
        </form>
      </section>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <section className="academy-section">
        <h2>Lịch sử gửi email</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ngày</th>
                <th>Tiêu đề</th>
                <th>Người nhận</th>
                <th>Đã gửi</th>
                <th>Đang chờ</th>
                <th>Lỗi</th>
                <th>Đã hủy</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td>{vnDateTime(c.created_at)}</td>
                  <td>{c.title}</td>
                  <td>{c.recipients}</td>
                  <td>{c.sent}</td>
                  <td>{c.pending}</td>
                  <td>{c.failed}</td>
                  <td>{c.cancelled}</td>
                  <td>
                    <button
                      className="secondary"
                      disabled={busy || !Number(c.failed)}
                      onClick={async () => {
                        setError("");
                        try {
                          await api(
                            `/academy/mail-campaigns/${c.id}/retry`,
                            {},
                          );
                          await loadCampaigns();
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      Thử gửi lại
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!campaigns.length && <p>Chưa có đợt gửi email.</p>}
      </section>
    </>
  );
}
