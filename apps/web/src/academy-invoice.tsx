import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { vnDateTime } from "./date-format";
export function InvoiceButton({
  orderId,
  number,
  demo = false,
}: {
  orderId: string;
  number?: string;
  demo?: boolean;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  if (!number) return null;
  return (
    <>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            setData(
              demo
                ? {
                    number,
                    buyer_name: "Học viên demo",
                    buyer_email: "demo@example.test",
                    plan_name: "VIP minh họa",
                    amount_vnd: 299000,
                    days: 30,
                    status: "pending",
                    created_at: new Date().toISOString(),
                    school_name: "VA Academy",
                  }
                : await api(`/academy/orders/${orderId}/invoice`),
            );
            dialog.current?.showModal();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Xem hóa đơn
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <dialog ref={dialog} className="academy-invoice-dialog">
        <div className="academy-invoice-print">
          {data && (
            <>
              <p className="academy-eyebrow">{data.school_name}</p>
              <h2>Hóa đơn thanh toán</h2>
              <p>
                <strong>{data.number}</strong> · {vnDateTime(data.created_at)}
              </p>
              <dl>
                <dt>Học viên</dt>
                <dd>{data.buyer_name}</dd>
                <dt>Email</dt>
                <dd>{data.buyer_email}</dd>
                <dt>Gói học</dt>
                <dd>{data.plan_name}</dd>
                <dt>Thời hạn gói</dt>
                <dd>{data.days} ngày</dd>
                <dt>Số tiền</dt>
                <dd>{Number(data.amount_vnd).toLocaleString("vi-VN")} VND</dd>
                <dt>Trạng thái</dt>
                <dd>
                  {data.status === "paid"
                    ? "Đã thanh toán"
                    : data.status === "rejected"
                      ? "Đã từ chối"
                      : data.status === "refunded"
                        ? "Đã hoàn tiền"
                        : "Đã xác nhận chuyển khoản — chờ đối soát"}
                </dd>
                {data.paid_at && (
                  <>
                    <dt>Ngày xác nhận thu</dt>
                    <dd>{vnDateTime(data.paid_at)}</dd>
                  </>
                )}
              </dl>
              {data.status === "pending" && (
                <p>
                  Biên lai và xác nhận của học viên đang chờ đối soát; chưa kích
                  hoạt VIP.
                </p>
              )}
              <small>
                Chứng từ thanh toán nội bộ của nền tảng, không thay thế hóa đơn
                thuế.
              </small>
            </>
          )}
        </div>
        <div className="academy-actions invoice-no-print">
          <button
            type="button"
            className="academy-primary"
            onClick={() => window.print()}
          >
            In / Lưu PDF
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => dialog.current?.close()}
          >
            Đóng hóa đơn
          </button>
        </div>
      </dialog>
    </>
  );
}
export function ReceiptTransfer({
  order,
  demo,
  onRefresh,
}: {
  order: any;
  demo: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [uploaded, setUploaded] = useState(!!order.has_receipt),
    [preview, setPreview] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  useEffect(() => setUploaded(!!order.has_receipt), [order.has_receipt]);
  return (
    <section className="academy-transfer">
      <p>
        Tải ảnh biên lai rồi xác nhận đã chuyển khoản để tạo hóa đơn chờ đối
        soát. Hệ thống không tự kích hoạt VIP từ ảnh biên lai.
      </p>
      {order.status === "pending" && !order.invoice_number && (
        <>
          <label>
            Đính kèm biên lai
            <input
              type="file"
              accept="image/png,image/jpeg"
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setError("");
                setMessage("");
                if (
                  !["image/png", "image/jpeg"].includes(file.type) ||
                  file.size > 2 * 1024 * 1024
                ) {
                  setError("Chọn ảnh biên lai PNG/JPG tối đa 2 MB");
                  return;
                }
                setUploaded(false);
                setPreview("");
                setBusy(true);
                try {
                  if (!demo) {
                    const signed = await api("/academy/uploads", {
                      kind: "receipts",
                      type: file.type,
                      size: file.size,
                      order: order.id,
                    });
                    const response = await fetch(signed.url, {
                      method: "PUT",
                      headers: { "Content-Type": file.type },
                      body: file,
                    });
                    if (!response.ok) throw Error("Tải biên lai thất bại");
                    await api(`/academy/orders/${order.id}/receipt`, {
                      key: signed.key,
                    });
                  }
                  if (alive.current) {
                    setUploaded(true);
                    setPreview(URL.createObjectURL(file));
                    setMessage(
                      "Ảnh đã tải xong. Bấm xác nhận bên dưới để tạo hóa đơn.",
                    );
                  }
                } catch (e) {
                  if (alive.current) setError((e as Error).message);
                } finally {
                  if (alive.current) setBusy(false);
                }
              }}
            />
          </label>
          {preview && (
            <img
              className="academy-receipt-preview"
              src={preview}
              alt="Biên lai đã chọn"
            />
          )}
          <button
            type="button"
            className="academy-primary"
            disabled={busy || !uploaded}
            onClick={async () => {
              setBusy(true);
              setError("");
              setMessage("");
              try {
                if (demo) {
                  setMessage(
                    "Đã mô phỏng xác nhận chuyển khoản; không tạo hóa đơn thật.",
                  );
                  return;
                }
                await api(`/academy/orders/${order.id}/confirm-transfer`, {
                  confirm: true,
                });
                await onRefresh();
                setMessage(
                  "Đã tạo hóa đơn chờ đối soát. VIP sẽ mở sau khi xác nhận thanh toán.",
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Đang xử lý…" : "Đã chuyển khoản — Tạo hóa đơn"}
          </button>
        </>
      )}
      {order.invoice_number && (
        <div className="academy-actions">
          <span>
            Hóa đơn: <strong>{order.invoice_number}</strong>
          </span>
          <InvoiceButton
            orderId={order.id}
            number={order.invoice_number}
            demo={demo}
          />
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
