import { UILanguageEditor } from "./ui-language-editor";
import { useEffect, useState, useRef } from "react";
import { api } from "./api";
import { useAcademyRoute, goAcademy, academyHref } from "./academy-route";
import {
  confirmFormReload,
  markFormClean,
  markFormDirty,
} from "./form-guard-core";
const cmsSections = [
  ["tong-quan", "Tổng quan"],
  ["trang-chu", "Trang chủ & giới thiệu"],
  ["khoa-hoc", "Trang khóa học"],
  ["giao-vien", "Giáo viên"],
  ["cam-nhan", "Cảm nhận"],
  ["bai-viet", "Bài viết"],
 ["cau-hoi", "Câu hỏi thường gặp"],
  ["lien-he", "Liên hệ"],
  ["chinh-sach", "Chính sách"],
  ["ngon-ngu", "Ngôn ngữ & câu chữ"],
  ["tat-ca", "Tất cả nội dung"],
];
export function AcademySiteEditor({ demo, courses, perform, notice }: any) {
  useAcademyRoute();
  const requested =
    new URLSearchParams(location.search).get("muc") || "tong-quan";
  const section = cmsSections.some(([id]) => id === requested)
    ? requested
    : "tong-quan";
  const [languageVisited, setLanguageVisited] = useState(
    section === "ngon-ngu",
  );
  useEffect(() => {
    if (section === "ngon-ngu") setLanguageVisited(true);
  }, [section]);
  const visible = (key: string) => section === key || section === "tat-ca";
  const chooseSection = (key: string) =>
    goAcademy("/quan-tri/website?muc=" + key, true);
  const formRef = useRef<HTMLFormElement>(null);
  const savedValue = useRef(
    JSON.stringify({ headline: "", description: "", published: false }),
  );
  const [reloadSerial, setReloadSerial] = useState(0);
  useEffect(() => {
    markFormClean(formRef.current);
  }, [reloadSerial]);
  const [value, setValue] = useState<any>({
      headline: "",
      description: "",
      published: false,
    }),
    [revision, setRevision] = useState(""),
    [loaded, setLoaded] = useState(demo),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [selected, setSelected] = useState(""),
    [lessons, setLessons] = useState<any[]>([]);
  useEffect(() => {
    if (loaded) {
      if (JSON.stringify(value) !== savedValue.current)
        markFormDirty(formRef.current);
      else markFormClean(formRef.current);
    }
  }, [value, loaded]);
  const [previewHTML, setPreviewHTML] = useState(""),
    [previewBusy, setPreviewBusy] = useState(false),
    [previewWidth, setPreviewWidth] = useState("100%");
  const previewRef = useRef<HTMLDialogElement>(null);
  async function preview(target: any = {}) {
    if (previewBusy) return;
    setPreviewBusy(true);
    try {
      if (demo) {
        notice("Xem trước nội dung thật cần tài khoản quản trị.");
        return;
      }
      const result = await api("/academy/site/preview", {
        content: value,
        ...target,
      });
      setPreviewHTML(result.html);
      previewRef.current?.showModal();
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setPreviewBusy(false);
    }
  }
  async function load() {
    setLoaded(false);
    setError("");
    try {
      const rows = await api<any[]>("/academy/site");
      const parsed = rows[0] ? JSON.parse(rows[0].content) : null;
      if (parsed) {
        parsed.posts = (parsed.posts || []).map((p: any) => ({
 ...p, Image:p.Image??p.image??"",
          Slug: p.Slug ?? p.slug ?? "",
          Title: p.Title ?? p.title ?? "",
          Summary: p.Summary ?? p.summary ?? "",
          Body: p.Body ?? p.body ?? "",
          Published: p.Published ?? p.published ?? false,
        }));
        parsed.testimonials = (parsed.testimonials || []).map((t: any) => ({
 ...t, Image:t.Image??t.image??"", Sample:t.Sample??t.sample??false,
          Name: t.Name ?? t.name ?? "",
          Text: t.Text ?? t.text ?? "",
          Audience: t.Audience ?? t.audience ?? "",
          Rating: t.Rating ?? t.rating ?? 0,
          Published: t.Published ?? t.published ?? true,
        }));
      }
      const actual = parsed || {
        headline: "",
        description: "",
        published: false,
      };
      savedValue.current = JSON.stringify(actual);
      setValue(actual);
      setRevision(rows[0]?.revision || "");
      setLoaded(true);
      setReloadSerial((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (!demo) void load();
  }, []);
  useEffect(() => {
    setLessons([]);
    if (!demo && selected) {
      let active = true;
      void api<any[]>(`/academy/courses/${selected}/lessons`)
        .then((v) => {
          if (active) setLessons(v);
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }
  }, [selected, demo]);
  const field = (key: string, label: string, multiline = false) => (
    <label key={key}>
      {label}
      {multiline ? (
        <textarea
          aria-label={label}
          rows={5}
          maxLength={20000}
          value={value[key] || ""}
          onChange={(e) => setValue({ ...value, [key]: e.target.value })}
        />
      ) : (
        <input
          aria-label={label}
          type={key === "contact_email" ? "email" : "text"}
          maxLength={500}
          value={value[key] || ""}
          onChange={(e) => setValue({ ...value, [key]: e.target.value })}
        />
      )}
    </label>
  );
  const page = value.course_pages?.[selected] || {};
  const changePage = (key: string, text: string) =>
    setValue({
      ...value,
      course_pages: {
        ...value.course_pages,
        [selected]: { ...page, [key]: text },
      },
    });
  const changeRow = (key: string, index: number, field: string, text: any) =>
    setValue({
      ...value,
      [key]: (value[key] || []).map((v: any, i: number) =>
        i === index ? { ...v, [field]: text } : v,
      ),
    });
  return (
    <section className="academy-section academy-site-editor">
      <h2>Website giới thiệu</h2>
      <p>
        Nội dung công khai chỉ xuất hiện khi website được xuất bản. Các trường
        để trống sẽ được ẩn. Có thể bật sẵn mục giáo viên và cảm nhận; từng hồ
        sơ mới được giữ nháp đến khi anh/chị chọn công khai.
      </p>
      <div className="academy-cms-layout">
        <nav
          className="academy-cms-nav"
          aria-label="Chuyên mục quản trị website"
        >
          <strong>WEBSITE</strong>
          {cmsSections.map(([id, label]) => (
            <a
              key={id}
              href={academyHref("/quan-tri/website?muc=" + id)}
              aria-current={section === id ? "page" : undefined}
              onClick={(e) => {
                if (
                  e.button !== 0 ||
                  e.ctrlKey ||
                  e.metaKey ||
                  e.shiftKey ||
                  e.altKey
                )
                  return;
                e.preventDefault();
                chooseSection(id);
              }}
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="academy-cms-main">
          <label className="academy-cms-mobile-menu">
            Chuyên mục quản trị
            <select
              value={section}
              onChange={(e) => chooseSection(e.target.value)}
            >
              {cmsSections.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <h3 className="academy-cms-title">
            {cmsSections.find(([id]) => id === section)?.[1]}
          </h3>
          {languageVisited && (
            <div hidden={section !== "ngon-ngu"}>
              <UILanguageEditor demo={demo} />
            </div>
          )}
          <div hidden={section === "ngon-ngu"}>
            <div className="academy-website-toolbar">
              <span>
                {value.published
                  ? "Website đang công khai"
                  : "Website đang ở chế độ nháp"}
              </span>
              <button
                type="button"
                disabled={!loaded || previewBusy || saving}
                onClick={() => void preview()}
              >
                {previewBusy
                  ? "Đang dựng bản xem trước…"
                  : "Xem trước toàn website"}
              </button>
              <a href="/" target="_blank" rel="noopener">
                Mở website đang công khai ↗
              </a>
              {section === "tat-ca" && (
                <button
                  type="button"
                  onClick={() =>
                    formRef.current
                      ?.querySelectorAll("details")
                      .forEach((d) => (d.open = true))
                  }
                >
                  Mở tất cả các mục
                </button>
              )}
              {section === "tat-ca" && (
                <button
                  type="button"
                  onClick={() =>
                    formRef.current
                      ?.querySelectorAll("details")
                      .forEach((d) => (d.open = false))
                  }
                >
                  Thu gọn các mục
                </button>
              )}
            </div>
            <p>
              Thêm, sửa hoặc xóa nội dung rồi bấm Lưu website để áp dụng. Bản
              xem trước hiển thị nội dung đang chỉnh, kể cả bản nháp; không tự
              lưu hoặc công khai.
            </p>
            {error && (
              <p className="error" role="alert">
                {error}{" "}
                <button
                  onClick={() => {
                    if (confirmFormReload(formRef.current)) void load();
                  }}
                >
                  Tải lại nội dung
                </button>
              </p>
            )}
            <button
              type="button"
              className="secondary"
              disabled={demo || saving}
              onClick={() => {
                if (confirmFormReload(formRef.current)) void load();
              }}
            >
              Tải lại nội dung website đã lưu
            </button>
            <form
              ref={formRef}
              onSubmit={(e) => {
                e.preventDefault();
                if (!loaded || saving) return;
                setSaving(true);
                void perform(async () => {
                  if (!demo) {
                    const out = await api("/academy/site", {
                      content: value,
                      revision,
                    });
                    setRevision(out.revision);
                    savedValue.current = JSON.stringify(value);
                    markFormClean(formRef.current);
                  }
                  notice(
                    demo
                      ? "Website minh họa, chưa lưu máy chủ."
                      : "Đã lưu website và nội dung khóa học.",
                  );
                }).finally(() => setSaving(false));
              }}
            >
              {section === "tong-quan" && (
                <section className="academy-cms-overview">
                  <p>
                    Chọn một chuyên mục bên trái để quản lý. Thay đổi được giữ
                    khi chuyển mục; bấm Lưu website để áp dụng toàn bộ.
                  </p>
                  <div className="academy-cms-stats">
                    {[
                      ["khoa-hoc", "Trang khóa học", courses.length],
                      [
                        "giao-vien",
                        "Hồ sơ giáo viên",
                        (value.teachers || []).length,
                      ],
                      [
                        "cam-nhan",
                        "Cảm nhận",
                        (value.testimonials || []).length,
                      ],
                      ["bai-viet", "Bài viết", (value.posts || []).length],
                    ].map(([id, label, count]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => chooseSection(String(id))}
                      >
                        <strong>{count}</strong>
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                  <p>
                    <strong>
                      {value.published ? "Đang công khai" : "Đang giữ nháp"}
                    </strong>{" "}
                    ·{" "}
                    {
                      (value.posts || []).filter(
                        (p: any) => p.Published ?? p.published,
                      ).length
                    }{" "}
                    bài viết công khai. Giáo viên và cảm nhận mới luôn bắt đầu ở
                    chế độ nháp.
                  </p>
                </section>
              )}
              <fieldset
                hidden={!visible("trang-chu")}
                disabled={!loaded || saving}
              >
                <legend>Thương hiệu & giới thiệu</legend>
                {field("headline", "Tên nền tảng")}
                {field("description", "Thông điệp giới thiệu", true)}
                {field("about", "Giới thiệu đơn vị", true)}
 {field("hero_image", "Ảnh banner trang chủ (URL)")}
 {field("about_image", "Ảnh giới thiệu (URL)")}
 <small>Dùng ảnh công khai HTTPS hoặc đường dẫn /images/. Có thể thay ảnh mẫu bằng ảnh thật của đơn vị.</small>
                <label className="academy-check">
                  <input
                    type="checkbox"
                    checked={!!value.published}
                    onChange={(e) =>
                      setValue({ ...value, published: e.target.checked })
                    }
                  />
                  Xuất bản website
                </label>
              </fieldset>
              <details
                hidden={!visible("lien-he") && !visible("chinh-sach")}
                open={section !== "tat-ca"}
              >
                <summary>Liên hệ & chính sách</summary>
                <fieldset disabled={!loaded || saving}>
                  <legend>Thông tin hỗ trợ</legend>
                  <div hidden={!visible("lien-he")}>
                    {field("contact_email", "Email liên hệ")}
                    {field("contact_phone", "Số điện thoại hỗ trợ")}
                    {field("address", "Địa chỉ", true)}
                  </div>
                  <div hidden={!visible("chinh-sach")}>
                    {field("terms", "Điều khoản sử dụng", true)}
                    {field("privacy", "Chính sách bảo mật", true)}
                    {field("refund", "Thanh toán & hoàn phí", true)}
                    <div className="academy-website-toolbar">
                      {[
                        ["terms", "Điều khoản"],
                        ["privacy", "Bảo mật"],
                        ["refund", "Thanh toán"],
                      ].map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          disabled={!loaded || previewBusy}
                          onClick={() => void preview({ policy: key })}
                        >
                          Xem đầy đủ {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </fieldset>
              </details>
              <details
                hidden={!visible("khoa-hoc")}
                open={section !== "tat-ca"}
              >
                <summary>Trang chi tiết khóa học</summary>
                <label>
                  Chọn khóa học để biên tập
                  <select
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    <option value="">Chọn khóa học</option>
                    {courses.map((c: any) => (
                      <option value={c.id} key={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </label>
                {selected && (
                  <fieldset disabled={!loaded || saving}>
                    <legend>Nội dung khóa học</legend>
                    {[
                      ["audience", "Đối tượng học"],
                      ["objectives", "Mục tiêu · mỗi dòng một mục"],
                      ["outline", "Chương trình · mỗi dòng một phần"],
                      ["schedule", "Lịch học & hình thức học"],
                    ].map(([key, label]) => (
                      <label key={key}>
                        {label}
                        <textarea
                          rows={4}
                          maxLength={10000}
                          value={page[key] || ""}
                          onChange={(e) => changePage(key, e.target.value)}
                        />
                      </label>
                    ))}
                    <label>
                      Bài học xem thử sau đăng nhập
                      <select
                        value={page.preview_lesson || ""}
                        onChange={(e) =>
                          changePage("preview_lesson", e.target.value)
                        }
                      >
                        <option value="">Không chọn bài học thử</option>
                        {lessons
                          .filter((l) => l.status === "ready")
                          .map((l) => (
                            <option value={l.id} key={l.id}>
                              {l.title}
                            </option>
                          ))}
                      </select>
                    </label>
                    <small>
                      Bài học thử vẫn áp dụng hạn mức của tài khoản; không công
                      khai đường dẫn lưu trữ video.
                    </small>
                    <a
                      href={"/khoa-hoc/" + selected}
                      target="_blank"
                      rel="noopener"
                    >
                      Xem trang công khai ↗
                    </a>
                    <button
                      type="button"
                      disabled={previewBusy}
                      onClick={() => void preview({ course: selected })}
                    >
                      Xem trước trang khóa học
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        if (
                          confirm(
                            "Xóa phần giới thiệu chi tiết của khóa này? Bản ghi khóa học và bài giảng được giữ nguyên.",
                          )
                        ) {
                          const pages = { ...value.course_pages };
                          delete pages[selected];
                          setValue({ ...value, course_pages: pages });
                        }
                      }}
                    >
                      Xóa nội dung giới thiệu khóa này
                    </button>
                  </fieldset>
                )}
              </details>
              <details
                hidden={!visible("giao-vien")}
                open={section !== "tat-ca"}
              >
                <summary>Hồ sơ giáo viên</summary>
                <fieldset disabled={!loaded || saving}>
                  <legend>Giáo viên giới thiệu công khai</legend>
                  <label className="academy-check">
                    <input
                      type="checkbox"
                      checked={!!value.show_teachers}
                      onChange={(e) =>
                        setValue({ ...value, show_teachers: e.target.checked })
                      }
                    />
                    Hiện mục giáo viên tiêu biểu kể cả khi đang cập nhật
                  </label>
                  {(value.teachers || []).map((t: any, i: number) => (
                    <div className="academy-editor-row" key={i}>
                      {[
                        ["Name", "Họ tên"],
                        ["Subject", "Môn phụ trách"],
                        ["Bio", "Kinh nghiệm & giới thiệu"],
 ["Image", "Ảnh giáo viên (URL)"],
                      ].map(([key, label]) => (
                        <label key={key}>
                          {label}
                          <textarea
                            aria-label={label}
                            maxLength={5000}
                            value={t[key] ?? t[key.toLowerCase()] ?? ""}
                            onChange={(e) => {
                              const next = {
 ...t,
                                Name: t.Name ?? t.name ?? "",
                                Subject: t.Subject ?? t.subject ?? "",
                                Bio: t.Bio ?? t.bio ?? "",
                                Published: t.Published ?? t.published ?? true,
                                [key]: e.target.value,
                              };
                              setValue({
                                ...value,
                                teachers: value.teachers.map(
                                  (v: any, n: number) => (n === i ? next : v),
                                ),
                              });
                            }}
                          />
                        </label>
                      ))}
                      <label className="academy-check">
                        <input
                          type="checkbox"
                          checked={t.Published ?? t.published ?? true}
                          onChange={(e) =>
                            setValue({
                              ...value,
                              teachers: value.teachers.map(
                                (v: any, n: number) =>
                                  n === i
                                    ? { ...v, Published: e.target.checked }
                                    : v,
                              ),
                            })
                          }
                        />
                        Công khai hồ sơ giáo viên này
                      </label>
                      <label className="academy-check"><input type="checkbox" checked={!!(t.Sample??t.sample)} onChange={e=>changeRow("teachers",i,"Sample",e.target.checked)}/>Hồ sơ mẫu / ảnh AI minh họa</label>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          setValue({
                            ...value,
                            teachers: value.teachers.filter(
                              (_: any, n: number) => n !== i,
                            ),
                          })
                        }
                      >
                        Xóa giáo viên giới thiệu
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setValue({
                        ...value,
                        teachers: [
                          ...(value.teachers || []),
                          { Name: "", Subject: "", Bio: "", Published: false },
                        ],
                      })
                    }
                  >
                    Thêm hồ sơ giáo viên
                  </button>
                </fieldset>
              </details>
              <details
                hidden={!visible("cam-nhan")}
                open={section !== "tat-ca"}
              >
                <summary>Cảm nhận học sinh & phụ huynh</summary>
                <fieldset disabled={!loaded || saving}>
                  <legend>Chia sẻ thực tế được đồng ý công khai</legend>
                  <p>
                    Nội dung mẫu phải giữ nhãn minh họa. Với đánh giá thật, chỉ đăng lời nhận xét đã được đồng ý sử dụng. Có thể
                    dùng tên viết tắt; không nhập số điện thoại hoặc thông tin
                    riêng tư của học sinh.
                  </p>
                  <label className="academy-check">
                    <input
                      type="checkbox"
                      checked={!!value.show_testimonials}
                      onChange={(e) =>
                        setValue({
                          ...value,
                          show_testimonials: e.target.checked,
                        })
                      }
                    />
                    Hiện mục cảm nhận kể cả khi đang cập nhật
                  </label>
                  {(value.testimonials || []).map((t: any, i: number) => (
                    <div className="academy-editor-row" key={i}>
                      <label>Ảnh người chia sẻ (URL)<input value={t.Image||""} onChange={e=>changeRow("testimonials",i,"Image",e.target.value)}/></label>
                      <label className="academy-check"><input type="checkbox" checked={!!t.Sample} onChange={e=>changeRow("testimonials",i,"Sample",e.target.checked)}/>Nội dung mẫu / ảnh AI minh họa</label>
                      <label>
                        Tên hiển thị
                        <input
                          maxLength={200}
                          value={t.Name}
                          onChange={(e) =>
                            changeRow("testimonials", i, "Name", e.target.value)
                          }
                        />
                      </label>
                      <label>
                        Người chia sẻ
                        <select
                          value={t.Audience}
                          onChange={(e) =>
                            changeRow(
                              "testimonials",
                              i,
                              "Audience",
                              e.target.value,
                            )
                          }
                        >
                          <option value="">Chưa chọn</option>
                          <option value="student">Học sinh</option>
                          <option value="parent">Phụ huynh</option>
                        </select>
                      </label>
                      <label>
                        Nội dung cảm nhận
                        <textarea
                          rows={4}
                          maxLength={5000}
                          value={t.Text}
                          onChange={(e) =>
                            changeRow("testimonials", i, "Text", e.target.value)
                          }
                        />
                      </label>
                      <label>
                        Điểm đánh giá (không bắt buộc)
                        <select
                          value={t.Rating}
                          onChange={(e) =>
                            changeRow(
                              "testimonials",
                              i,
                              "Rating",
                              Number(e.target.value),
                            )
                          }
                        >
                          <option value={0}>Không hiển thị điểm</option>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <option key={n} value={n}>
                              {n} / 5
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="academy-check">
                        <input
                          type="checkbox"
                          checked={t.Published}
                          onChange={(e) =>
                            changeRow(
                              "testimonials",
                              i,
                              "Published",
                              e.target.checked,
                            )
                          }
                        />
                        {t.Sample ? "Công khai nội dung mẫu — có nhãn minh họa" : "Công khai cảm nhận này — đã được người chia sẻ đồng ý"}
                      </label>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          setValue({
                            ...value,
                            testimonials: value.testimonials.filter(
                              (_: any, n: number) => n !== i,
                            ),
                          })
                        }
                      >
                        Xóa cảm nhận
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setValue({
                        ...value,
                        testimonials: [
                          ...(value.testimonials || []),
                          {
                            Name: "",
                            Text: "",
                            Audience: "student",
                            Rating: 0,
                            Published: false,
                          },
                        ],
                      })
                    }
                  >
                    Thêm cảm nhận
                  </button>
                </fieldset>
              </details>
              <details
                hidden={!visible("bai-viet")}
                open={section !== "tat-ca"}
              >
                <summary>Bài viết & lịch khai giảng</summary>
                <fieldset disabled={!loaded || saving}>
                  <legend>Bài viết</legend>
                  {(value.posts || []).map((p: any, i: number) => (
                    <div className="academy-editor-row" key={i}>
                      {[
                        [
                          "Slug",
                          "Đường dẫn ngắn (chữ thường, số, dấu gạch ngang)",
                        ],
                        ["Title", "Tiêu đề"],
                        ["Summary", "Tóm tắt"],
 ["Image", "Ảnh bài viết (URL)"],
                        ["Body", "Nội dung"],
                      ].map(([key, label]) => (
                        <label key={key}>
                          {label}
                          <textarea
                            aria-label={label}
                            maxLength={20000}
                            value={p[key] ?? p[key.toLowerCase()] ?? ""}
                            onChange={(e) =>
                              changeRow("posts", i, key, e.target.value)
                            }
                          />
                        </label>
                      ))}
                      <label className="academy-check">
                        <input
                          type="checkbox"
                          checked={!!(p.Published ?? p.published)}
                          onChange={(e) =>
                            changeRow("posts", i, "Published", e.target.checked)
                          }
                        />
                        Xuất bản bài viết
                      </label>
                      <button
                        type="button"
                        disabled={previewBusy}
                        onClick={() => void preview({ post: i })}
                      >
                        Xem đầy đủ bài viết
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          if (
                            !confirm(
                              "Xóa bài viết này khỏi nội dung website? Bấm Lưu website để áp dụng.",
                            )
                          )
                            return;
                          setValue({
                            ...value,
                            posts: value.posts.filter(
                              (_: any, n: number) => n !== i,
                            ),
                          });
                        }}
                      >
                        Xóa bài viết
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setValue({
                        ...value,
                        posts: [
                          ...(value.posts || []),
                          {
                            Slug: "",
                            Title: "",
                            Summary: "",
                            Body: "",
                            Published: false,
                          },
                        ],
                      })
                    }
                  >
                    Thêm bài viết
                  </button>
                </fieldset>
              </details>
              <fieldset hidden={!visible("cau-hoi")} disabled={!loaded || saving}><legend>Câu hỏi thường gặp</legend><p>Tối đa 30 câu. Nội dung được hiển thị trên trang chủ và có thể sửa, thêm hoặc xóa.</p>{(value.faqs||[]).map((f:any,i:number)=><div className="academy-editor-row" key={i}><label>Câu hỏi<input aria-label="Câu hỏi" required maxLength={300} value={f.Question||""} onChange={e=>changeRow("faqs",i,"Question",e.target.value)}/></label><label>Trả lời<textarea aria-label="Trả lời" required maxLength={5000} value={f.Answer||""} onChange={e=>changeRow("faqs",i,"Answer",e.target.value)}/></label><button type="button" className="secondary" onClick={()=>setValue({...value,faqs:value.faqs.filter((_:any,n:number)=>n!==i)})}>Xóa câu hỏi</button></div>)}<button type="button" disabled={(value.faqs||[]).length>=30} onClick={()=>setValue({...value,faqs:[...(value.faqs||[]),{Question:"",Answer:""}]})}>Thêm câu hỏi</button></fieldset>
              <button disabled={!loaded || saving}>
                {saving ? "Đang lưu…" : "Lưu website"}
              </button>
            </form>
          </div>
        </div>
      </div>
      <dialog
        ref={previewRef}
        className="academy-website-preview"
        aria-label="Xem trước website"
      >
        <div className="academy-website-toolbar">
          <strong>Bản xem trước riêng — chưa lưu</strong>
          <label>
            Thiết bị
            <select
              value={previewWidth}
              onChange={(e) => setPreviewWidth(e.target.value)}
            >
              <option value="100%">Máy tính</option>
              <option value="390px">Điện thoại</option>
            </select>
          </label>
          <button type="button" onClick={() => previewRef.current?.close()}>
            Đóng bản xem trước
          </button>
        </div>
        <div
          className="academy-website-preview-frame"
          data-device={previewWidth === "390px" ? "mobile" : "desktop"}
        >
          <iframe
            title="Nội dung website đang chỉnh"
            sandbox=""
            srcDoc={previewHTML}
          />
        </div>
      </dialog>
    </section>
  );
}
export function AcademyCourseEditor({
  demo,
  courses,
  perform,
  refresh,
  notice,
}: any) {
  const empty = {
    id: "",
    title: "",
    description: "",
    teacher: "",
    academic_course_id: "",
    published: false,
  };
  const [value, setValue] = useState<any>(empty),
    [busy, setBusy] = useState(false),
    [deleteConfirm, setDeleteConfirm] = useState("");
  const [liveSubjects, setLiveSubjects] = useState<any[]>([]);
  useEffect(() => {
    let active = true;
    void (
      demo
        ? Promise.resolve([
            {
              id: "demo-academic-math",
              class_name: "10A1",
              name: "Toán",
              teacher: "Giáo viên minh họa",
              class_state: "active",
            },
          ])
        : api("/catalog")
    )
      .then((v) => {
        if (active) setLiveSubjects(v);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [demo]);
  const savedCourse = courses.find((c: any) => c.id === value.id);
  return (
    <section className="academy-section">
      <h2>Tạo & sửa khóa học</h2>
      <label>
        Khóa học cần chỉnh sửa
        <select
          value={value.id}
          onChange={(e) => {
            setDeleteConfirm("");
            const c = courses.find((v: any) => v.id === e.target.value);
            setValue(
              c
                ? {
                    id: c.id,
                    title: c.title,
                    description: c.description,
                    teacher: c.teacher_name || "",
                    academic_course_id: c.academic_course_id || "",
                    published: !!c.published,
                  }
                : empty,
            );
          }}
        >
          <option value="">Tạo khóa học mới</option>
          {courses.map((c: any) => (
            <option value={c.id} key={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          void perform(async () => {
            if (!demo) await api("/academy/courses", value);
            await refresh();
            notice(
              demo
                ? "Khóa học minh họa chưa lưu máy chủ."
                : "Đã lưu khóa học. Biên tập mục tiêu, chương trình và lịch trong Website giới thiệu.",
            );
            if (!value.id) setValue(empty);
          }).finally(() => setBusy(false));
        }}
      >
        {[
          ["title", "Tên khóa học"],
          ["description", "Giới thiệu khóa học"],
          ["teacher", "Giáo viên hiển thị"],
        ].map(([key, label]) => (
          <label key={key}>
            {label}
            {key === "description" ? (
              <textarea
                rows={5}
                maxLength={20000}
                required
                value={value[key]}
                onChange={(e) => setValue({ ...value, [key]: e.target.value })}
              />
            ) : (
              <input
                maxLength={key === "title" ? 200 : 190}
                required={key === "title"}
                value={value[key]}
                onChange={(e) => setValue({ ...value, [key]: e.target.value })}
              />
            )}
          </label>
        ))}
        <label>
          Lớp & môn trực tuyến liên kết
          <select
            value={value.academic_course_id}
            onChange={(e) => {
              const subject = liveSubjects.find((v) => v.id === e.target.value);
              setValue({
                ...value,
                academic_course_id: e.target.value,
                teacher: subject?.teacher_id ? subject.teacher : value.teacher,
              });
            }}
          >
            <option value="">Chỉ video / chưa liên kết lớp Live</option>
            {value.academic_course_id &&
              !liveSubjects.some((v) => v.id === value.academic_course_id) && (
                <option value={value.academic_course_id}>
                  Liên kết đã lưu
                </option>
              )}
            {liveSubjects.map((subject) => (
              <option
                key={subject.id}
                value={subject.id}
                disabled={
                  subject.class_state === "deleted" &&
                  value.academic_course_id !== subject.id
                }
              >
                {subject.class_name} · {subject.name} · {subject.teacher}
                {subject.class_state === "suspended"
                  ? " · Tạm ngưng"
                  : subject.class_state === "deleted"
                    ? " · Đã xóa"
                    : ""}
              </option>
            ))}
          </select>
        </label>
        <p>
          Học sinh mở lớp Live ngay từ khóa học; giáo viên mở kho bài giảng ngay
          trong lớp. Chỉ liên kết lớp/môn phù hợp nội dung khóa học.
        </p>
        {value.description && value.title === value.description && (
          <p>
            Giới thiệu nên mô tả nội dung và lợi ích cụ thể, tránh lặp lại tên
            khóa học.
          </p>
        )}
        <label className="academy-check">
          <input
            type="checkbox"
            checked={value.published}
            onChange={(e) =>
              setValue({ ...value, published: e.target.checked })
            }
          />
          Xuất bản
        </label>
        <button disabled={busy}>{busy ? "Đang lưu…" : "Lưu khóa học"}</button>
      </form>
      {savedCourse && (
        <section aria-label="Xóa vĩnh viễn khóa học">
          <h3>Xóa vĩnh viễn khóa học</h3>
          <p>
            Chỉ xóa khóa chưa có bài giảng hoặc bài tập. Trang giới thiệu khóa
            học cũng được xóa. Lớp, môn Live và tài khoản học sinh được giữ
            nguyên. Với khóa đã có nội dung, bỏ chọn Xuất bản để ngừng hiển thị.
          </p>
          <label>
            Nhập đúng tên khóa học: {savedCourse.title}
            <input
              value={deleteConfirm}
              autoComplete="off"
              onChange={(e) => setDeleteConfirm(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy || deleteConfirm !== savedCourse.title}
            onClick={() => {
              if (
                !confirm(
                  `Xóa vĩnh viễn khóa học “${savedCourse.title}”? Thao tác này không thể hoàn tác trong danh mục.`,
                )
              )
                return;
              setBusy(true);
              void perform(async () => {
                if (demo) {
                  notice("Bản demo không xóa dữ liệu thật.");
                  return;
                }
                await api(`/academy/courses/${value.id}/delete`, {
                  confirm: deleteConfirm,
                });
                setValue(empty);
                setDeleteConfirm("");
                await refresh();
                notice(
                  "Đã xóa vĩnh viễn khóa học và trang giới thiệu của khóa.",
                );
              }).finally(() => setBusy(false));
            }}
          >
            Xóa vĩnh viễn khóa học
          </button>
        </section>
      )}
    </section>
  );
}
