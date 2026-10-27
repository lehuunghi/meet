import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { applyUITexts } from "./ui-language";
import {
  markFormClean,
  markFormDirty,
  confirmFormReload,
} from "./form-guard-core";
export function UILanguageEditor({ demo = false }: { demo?: boolean }) {
  const [catalog, setCatalog] = useState<any[]>([]),
    [texts, setTexts] = useState<Record<string, string>>({}),
    [revision, setRevision] = useState(0),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const form = useRef<HTMLFormElement>(null),
    saved = useRef("{}");
  async function load() {
    const v = demo
      ? {
          catalog: [
            { key: "Danh sách bài giảng", area: "Website công khai" },
            { key: "Đăng nhập", area: "Giao diện" },
          ],
          texts: {},
          revision: 0,
        }
      : await api("/academy/admin/ui-texts");
    setCatalog(v.catalog || []);
    setTexts(v.texts || {});
    setRevision(v.revision || 0);
    saved.current = JSON.stringify(v.texts || {});
    setLoaded(true);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [demo]);
  useEffect(() => {
    if (loaded) {
      if (JSON.stringify(texts) === saved.current) markFormClean(form.current);
      else markFormDirty(form.current);
    }
  }, [texts, loaded]);
  const result = catalog.filter((v) =>
      (v.key + " " + v.area + " " + (texts[v.key] || ""))
        .toLocaleLowerCase("vi")
        .includes(query.toLocaleLowerCase("vi")),
    ),
    visible = result.slice(page * 40, page * 40 + 40);
  return (
    <section className="academy-language-editor">
      <h3>Ngôn ngữ & câu chữ</h3>
      <p>
        Đổi chữ giao diện chung ở trang giới thiệu, đăng ký, học viên, giáo
        viên, quản trị và phòng học. Nội dung riêng như tên khóa, bài viết và
        thông tin giáo viên được sửa ở chuyên mục tương ứng. Không thay đổi
        đường dẫn, dữ liệu học tập hoặc quyền truy cập.
      </p>
      <p>
        {catalog.length} câu chữ · {Object.keys(texts).length} mục tùy chỉnh. Để
        trống bản thay thế để dùng chữ mặc định.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <label>
        Tìm câu chữ
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
      </label>
      <form
        ref={form}
        onSubmit={(e) => {
          e.preventDefault();
          if (busy || !loaded) return;
          setBusy(true);
          setError("");
          void (async () => {
            if (demo) {
              setNotice("Bản minh họa không lưu ngôn ngữ thật.");
              return;
            }
            const out = await api("/academy/admin/ui-texts", {
              texts,
              revision,
            });
            setRevision(out.revision);
            saved.current = JSON.stringify(texts);
            markFormClean(form.current);
            applyUITexts(texts);
            setNotice(
              "Đã lưu câu chữ. Các trang khác nhận nội dung mới khi tải lại.",
            );
          })()
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        <fieldset disabled={busy || !loaded}>
          <legend>Chỉnh câu chữ hiển thị</legend>
          <div className="academy-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Chữ mặc định</th>
                  <th>Chữ thay thế</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((v) => (
                  <tr key={v.key}>
                    <td>
                      <strong>{v.key}</strong>
                      <small>{v.area}</small>
                    </td>
                    <td>
                      <textarea
                        aria-label={"Thay thế: " + v.key}
                        rows={3}
                        maxLength={2000}
                        value={texts[v.key] || ""}
                        placeholder={v.key}
                        onChange={(e) => {
                          const next = { ...texts };
                          if (e.target.value) next[v.key] = e.target.value;
                          else delete next[v.key];
                          setTexts(next);
                        }}
                      />
                      <button
                        type="button"
                        disabled={!texts[v.key]}
                        onClick={() => {
                          const next = { ...texts };
                          delete next[v.key];
                          setTexts(next);
                        }}
                      >
                        Mặc định
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="academy-actions">
            <button
              type="button"
              disabled={!page}
              onClick={() => setPage(page - 1)}
            >
              Trang trước
            </button>
            <span>
              Trang {page + 1} / {Math.max(1, Math.ceil(result.length / 40))}
            </span>
            <button
              type="button"
              disabled={(page + 1) * 40 >= result.length}
              onClick={() => setPage(page + 1)}
            >
              Trang sau
            </button>
          </div>
          <div className="academy-actions">
            <button>Lưu ngôn ngữ</button>
            <button
              type="button"
              onClick={() => {
                if (confirmFormReload(form.current))
                  void load().catch((e) => setError(e.message));
              }}
            >
              Tải lại ngôn ngữ
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    "Khôi phục toàn bộ câu chữ mặc định? Bấm Lưu ngôn ngữ để áp dụng.",
                  )
                )
                  setTexts({});
              }}
            >
              Khôi phục mặc định
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
