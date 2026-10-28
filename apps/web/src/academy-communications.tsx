import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { vnDateTime } from "./date-format";
import { markFormClean, markFormDirty } from "./form-guard-core";
import { academyClick, academyHref, academyPaths } from "./academy-route";

// FormData omits disabled fieldsets; snapshot the full reset form before unlocking it.
function cleanForm(form: HTMLFormElement | null) {
  if (!form) return;
  const fieldset = form.querySelector("fieldset"),
    locked = fieldset?.disabled;
  if (fieldset) fieldset.disabled = false;
  markFormClean(form);
  if (fieldset) fieldset.disabled = !!locked;
}
async function readRecords(path: string) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 15000);
  try {
    return await api<any[]>(path, undefined, "GET", controller.signal);
  } catch (e) {
    if (controller.signal.aborted)
      throw new Error("Máy chủ phản hồi chậm. Vui lòng tải lại.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
const signature = (t: any) => JSON.stringify([t.subject, t.body]);
const searchable = (s: string) =>
  s
    .toLocaleLowerCase("vi")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");

export function BroadcastManager({
  demo,
  onChanged,
}: {
  demo: boolean;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState(""),
    [loadError, setLoadError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [search, setSearch] = useState(""),
    [expanded, setExpanded] = useState("");
  const request = useRef(crypto.randomUUID()),
    form = useRef<HTMLFormElement>(null),
    generation = useRef(0);
  async function load() {
    if (demo) return;
    const id = ++generation.current;
    setLoading(true);
    try {
      const data = await readRecords("/academy/broadcasts");
      if (id === generation.current) {
        setRows(data);
        setLoadError("");
      }
    } catch (e) {
      if (id === generation.current) setLoadError((e as Error).message);
    } finally {
      if (id === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [demo]);
  const visible = rows.filter((row) =>
    searchable(row.title + " " + row.body).includes(searchable(search)),
  );
  return (
    <section className="academy-section">
      <h2>Gửi thông báo toàn nền tảng</h2>
      <p>
        Mọi tài khoản quản trị, giáo viên và học sinh nhận thông báo trên
        website. Đánh dấu gửi email nếu cần gửi thêm vào hộp thư.
      </p>
      <form
        ref={form}
        className="academy-communication-form"
        onChange={() => {
          request.current = crypto.randomUUID();
        }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          const el = e.currentTarget,
            data = new FormData(el);
          setBusy(true);
          setError("");
          setMessage("");
          try {
            let recipients = 0;
            if (demo) {
              setRows((old) => [
                {
                  id: crypto.randomUUID(),
                  title: String(data.get("title")),
                  body: String(data.get("body")),
                  email_requested: data.get("email") === "on",
                  created_at: new Date().toISOString(),
                },
                ...old,
              ]);
            } else {
              const r = await api("/academy/broadcasts", {
                title: data.get("title"),
                body: data.get("body"),
                email: data.get("email") === "on",
                request_id: request.current,
              });
              recipients = r.email_recipients || 0;
            }
            request.current = crypto.randomUUID();
            el.reset();
            cleanForm(el);
            setMessage(
              demo
                ? "Đã mô phỏng đăng thông báo; không gửi email thật."
                : recipients
                  ? `Đã đăng thông báo và xếp hàng ${recipients} email.`
                  : "Đã đăng thông báo cho tất cả tài khoản.",
            );
            onChanged();
            void load();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
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
            {busy ? "Đang đăng…" : "Gửi thông báo"}
          </button>
        </fieldset>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <div className="section-title">
        <h3>Thông báo đã đăng</h3>
        <button
          type="button"
          className="secondary"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? "Đang tải…" : "Tải lại danh sách"}
        </button>
      </div>
      <label>
        Tìm thông báo
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tiêu đề hoặc nội dung"
        />
      </label>
      {loadError && (
        <p role="alert" className="error">
          Chưa tải được danh sách: {loadError}. Có thể tải lại danh sách; không
          cần đăng lại thông báo đã thành công.
        </p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ngày đăng</th>
              <th>Tiêu đề</th>
              <th>Kênh nhận</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <BroadcastRow
                key={row.id}
                row={row}
                open={expanded === row.id}
                busy={busy}
                toggle={() => setExpanded(expanded === row.id ? "" : row.id)}
                remove={async () => {
                  if (
                    busy ||
                    !confirm(
                      "Xóa thông báo khỏi tất cả tài khoản? Email chưa gửi sẽ bị hủy; email đã gửi không thể thu hồi.",
                    )
                  )
                    return;
                  setBusy(true);
                  setError("");
                  setMessage("");
                  try {
                    if (!demo)
                      await api(`/academy/broadcasts/${row.id}/delete`, {
                        confirm: "XOA THONG BAO",
                      });
                    setRows((old) => old.filter((v) => v.id !== row.id));
                    setExpanded("");
                    onChanged();
                    setMessage(
                      demo
                        ? "Đã xóa thông báo trong bản xem trước."
                        : "Đã xóa thông báo khỏi các tài khoản và hủy email chưa gửi.",
                    );
                    void load();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            ))}
            {!visible.length && (
              <tr>
                <td colSpan={4}>
                  {loading
                    ? "Đang tải thông báo…"
                    : search
                      ? "Không có thông báo phù hợp."
                      : "Chưa có thông báo chung."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <small>
        Danh sách hiển thị tối đa 100 thông báo gần nhất. Bấm Xem nội dung để
        đọc đầy đủ.
      </small>
    </section>
  );
}
function BroadcastRow({ row, open, busy, toggle, remove }: any) {
  return (
    <>
      <tr>
        <td>{vnDateTime(row.created_at)}</td>
        <td>{row.title}</td>
        <td>{row.email_requested ? "Website + email" : "Website"}</td>
        <td>
          <div className="academy-communication-actions">
            <button
              type="button"
              className="secondary"
              aria-expanded={open}
              aria-controls={"broadcast-" + row.id}
              onClick={toggle}
            >
              {open ? "Thu gọn" : "Xem nội dung"}
            </button>
            <button
              type="button"
              className="secondary danger"
              disabled={busy}
              onClick={() => void remove()}
            >
              Xóa thông báo
            </button>
          </div>
        </td>
      </tr>
      {open && (
        <tr id={"broadcast-" + row.id}>
          <td colSpan={4}>
            <div className="academy-broadcast-body">{row.body}</div>
          </td>
        </tr>
      )}
    </>
  );
}

const tabs = [
  ["thong-bao", "Thông báo chung"],
  ["soan-email", "Soạn email"],
  ["mau-email", "Mẫu email"],
  ["lich-su", "Lịch sử gửi"],
];
function readSection() {
  const value = new URLSearchParams(location.search).get("muc");
  return tabs.some(([key]) => key === value) ? value! : "thong-bao";
}
export function AcademyMailCenter({
  demo,
  onChanged = () => {},
  canConfigure = false,
}: {
  demo: boolean;
  onChanged?: () => void;
  canConfigure?: boolean;
}) {
  const [section, setSection] = useState(readSection),
    [templates, setTemplates] = useState<any[]>([]),
    [kind, setKind] = useState("verification"),
    [campaigns, setCampaigns] = useState<any[]>([]),
    [error, setError] = useState(""),
    [historyError, setHistoryError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [historyLoading, setHistoryLoading] = useState(false);
  const templateForm = useRef<HTMLFormElement>(null),
    composeForm = useRef<HTMLFormElement>(null),
    request = useRef(crypto.randomUUID()),
    saved = useRef<Record<string, string>>({}),
    generation = useRef(0),
    historyRequests = useRef(0);
  const choose = (key: string) => {
    const url = new URL(location.href);
    url.searchParams.set("muc", key);
    history.replaceState(history.state, "", url);
    setSection(key);
  };
  useEffect(() => {
    const sync = () => setSection(readSection());
    window.addEventListener("academy:navigate", sync);
    return () => window.removeEventListener("academy:navigate", sync);
  }, []);
  async function loadCampaigns(periodic = false) {
    if (demo || (periodic && historyRequests.current > 0)) return;
    historyRequests.current++;
    const id = ++generation.current;
    setHistoryLoading(true);
    try {
      const rows = await readRecords("/academy/mail-campaigns");
      if (id === generation.current) {
        setCampaigns(rows);
        setHistoryError("");
      }
    } catch (e) {
      if (id === generation.current) setHistoryError((e as Error).message);
    } finally {
      historyRequests.current--;
      if (id === generation.current) setHistoryLoading(false);
    }
  }
  useEffect(() => {
    let alive = true;
    const receive = (rows: any[]) => {
      if (!alive) return;
      saved.current = Object.fromEntries(
        rows.map((t) => [t.kind, signature(t)]),
      );
      setTemplates(rows);
    };
    if (demo)
      receive([
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
    else {
      void readRecords("/academy/mail-templates")
        .then(receive)
        .catch((e) => {
          if (alive) setError(e.message);
        });
      void loadCampaigns();
    }
    const timer = demo
      ? undefined
      : setInterval(() => void loadCampaigns(true), 10000);
    return () => {
      alive = false;
      generation.current++;
      clearInterval(timer);
    };
  }, [demo]);
  const current = templates.find((t) => t.kind === kind),
    unsaved = templates.filter(
      (t) => signature(t) !== saved.current[t.kind],
    ).length;
  useEffect(() => {
    if (busy) return;
    if (unsaved) markFormDirty(templateForm.current);
    else markFormClean(templateForm.current);
  }, [templates, kind, busy]);
  const change = (field: string, value: string) =>
    setTemplates((rows) =>
      rows.map((t) => (t.kind === kind ? { ...t, [field]: value } : t)),
    );
  return (
    <div className="academy-communications">
      <p>
        Đăng thông báo trên website, gửi email theo nhóm và quản lý nội dung thư
        tại một nơi.
      </p>
      <nav
        className="academy-communication-tabs"
        role="tablist"
        aria-label="Quản lý thông báo và email"
        onKeyDown={(e) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
            return;
          e.preventDefault();
          const index = tabs.findIndex(([key]) => key === section),
            next =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? tabs.length - 1
                  : (index + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                    tabs.length;
          choose(tabs[next][0]);
          e.currentTarget
            .querySelectorAll<HTMLButtonElement>('[role="tab"]')
            [next]?.focus();
        }}
      >
        {tabs.map(([key, label]) => (
          <button
            type="button"
            role="tab"
            key={key}
            id={"mail-tab-" + key}
            aria-controls={"mail-panel-" + key}
            aria-selected={section === key}
            tabIndex={section === key ? 0 : -1}
            onClick={() => choose(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div
        role="tabpanel"
        id="mail-panel-thong-bao"
        aria-labelledby="mail-tab-thong-bao"
        hidden={section !== "thong-bao"}
      >
        <BroadcastManager demo={demo} onChanged={onChanged} />
      </div>
      <div
        role="tabpanel"
        id="mail-panel-mau-email"
        aria-labelledby="mail-tab-mau-email"
        hidden={section !== "mau-email"}
      >
        <section className="academy-section">
          <h2>Nội dung email tự động</h2>
          <p>
            Email dạng văn bản tiếng Việt. Có thể dùng{" "}
            <code>{"{{name}}, {{email}}, {{site_url}}"}</code>. Mẫu xác thực
            phải giữ liên kết xác thực.
          </p>
          <div className="academy-tabs">
            {[
              ["verification", "Xác thực tài khoản"],
              ["notification", "Thông báo chung"],
            ].map(([key, label]) => (
              <button
                type="button"
                disabled={busy}
                key={key}
                className={kind === key ? "academy-primary" : "secondary"}
                onClick={() => setKind(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {!!unsaved && (
            <p role="status">
              Có {unsaved} mẫu email chưa lưu. Đổi mục vẫn giữ nội dung đang
              soạn.
            </p>
          )}
          {current && (
            <form
              ref={templateForm}
              className="academy-communication-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy) return;
                setBusy(true);
                setError("");
                setMessage("");
                try {
                  const r = demo
                    ? { revision: current.revision + 1 }
                    : await api("/academy/mail-templates", current);
                  saved.current[kind] = signature(current);
                  setTemplates((rows) =>
                    rows.map((t) =>
                      t.kind === kind ? { ...t, revision: r.revision } : t,
                    ),
                  );
                  setMessage(
                    demo
                      ? "Đã lưu mẫu trong bản xem trước."
                      : "Đã lưu mẫu email.",
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <fieldset disabled={busy}>
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
                  <span id="academy-template-body-label">
                    Nội dung email tự động
                  </span>
                  <textarea
                    aria-labelledby="academy-template-body-label"
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
                  {busy ? "Đang lưu…" : "Lưu mẫu email"}
                </button>
              </fieldset>
            </form>
          )}
        </section>
      </div>
      <div
        role="tabpanel"
        id="mail-panel-soan-email"
        aria-labelledby="mail-tab-soan-email"
        hidden={section !== "soan-email"}
      >
        <section className="academy-section">
          <h2>Soạn và gửi email</h2>
          <p>
            Chọn nhóm người nhận, nhập nội dung và xác nhận gửi. Email được xếp
            hàng; xem kết quả tại Lịch sử gửi. Gửi thử đến chính mình trước khi
            gửi cho nhiều tài khoản.
          </p>
          {canConfigure ? (
            <a
              href={academyHref(academyPaths.settings)}
              onClick={(e) => academyClick(e, academyPaths.settings)}
            >
              Cấu hình máy chủ gửi email
            </a>
          ) : (
            <p>
              Liên hệ quản trị có quyền cài đặt để cấu hình máy chủ gửi email.
            </p>
          )}
          <form
            ref={composeForm}
            className="academy-communication-form"
            onChange={() => {
              request.current = crypto.randomUUID();
            }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              const el = e.currentTarget,
                data = new FormData(el);
              setBusy(true);
              setError("");
              setMessage("");
              try {
                let recipients = 1;
                if (demo) {
                  setCampaigns((old) => [
                    {
                      id: crypto.randomUUID(),
                      title: String(data.get("subject")),
                      created_at: new Date().toISOString(),
                      recipients: 1,
                      sent: 0,
                      pending: 0,
                      failed: 0,
                      cancelled: 0,
                    },
                    ...old,
                  ]);
                } else {
                  const r = await api("/academy/mail-campaigns", {
                    subject: data.get("subject"),
                    body: data.get("body"),
                    audience: data.get("audience"),
                    request_id: request.current,
                  });
                  recipients = r.recipients;
                }
                request.current = crypto.randomUUID();
                el.reset();
                cleanForm(el);
                setMessage(
                  demo
                    ? "Gửi email mô phỏng; không gửi thư thật."
                    : `Đã xếp hàng ${recipients} email. Xem kết quả tại Lịch sử gửi.`,
                );
                void loadCampaigns();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <fieldset disabled={busy}>
              <label>
                Người nhận
                <select name="audience">
                  <option value="self">
                    Chỉ gửi thử đến tài khoản của tôi
                  </option>
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
                Cá nhân hóa bằng{" "}
                <code>{"{{name}}, {{email}}, {{site_url}}"}</code>.
              </p>
              <button className="academy-primary" disabled={busy}>
                {busy ? "Đang xếp hàng…" : "Xác nhận gửi email"}
              </button>
            </fieldset>
          </form>
        </section>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <div
        role="tabpanel"
        id="mail-panel-lich-su"
        aria-labelledby="mail-tab-lich-su"
        hidden={section !== "lich-su"}
      >
        <section className="academy-section">
          <div className="section-title">
            <h2>Lịch sử gửi email</h2>
            <button
              type="button"
              className="secondary"
              disabled={historyLoading}
              onClick={() => void loadCampaigns()}
            >
              {historyLoading ? "Đang tải…" : "Tải lại lịch sử"}
            </button>
          </div>
          {historyError && (
            <p role="alert" className="error">
              Chưa tải được lịch sử: {historyError}. Email đã được xác nhận xếp
              hàng không cần gửi lại.
            </p>
          )}
          {demo && <p>Bản xem trước không gửi email thật.</p>}
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
                        type="button"
                        className="secondary"
                        disabled={busy || !Number(c.failed)}
                        onClick={async () => {
                          if (busy) return;
                          setBusy(true);
                          setError("");
                          try {
                            if (!demo)
                              await api(
                                `/academy/mail-campaigns/${c.id}/retry`,
                                {},
                              );
                            setMessage("Đã xếp hàng lại các email bị lỗi.");
                            void loadCampaigns();
                          } catch (e) {
                            setError((e as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Thử gửi lại
                      </button>
                    </td>
                  </tr>
                ))}
                {!campaigns.length && (
                  <tr>
                    <td colSpan={8}>
                      {historyLoading
                        ? "Đang tải lịch sử…"
                        : "Chưa có đợt gửi email."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
