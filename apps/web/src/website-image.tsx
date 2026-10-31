import { useEffect, useRef, useState } from "react";
import { api } from "./api";
export function WebsiteImage({
  label,
  value,
  onChange,
  demo = false,
  onBusy = () => {},
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  demo?: boolean;
  onBusy?: (change: number) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [library, setLibrary] = useState<any[] | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function upload(file: File) {
    setError("");
    if (
      !["image/png", "image/jpeg"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      setError("Chọn ảnh PNG/JPG tối đa 5 MB");
      return;
    }
    setBusy(true);
    onBusy(1);
    try {
      let url = "";
      if (demo)
        url = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      else {
        const form = new FormData();
        form.append("image", file);
        url = (await api("/academy/site/images", form)).url;
      }
      if (alive.current) {
        onChange(url);
        setLibrary(null);
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
      onBusy(-1);
    }
  }
  return (
    <div className="website-image-control">
      <label>
        {label}
        <input
          type="file"
          aria-label={"Tải " + label.toLowerCase()}
          accept="image/png,image/jpeg"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />
      </label>
      <small>
        PNG/JPG tối đa 5 MB · tối đa 4096 × 4096. Chọn ảnh rồi lưu website để
        công khai.
      </small>
      {value && <img src={value} alt={label} loading="lazy" />}
      <div className="academy-actions">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={async () => {
            try {
              setLibrary(demo ? [] : await api<any[]>("/academy/site/images"));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Chọn ảnh đã tải
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy || !value}
          onClick={() => onChange("")}
        >
          Gỡ ảnh
        </button>
      </div>
      {busy && <p role="status">Đang tải ảnh…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {library && (
        <div className="website-image-library">
          {library.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => {
                onChange(row.url);
                setLibrary(null);
              }}
            >
              <img src={row.url} alt={row.filename} />
              <span>{row.filename}</span>
            </button>
          ))}
          {!library.length && <p>Chưa có ảnh đã tải.</p>}
          <button
            type="button"
            className="secondary"
            onClick={() => setLibrary(null)}
          >
            Đóng thư viện
          </button>
        </div>
      )}
    </div>
  );
}
