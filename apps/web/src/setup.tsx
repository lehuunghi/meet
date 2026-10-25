import { useEffect, useState } from "react";
import { SystemUpdates } from "./updates";
import { api } from "./api";
import "./setup.css";
type Provider = {
  id: string;
  name: string;
  app_id: string;
  secret: string;
  weight: number;
  enabled: boolean;
  secret_set?: boolean;
};
type Turn = { id: string; token: string; token_set?: boolean };
type Settings = {
  backup?: { enabled: boolean; interval_hours: number };
  sfu: Provider[];
  turn: Turn[];
  r2: {
    enabled: boolean;
    account_id: string;
    bucket: string;
    access_key_id: string;
    secret_access_key: string;
    lifecycle_applied: boolean;
    access_key_set?: boolean;
    secret_set?: boolean;
  };
  retention_days: number;
};
const blank: Settings = {
  sfu: [],
  turn: [],
  r2: {
    enabled: false,
    account_id: "",
    bucket: "",
    access_key_id: "",
    secret_access_key: "",
    lifecycle_applied: false,
  },
  retention_days: 30,
  backup: { enabled: false, interval_hours: 24 },
};
export function Setup() {
  useEffect(() => {
    void api<any>("/public-config")
      .then((v) => {
        if (v.managed) location.replace("/");
      })
      .catch(() => {});
  }, []);
  const [token, setToken] = useState(
      () => new URLSearchParams(location.hash.slice(1)).get("token") || "",
    ),
    [unlocked, setUnlocked] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [initialized, setInitialized] = useState(false),
    [origin, setOrigin] = useState(location.origin),
    [settings, setSettings] = useState<Settings>(blank),
    [counts, setCounts] = useState<Record<string, number>>({}),
    [backupStatus, setBackupStatus] = useState<any>(null),
    [school, setSchool] = useState({
      slug: "",
      name: "",
      email: "",
      password: "",
    });
  async function load() {
    const data = await api("/setup/settings");
    setSettings(data.settings);
    setCounts(data.allocations);
    setOrigin(data.origin);
    setInitialized(data.initialized);
    setBackupStatus(data.backup_status);
    setUnlocked(true);
  }
  useEffect(() => {
    history.replaceState(null, "", location.pathname + location.search);
    let alive = true;
    (async () => {
      try {
        if (token) {
          await api("/setup/unlock", { token });
          setToken("");
        }
        await load();
      } catch (e) {
        if (alive) setUnlocked(false);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  async function run(fn: () => Promise<void>) {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function provider(index: number, patch: Partial<Provider>) {
    setSettings((s) => ({
      ...s,
      sfu: s.sfu.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    }));
  }
  return (
    <main className="setup-page">
      <header className="setup-header">
        <a className="brand" href="/">
          m<span>●</span> meet
        </a>
        <span>Cài đặt hệ thống</span>
        <a href="/">Về đăng nhập →</a>
      </header>
      <div className="setup-content">
        <span className="eyebrow">KHỞI TẠO & VẬN HÀNH</span>
        <h1>Cấu hình cho trường của bạn</h1>
        <p className="setup-intro">
          Domain quản lý: <strong>{origin}</strong>. Cấu hình dùng chung cho
          toàn hệ thống; chỉ người giữ mã cài đặt trên VPS được thay đổi.
        </p>
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        {message && (
          <div role="status" className="banner">
            {message}
          </div>
        )}
        {loading ? (
          <p>Đang kiểm tra phiên quản trị…</p>
        ) : !unlocked ? (
          <section className="section setup-unlock">
            <h2>Mở khóa cấu hình</h2>
            <p>
              Nhập mã trong <code>/opt/meet/runtime-config/setup-token</code>{" "}
              hoặc mở liên kết riêng mà bộ cài hiển thị. Phiên cấu hình có hiệu
              lực 15 phút.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api("/setup/unlock", { token });
                  setToken("");
                  await load();
                });
              }}
            >
              <label>
                Mã cài đặt riêng
                <input
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  required
                  minLength={32}
                />
              </label>
              <button disabled={busy}>Mở cấu hình</button>
            </form>
          </section>
        ) : (
          <>
            <SystemUpdates />
            <div className="setup-steps">
              <a href="#setup-school">1. Trường & admin</a>
              <a href="#setup-sfu">2. SFU & TURN</a>
              <a href="#setup-r2">3. R2 · Lưu trữ</a>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api("/setup/settings", {
                    settings,
                    school: initialized
                      ? { slug: "", name: "", email: "", password: "" }
                      : school,
                  });
                  setSchool((s) => ({ ...s, password: "" }));
                  await load();
                  setMessage(
                    "Đã lưu cấu hình. Trường/admin đã sẵn sàng. " +
                      (settings.r2.enabled
                        ? `R2 đã xác nhận lifecycle ${settings.retention_days} ngày và CORS.`
                        : "Ghi hình đang tắt."),
                  );
                });
              }}
            >
              <section className="section" id="setup-school">
                <div className="section-title">
                  <div>
                    <h2>1. Khởi tạo trường và admin</h2>
                    <p>
                      {initialized
                        ? "Đã có trường trong hệ thống. Thêm trường tiếp theo bằng lệnh bootstrap trong tài liệu."
                        : "Tạo trường đầu tiên và tài khoản quản trị. Password không được lưu trong file cấu hình."}
                    </p>
                  </div>
                  <span className="pill">
                    {initialized ? "Đã khởi tạo" : "Chưa khởi tạo"}
                  </span>
                </div>
                {!initialized && (
                  <div className="setup-grid">
                    <label>
                      Mã trường
                      <input
                        value={school.slug}
                        onChange={(e) =>
                          setSchool({ ...school, slug: e.target.value })
                        }
                        placeholder="nguyen-trai"
                        pattern="[a-z0-9][a-z0-9-]{1,79}"
                        required
                      />
                    </label>
                    <label>
                      Tên trường
                      <input
                        value={school.name}
                        onChange={(e) =>
                          setSchool({ ...school, name: e.target.value })
                        }
                        placeholder="Trường Nguyễn Trãi"
                        required
                      />
                    </label>
                    <label>
                      Email admin
                      <input
                        type="email"
                        value={school.email}
                        onChange={(e) =>
                          setSchool({ ...school, email: e.target.value })
                        }
                        autoComplete="username"
                        required
                      />
                    </label>
                    <label>
                      Mật khẩu admin mới
                      <input
                        type="password"
                        value={school.password}
                        onChange={(e) =>
                          setSchool({ ...school, password: e.target.value })
                        }
                        minLength={12}
                        maxLength={72}
                        autoComplete="new-password"
                        required
                      />
                      <small>
                        12–72 byte; lưu trong password manager riêng.
                      </small>
                    </label>
                  </div>
                )}
              </section>
              <section className="section" id="setup-sfu">
                <div className="section-title">
                  <div>
                    <h2>2. Cân bằng SFU theo lớp học</h2>
                    <p>
                      Mỗi dòng là một SFU App ID + App Secret. Tất cả người
                      trong một buổi dùng chung app đã gán cho lớp đó.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || settings.sfu.length >= 32}
                    onClick={() =>
                      setSettings((s) => ({
                        ...s,
                        sfu: [
                          ...s.sfu,
                          {
                            id: crypto.randomUUID(),
                            name: `SFU ${s.sfu.length + 1}`,
                            app_id: "",
                            secret: "",
                            weight: 1,
                            enabled: true,
                          },
                        ],
                      }))
                    }
                  >
                    + Thêm SFU App
                  </button>
                </div>
                <div className="banner">
                  Trọng số 2 nhận khoảng gấp đôi số lớp mới so với trọng số 1.
                  Phân bổ được lưu ở MySQL; thay trọng số chỉ ảnh hưởng lớp mới.
                  Tắt “Nhận lớp mới” vẫn giữ phục vụ lớp đã gán. Không tự chuyển
                  app giữa buổi khi upstream lỗi.
                </div>
                {settings.sfu.length === 0 && (
                  <p>
                    Chưa có SFU app. Bạn có thể lưu phần quản lý trước; cuộc gọi
                    cần ít nhất một app được bật.
                  </p>
                )}
                {settings.sfu.map((p, i) => (
                  <article className="setup-provider" key={p.id}>
                    <div className="setup-provider-title">
                      <strong>{p.name || `SFU ${i + 1}`}</strong>
                      <span className="pill">
                        {counts[p.id] || 0} lớp đã gán
                      </span>
                    </div>
                    <div className="setup-grid">
                      <label>
                        Tên hiển thị
                        <input
                          value={p.name}
                          onChange={(e) =>
                            provider(i, { name: e.target.value })
                          }
                          required
                          maxLength={100}
                        />
                      </label>
                      <label>
                        SFU App ID
                        <input
                          value={p.app_id}
                          onChange={(e) =>
                            provider(i, { app_id: e.target.value.trim() })
                          }
                          required
                          autoComplete="off"
                        />
                      </label>
                      <label>
                        App Secret
                        <input
                          type="password"
                          value={p.secret}
                          onChange={(e) =>
                            provider(i, { secret: e.target.value })
                          }
                          placeholder={
                            p.secret_set
                              ? "Đã lưu — để trống để giữ"
                              : "Nhập App Secret"
                          }
                          autoComplete="off"
                          required={!p.secret_set}
                        />
                      </label>
                      <label>
                        Trọng số phân lớp
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={p.weight}
                          onChange={(e) =>
                            provider(i, { weight: Number(e.target.value) })
                          }
                          required
                        />
                      </label>
                    </div>
                    <div className="setup-provider-actions">
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={p.enabled}
                          onChange={(e) =>
                            provider(i, { enabled: e.target.checked })
                          }
                        />{" "}
                        Nhận lớp mới
                      </label>
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await api("/setup/check-sfu", p);
                            setMessage(
                              `${p.name}: Cloudflare đã chấp nhận credential. Vẫn cần thử cuộc gọi hai phía.`,
                            );
                          })
                        }
                      >
                        Kiểm tra credential
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy || !!counts[p.id]}
                        onClick={() =>
                          setSettings((s) => ({
                            ...s,
                            sfu: s.sfu.filter((_, n) => n !== i),
                          }))
                        }
                      >
                        Xóa dòng
                      </button>
                    </div>
                  </article>
                ))}
                <h3>TURN keys</h3>
                <p>
                  TURN là cấu hình riêng, không thay thế SFU App. Credential
                  ngắn hạn được cấp từ backend; không gửi API token dài hạn cho
                  học sinh.
                </p>
                {settings.turn.map((t, i) => (
                  <div className="setup-turn" key={i}>
                    <label>
                      TURN Key ID
                      <input
                        value={t.id}
                        required
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            turn: s.turn.map((v, n) =>
                              n === i ? { ...v, id: e.target.value.trim() } : v,
                            ),
                          }))
                        }
                      />
                    </label>
                    <label>
                      TURN API token
                      <input
                        type="password"
                        autoComplete="off"
                        value={t.token}
                        placeholder={
                          t.token_set
                            ? "Đã lưu — để trống để giữ"
                            : "Nhập API token"
                        }
                        required={!t.token_set}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            turn: s.turn.map((v, n) =>
                              n === i ? { ...v, token: e.target.value } : v,
                            ),
                          }))
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        setSettings((s) => ({
                          ...s,
                          turn: s.turn.filter((_, n) => n !== i),
                        }))
                      }
                    >
                      Xóa
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="secondary"
                  disabled={settings.turn.length >= 32}
                  onClick={() =>
                    setSettings((s) => ({
                      ...s,
                      turn: [...s.turn, { id: "", token: "" }],
                    }))
                  }
                >
                  + Thêm TURN key
                </button>
              </section>
              <section className="section" id="setup-r2">
                <div className="section-title">
                  <div>
                    <h2>3. Ghi hình R2 và thời hạn lưu</h2>
                    <p>
                      Thời hạn mặc định là 30 ngày. Thay đổi sẽ tác động
                      lifecycle của các object ghi hình hiện có; không phải theo
                      tháng lịch.
                    </p>
                  </div>
                  <fieldset>
                    <legend>
                      Sao lưu dữ liệu, mã nguồn và cấu hình lên R2
                    </legend>
                    <p>
                      Đã cài dịch vụ trên VPS bằng bộ cài mới. Bản sao được mã
                      hóa, kiểm tra tải về; khóa phục hồi nằm tại
                      /etc/meet/recovery.key. Tải và giữ khóa ở nơi riêng, không
                      đưa khóa lên cùng bucket. Bản sao không chứa video; video
                      giữ theo thời hạn riêng.
                    </p>
                    <label>
                      <input
                        type="checkbox"
                        checked={settings.backup?.enabled || false}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            backup: {
                              enabled: e.target.checked,
                              interval_hours:
                                settings.backup?.interval_hours || 24,
                            },
                          })
                        }
                      />
                      Bật sao lưu tự động
                    </label>
                    <label>
                      Chu kỳ sao lưu (giờ)
                      <input
                        type="number"
                        min={1}
                        max={720}
                        value={settings.backup?.interval_hours || 24}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            backup: {
                              enabled: settings.backup?.enabled || false,
                              interval_hours: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </label>
                    {backupStatus ? (
                      <p>
                        Đã kiểm tra bản sao gần nhất:{" "}
                        <code>{backupStatus.object_key}</code> ·{" "}
                        {new Date(backupStatus.timestamp * 1000).toLocaleString(
                          "vi-VN",
                        )}
                      </p>
                    ) : (
                      <p>
                        Chưa có bản sao đã xác minh. Theo dõi dịch vụ
                        meet-backup trên VPS sau lần chạy đầu.
                      </p>
                    )}
                  </fieldset>
                  <label>
                    Thời hạn lưu ghi hình (ngày)
                    <input
                      type="number"
                      min={1}
                      max={3650}
                      value={settings.retention_days}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          retention_days: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                </div>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={settings.r2.enabled}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        r2: { ...s.r2, enabled: e.target.checked },
                      }))
                    }
                  />{" "}
                  Bật lưu bản ghi vào R2 private
                </label>
                {settings.r2.enabled && (
                  <>
                    <div className="setup-grid">
                      <label>
                        Cloudflare Account ID
                        <input
                          value={settings.r2.account_id}
                          onChange={(e) =>
                            setSettings((s) => ({
                              ...s,
                              r2: {
                                ...s.r2,
                                account_id: e.target.value.trim(),
                              },
                            }))
                          }
                          required
                          minLength={32}
                          maxLength={32}
                        />
                      </label>
                      <label>
                        Bucket đã tạo
                        <input
                          value={settings.r2.bucket}
                          onChange={(e) =>
                            setSettings((s) => ({
                              ...s,
                              r2: { ...s.r2, bucket: e.target.value.trim() },
                            }))
                          }
                          required
                          placeholder="meet-recordings"
                        />
                      </label>
                      <label>
                        R2 Access Key ID
                        <input
                          type="password"
                          autoComplete="off"
                          value={settings.r2.access_key_id}
                          placeholder={
                            settings.r2.access_key_set
                              ? "Đã lưu — để trống để giữ"
                              : ""
                          }
                          onChange={(e) =>
                            setSettings((s) => ({
                              ...s,
                              r2: { ...s.r2, access_key_id: e.target.value },
                            }))
                          }
                          required={!settings.r2.access_key_set}
                        />
                      </label>
                      <label>
                        R2 Secret Access Key
                        <input
                          type="password"
                          autoComplete="off"
                          value={settings.r2.secret_access_key}
                          placeholder={
                            settings.r2.secret_set
                              ? "Đã lưu — để trống để giữ"
                              : ""
                          }
                          onChange={(e) =>
                            setSettings((s) => ({
                              ...s,
                              r2: {
                                ...s.r2,
                                secret_access_key: e.target.value,
                              },
                            }))
                          }
                          required={!settings.r2.secret_set}
                        />
                      </label>
                    </div>
                    <div className="banner">
                      Khi lưu, hệ thống thiết lập và đọc lại lifecycle xóa sau
                      theo số ngày đã chọn cho prefix <code>recordings/</code>,
                      đồng thời thêm CORS đúng domain. Credential phải có quyền
                      cấu hình bucket và đọc/ghi/xóa object. Các rule khác được
                      giữ lại. Không bật public bucket.
                    </div>
                    <p>
                      {settings.r2.lifecycle_applied
                        ? "✓ Lifecycle đã được R2 xác nhận ở lần lưu gần nhất."
                        : "Chưa xác nhận lifecycle. Cần lưu thành công với credential thật."}{" "}
                      Ứng dụng chặn tải khi hết hạn và chạy tác vụ dọn mỗi giờ;
                      R2 có thể xóa vật lý trễ hơn mốc hết hạn.
                    </p>
                  </>
                )}
                <p className="report-note">
                  Ghi hình hiện dùng trình duyệt giáo viên để ghi màn hình, chưa
                  có worker ghi tự động toàn bộ cuộc gọi. Cần thử đoạn ngắn và
                  xác nhận audio trước khi sử dụng.
                </p>
              </section>
              <div className="setup-save">
                <button disabled={busy}>
                  {busy ? "Đang kiểm tra và lưu…" : "Lưu cấu hình & khởi tạo"}
                </button>
                <a className="secondary setup-login-link" href="/">
                  Đến trang đăng nhập →
                </a>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api("/setup/lock", {});
                      setUnlocked(false);
                      setSettings(blank);
                    })
                  }
                >
                  Khóa cấu hình
                </button>
              </div>
            </form>
            <p className="setup-footer">
              Secret lưu ở volume riêng trên VPS, không commit Git và không trả
              về trong API đọc cấu hình. Bảo vệ cả thư mục runtime-config khi
              backup. Domain thay đổi cần cập nhật DNS/Caddy và cấu hình triển
              khai, không chỉ sửa tại trang này.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
