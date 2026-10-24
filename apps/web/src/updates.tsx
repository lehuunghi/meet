import { useEffect, useState } from "react";
import { api } from "./api";

export function SystemUpdates() {
  const [status, setStatus] = useState<any>({}),
    [error, setError] = useState(""),
    [pending, setPending] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const value = await api("/setup/updates");
        if (!alive) return;
        setStatus(value);
        setError("");
        if (
          value.id === pending &&
          [
            "checked",
            "success",
            "rolled_back",
            "failed",
            "recovery_required",
          ].includes(value.state)
        )
          setPending("");
      } catch {
        if (alive)
          setError(
            "Chưa kết nối được. Nếu đang nâng cấp, đợi dịch vụ khởi động lại; không cài lại hoặc gửi thêm yêu cầu.",
          );
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [pending]);
  const processing =
    busy ||
    !!pending ||
    ["updating", "checking", "recovery_required"].includes(status.state);
  async function request(action: string) {
    setBusy(true);
    setError("");
    try {
      const result = await api("/setup/updates", {
        action,
        target: action === "apply" ? status.available_sha : "",
      });
      setPending(result.id);
      setConfirmed(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="section" id="setup-updates">
      <h2>Cập nhật phiên bản từ GitHub</h2>
      <p>
        Giữ nguyên dữ liệu, domain và cấu hình. Chỉ cập nhật bản đã qua kiểm thử
        từ repository lehuunghi/meet. Không cập nhật khi có buổi học đang diễn
        ra.
      </p>
      <dl className="update-versions">
        <div>
          <dt>Đang chạy</dt>
          <dd>
            {status.running_version ||
              status.current_version ||
              "Chưa xác định"}{" "}
            ·{" "}
            <code>
              {(status.running_commit || status.current_sha || "").slice(0, 12)}
            </code>
          </dd>
        </div>
        <div>
          <dt>Bản trên GitHub</dt>
          <dd>
            {status.available_version || "Bấm kiểm tra phiên bản"} ·{" "}
            <code>{(status.available_sha || "").slice(0, 12)}</code>
          </dd>
        </div>
      </dl>
      <p role="status">
        {pending && status.id !== pending
          ? "Đã xếp hàng; dịch vụ VPS sẽ nhận trong khoảng một phút."
          : status.message || "Đang kết nối dịch vụ cập nhật…"}
      </p>
      {status.phase && (
        <p>
          Bước:{" "}
          {(
            {
              check: "Kiểm tra GitHub",
              preflight: "Kiểm tra điều kiện",
              build: "Dựng phiên bản mới",
              backup: "Sao lưu phục hồi",
              migrate: "Nâng cấp dữ liệu",
              verify: "Kiểm tra bản mới",
              rollback: "Phục hồi bản trước",
              done: "Hoàn tất",
              stopped: "Cần người vận hành",
            } as Record<string, string>
          )[status.phase] || status.phase}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button
        type="button"
        className="secondary"
        disabled={processing || !status.agent_available}
        onClick={() => void request("check")}
      >
        Kiểm tra phiên bản
      </button>
      {status.can_update && (
        <div className="update-confirm">
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={processing}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Tôi đã kết thúc các buổi học và đồng ý tạm khóa hệ thống để sao lưu,
            cập nhật bản {(status.available_sha || "").slice(0, 12)}.
          </label>
          <button
            type="button"
            disabled={!confirmed || processing || !status.agent_available}
            onClick={() => void request("apply")}
          >
            Sao lưu và cập nhật an toàn
          </button>
        </div>
      )}
      <p>
        Bản phục hồi được mã hóa, lưu riêng trên VPS; nếu R2 đang bật thì phải
        tải lên và xác minh thành công trước nâng cấp. Kiểm tra lỗi sẽ phục hồi
        database và ứng dụng trước khi mở lại ghi dữ liệu. Không tự nâng cấp
        MySQL/Redis hoặc đổi hạ tầng.
      </p>
      {!status.agent_available && (
        <p>
          Cài mới đã kèm dịch vụ cập nhật. Máy cài trước cần bật dịch vụ một lần
          theo{" "}
          <a
            href="https://github.com/lehuunghi/meet/blob/codex/multi-school-platform/docs/CAP-NHAT-AN-TOAN.vi.md"
            target="_blank"
            rel="noreferrer"
          >
            hướng dẫn cập nhật
          </a>
          .
        </p>
      )}
    </section>
  );
}
