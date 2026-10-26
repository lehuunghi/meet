import { useEffect, useState } from "react";
import { api } from "./api";
export function AcademySiteEditor({ demo, courses, perform, notice }: any) {
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
  async function load() {
    setLoaded(false);
    setError("");
    try {
      const rows = await api<any[]>("/academy/site");
      const parsed = rows[0] ? JSON.parse(rows[0].content) : null;
      if (parsed) {
        parsed.posts = (parsed.posts || []).map((p: any) => ({
          Slug: p.Slug ?? p.slug ?? "",
          Title: p.Title ?? p.title ?? "",
          Summary: p.Summary ?? p.summary ?? "",
          Body: p.Body ?? p.body ?? "",
          Published: p.Published ?? p.published ?? false,
        }));
      }
      setValue(parsed || { headline: "", description: "", published: false });
      setRevision(rows[0]?.revision || "");
      setLoaded(true);
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
          rows={5}
          maxLength={20000}
          value={value[key] || ""}
          onChange={(e) => setValue({ ...value, [key]: e.target.value })}
        />
      ) : (
        <input
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
        để trống sẽ được ẩn.
      </p>
      {error && (
        <p className="error" role="alert">
          {error} <button onClick={() => void load()}>Tải lại nội dung</button>
        </p>
      )}
      <button type="button" className="secondary" disabled={demo||saving} onClick={()=>void load()}>Tải lại nội dung website đã lưu</button>
      <form
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
            }
            notice(
              demo
                ? "Website minh họa, chưa lưu máy chủ."
                : "Đã lưu website và nội dung khóa học.",
            );
          }).finally(() => setSaving(false));
        }}
      >
        <fieldset disabled={!loaded || saving}>
          <legend>Thương hiệu & giới thiệu</legend>
          {field("headline", "Tên nền tảng")}
          {field("description", "Thông điệp giới thiệu", true)}
          {field("about", "Giới thiệu đơn vị", true)}
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
        <details>
          <summary>Liên hệ & chính sách</summary>
          <fieldset disabled={!loaded || saving}>
            <legend>Thông tin hỗ trợ</legend>
            {field("contact_email", "Email liên hệ")}
            {field("contact_phone", "Số điện thoại hỗ trợ")}
            {field("address", "Địa chỉ", true)}
            {field("terms", "Điều khoản sử dụng", true)}
            {field("privacy", "Chính sách bảo mật", true)}
            {field("refund", "Thanh toán & hoàn phí", true)}
          </fieldset>
        </details>
        <details>
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
                  onChange={(e) => changePage("preview_lesson", e.target.value)}
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
                Bài học thử vẫn áp dụng hạn mức của tài khoản; không công khai
                đường dẫn lưu trữ video.
              </small>
              <a href={"/khoa-hoc/" + selected} target="_blank" rel="noopener">
                Xem trang công khai ↗
              </a>
            </fieldset>
          )}
        </details>
        <details>
          <summary>Hồ sơ giáo viên</summary>
          <fieldset disabled={!loaded || saving}>
            <legend>Giáo viên giới thiệu công khai</legend>
            {(value.teachers || []).map((t: any, i: number) => (
              <div className="academy-editor-row" key={i}>
                {[
                  ["Name", "Họ tên"],
                  ["Subject", "Môn phụ trách"],
                  ["Bio", "Kinh nghiệm & giới thiệu"],
                ].map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <textarea
                      maxLength={5000}
                      value={t[key] ?? t[key.toLowerCase()] ?? ""}
                      onChange={(e) => {
                        const next = {
                          Name: t.Name ?? t.name ?? "",
                          Subject: t.Subject ?? t.subject ?? "",
                          Bio: t.Bio ?? t.bio ?? "",
                          [key]: e.target.value,
                        };
                        setValue({
                          ...value,
                          teachers: value.teachers.map((v: any, n: number) =>
                            n === i ? next : v,
                          ),
                        });
                      }}
                    />
                  </label>
                ))}
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
                    { Name: "", Subject: "", Bio: "" },
                  ],
                })
              }
            >
              Thêm hồ sơ giáo viên
            </button>
          </fieldset>
        </details>
        <details>
          <summary>Bài viết & lịch khai giảng</summary>
          <fieldset disabled={!loaded || saving}>
            <legend>Bài viết</legend>
            {(value.posts || []).map((p: any, i: number) => (
              <div className="academy-editor-row" key={i}>
                {[
                  ["Slug", "Đường dẫn ngắn (chữ thường, số, dấu gạch ngang)"],
                  ["Title", "Tiêu đề"],
                  ["Summary", "Tóm tắt"],
                  ["Body", "Nội dung"],
                ].map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <textarea
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
                  className="secondary"
                  onClick={() =>
                    setValue({
                      ...value,
                      posts: value.posts.filter((_: any, n: number) => n !== i),
                    })
                  }
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
        <button disabled={!loaded || saving}>
          {saving ? "Đang lưu…" : "Lưu website"}
        </button>
      </form>
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
    [busy, setBusy] = useState(false);
  return (
    <section className="academy-section">
      <h2>Tạo & sửa khóa học</h2>
      <label>
        Khóa học cần chỉnh sửa
        <select
          value={value.id}
          onChange={(e) => {
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
          ["academic_course_id", "ID môn học Live (nếu có)"],
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
    </section>
  );
}
