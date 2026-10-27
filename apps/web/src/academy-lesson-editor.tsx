import { DeleteLearningData } from "./academy-data-cleanup";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { vnDateTime } from "./date-format";
const states: Record<string, string> = {
  none: "Video tải lên",
  queued: "Chờ sao chép",
  copying: "Đang sao chép",
  ready: "Đã sao chép",
  failed: "Sao chép lỗi",
};
const copyErrors: Record<string, string> = {
  R2_CONFIG_CHANGED:
    "Kho R2 đã đổi; kiểm tra đúng tài khoản và bucket ban đầu.",
  SOURCE_MISSING: "Không còn thông tin bản ghi gốc.",
  STORAGE_MISMATCH: "Bản ghi không khớp kho lưu trữ đã chọn.",
  SOURCE_EXPIRED: "Bản ghi gốc đã hết hạn; cần chọn video còn hạn.",
  SOURCE_UNAVAILABLE: "Chưa đọc được video gốc trên R2.",
  SOURCE_SIZE_OR_TYPE: "Dung lượng hoặc định dạng video gốc không hợp lệ.",
  R2_COPY_FAILED:
    "R2 chưa sao chép được video; kiểm tra quyền truy cập rồi thử lại.",
  COPY_NOT_VERIFIED: "Video sao chép chưa vượt qua kiểm tra; vui lòng thử lại.",
  COPY_FAILED: "Chưa hoàn tất sao chép; kiểm tra R2 rồi thử lại.",
};
export function AcademyLessonEditor({ demo, courses, perform, notice }: any) {
  const [course, setCourse] = useState(""),
    [catalog, setCatalog] = useState<any[]>([]),
    [source, setSource] = useState(""),
    [recordPage, setRecordPage] = useState(0),
    [recordings, setRecordings] = useState<any[]>([]),
    [lessons, setLessons] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [form, setForm] = useState({
      title: "",
      chapter: "",
      notes: "",
      minutes: 60,
      published: true,
    }),
    [edit, setEdit] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [sample, setSample] = useState("");
  const generation = useRef(0);
  const activeCourse = useRef(course),
    refreshSeq = useRef(0),
    previewSeq = useRef(0);
  activeCourse.current = course;
  useEffect(() => {
    let active = true;
    void (
      demo
        ? Promise.resolve([
            {
              id: "demo-subject",
              class_id: "demo-class",
              class_name: "Lớp 10A1",
              name: "Toán",
            },
          ])
        : api("/catalog")
    )
      .then((v) => {
        if (active) setCatalog(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [demo]);
  async function refresh() {
    if (!course || course !== activeCourse.current) return;
    const seq = generation.current,
      request = ++refreshSeq.current;
    const rows = demo ? [] : await api(`/academy/courses/${course}/lessons`);
    if (
      seq === generation.current &&
      request === refreshSeq.current &&
      course === activeCourse.current
    )
      setLessons(rows);
  }
  useEffect(() => {
    generation.current++;
    setLessons([]);
    setEdit(null);
    setError("");
    previewSeq.current++;
    void refresh().catch((e) => setError(e.message));
  }, [course, demo]);
  useEffect(() => {
    if (!lessons.some((l) => ["queued", "copying"].includes(l.import_state)))
      return;
    const timer = setInterval(() => void refresh().catch(() => {}), 3000);
    return () => clearInterval(timer);
  }, [
    course,
    lessons.some((l) => ["queued", "copying"].includes(l.import_state)),
  ]);
  useEffect(() => {
    let active = true;
    setRecordings([]);
    setSelected("");
    setSample("");
    previewSeq.current++;
    const s = catalog.find((v) => v.id === source);
    if (!s) return;
    const url =
      "/recordings?" +
      new URLSearchParams({
        class_id: s.class_id,
        course_id: s.id,
        page: String(recordPage),
      });
    const result = demo
      ? Promise.resolve([
          {
            id: "demo-recording",
            meeting_id: "demo-meeting",
            meeting_title: "Buổi ôn tập",
            starts_at: "2026-10-27T01:00:00Z",
            expires_at: "2026-11-26T01:00:00Z",
            size_bytes: 2000000,
          },
        ])
      : api(url);
    void result
      .then((v) => {
        if (active) setRecordings(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [source, catalog, demo, recordPage]);
  async function choose(id: string) {
    const request = ++previewSeq.current;
    setSelected(id);
    setSample("");
    const row = recordings.find((v) => v.id === id);
    if (!row) return;
    setForm((v) => ({ ...v, title: row.meeting_title }));
    if (!demo)
      try {
        const v = await api(
          `/meetings/${row.meeting_id}/recordings/${id}/download`,
        );
        if (request === previewSeq.current) setSample(v.url);
      } catch (e) {
        if (request === previewSeq.current) setError((e as Error).message);
      }
  }
  const act = (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    void perform(fn).finally(() => setBusy(false));
  };
  async function move(i: number, delta: number) {
    const rows = [...lessons];
    [rows[i], rows[i + delta]] = [rows[i + delta], rows[i]];
    if (!demo)
      await api(`/academy/courses/${course}/lesson-order`, {
        ids: rows.map((v) => v.id),
        expected: lessons.map((v) => v.id),
      });
    setLessons(rows);
    notice("Đã lưu thứ tự bài giảng.");
  }
  const fields = (data: any, change: (v: any) => void) => (
    <>
      <label>
        Tên bài giảng
        <input
          required
          maxLength={200}
          value={data.title}
          onChange={(e) => change({ ...data, title: e.target.value })}
        />
      </label>
      <label>
        Chương / chủ đề
        <input
          maxLength={200}
          value={data.chapter || ""}
          onChange={(e) => change({ ...data, chapter: e.target.value })}
        />
      </label>
      <label>
        Ghi chú cho học sinh
        <textarea
          aria-label="Ghi chú cho học sinh"
          rows={4}
          maxLength={20000}
          value={data.notes || ""}
          onChange={(e) => change({ ...data, notes: e.target.value })}
        />
      </label>
      <label className="academy-check">
        <input
          type="checkbox"
          checked={data.published}
          onChange={(e) => change({ ...data, published: e.target.checked })}
        />
        Công khai khi video sẵn sàng
      </label>
    </>
  );
  return (
    <section className="academy-section academy-lesson-editor">
      <h2>Video lớp học → bài giảng khóa học</h2>
      <p>
        Chọn bản ghi còn hạn để tạo video riêng cho khóa học. Bản gốc hết hạn
        không xóa bản đã sao chép. Tối đa 5 GiB; bài giảng chỉ công khai khi sao
        chép và kiểm tra xong.
      </p>
      <label>
        Khóa học quản lý bài giảng
        <select
          value={course}
          disabled={busy}
          onChange={(e) => setCourse(e.target.value)}
        >
          <option value="">Chọn khóa học</option>
          {courses.map((c: any) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      {course && (
        <>
          <details>
            <summary>Chọn bản ghi buổi học để đăng</summary>
            <label>
              Lớp và môn của bản ghi
              <select
                value={source}
                onChange={(e) => {
                  setSource(e.target.value);
                  setRecordPage(0);
                }}
              >
                <option value="">Chọn lớp / môn</option>
                {catalog.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.class_name} · {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Video buổi học
              <select
                value={selected}
                onChange={(e) => void choose(e.target.value)}
              >
                <option value="">Chọn video còn hạn</option>
                {recordings.slice(0, 50).map((r) => (
                  <option key={r.id} value={r.id}>
                    {vnDateTime(r.starts_at)} · {r.meeting_title} ·{" "}
                    {Math.round(Number(r.size_bytes) / 1048576)} MB
                  </option>
                ))}
              </select>
            </label>
            {source && !recordings.length && (
              <p>
                Chưa có video sẵn sàng trong 50 bản ghi gần nhất. Bản ghi phải
                tải lên hoàn tất và còn hạn lưu.
              </p>
            )}
            {source && (
              <div className="academy-actions">
                <button
                  type="button"
                  disabled={!recordPage || busy}
                  onClick={() => setRecordPage((v) => v - 1)}
                >
                  Video trước
                </button>
                <span>Trang {recordPage + 1}</span>
                <button
                  type="button"
                  disabled={
                    recordings.length <= 50 || busy || recordPage >= 10000
                  }
                  onClick={() => setRecordPage((v) => v + 1)}
                >
                  Video tiếp
                </button>
              </div>
            )}
            {sample && (
              <video
                controls
                preload="metadata"
                src={sample}
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget.duration;
                  if (Number.isFinite(d) && d > 0)
                    setForm((v) => ({
                      ...v,
                      minutes: Math.round((d / 60) * 100) / 100,
                    }));
                }}
              />
            )}
            {selected && (
              <form
                className="academy-lesson-import-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  act(async () => {
                    if (demo) {
                      notice("Demo không sao chép video thật.");
                      return;
                    }
                    const out = await api(
                      `/academy/courses/${course}/recordings`,
                      {
                        recording_id: selected,
                        title: form.title,
                        chapter: form.chapter,
                        notes: form.notes,
                        duration_seconds: Math.round(form.minutes * 60),
                        published: form.published,
                      },
                    );
                    await refresh();
                    notice(
                      out.state === "ready"
                        ? "Video này đã có trong khóa học."
                        : out.state === "failed"
                          ? "Yêu cầu này đang lỗi. Dùng nút Thử sao chép lại trong bảng."
                          : "Đã nhận yêu cầu. Đóng trang vẫn tiếp tục sao chép.",
                    );
                  });
                }}
              >
                {fields(form, setForm)}
                <label>
                  Thời lượng (phút)
                  <input
                    type="number"
                    required
                    min="0.02"
                    max="480"
                    step="0.01"
                    value={form.minutes}
                    onChange={(e) =>
                      setForm({ ...form, minutes: Number(e.target.value) })
                    }
                  />
                </label>
                <small>
                  Điền tự động khi đọc được thời lượng; kiểm tra lại trước khi
                  đăng.
                </small>
                <button disabled={busy}>Đăng video vào khóa học</button>
              </form>
            )}
          </details>
          <div className="academy-actions">
            <h3>Thứ tự bài giảng</h3>
            <button type="button" onClick={() => act(refresh)}>
              Tải lại bài giảng
            </button>
          </div>
          <p>
            Sắp theo chương/chủ đề rồi thứ tự bài. Nút lên/xuống lưu ngay. Ghi
            chú hiển thị cho học sinh có quyền xem khóa học.
          </p>
          <div className="academy-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>STT</th>
                  <th>Bài giảng / chủ đề</th>
                  <th>Nguồn & trạng thái</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {lessons.map((l, i) => (
                  <tr key={l.id}>
                    <td>{i + 1}</td>
                    <td>
                      <strong>{l.title}</strong>
                      <p>{l.chapter || "Chưa phân chủ đề"}</p>
                      {l.notes && (
                        <details>
                          <summary>Xem ghi chú</summary>
                          <p className="academy-lesson-notes">{l.notes}</p>
                        </details>
                      )}
                    </td>
                    <td>
                      {l.source_recording_id
                        ? "Bản ghi lớp học"
                        : "Video tải lên"}
                      <br />
                      {states[l.import_state] || "Video tải lên"} ·{" "}
                      {l.status === "ready" ? "Công khai" : "Nháp"}
                      {l.import_state === "failed" && (
                        <p role="alert">
                          {copyErrors[l.error_code] ||
                            "Chưa hoàn tất sao chép; kiểm tra R2 rồi thử lại."}
                        </p>
                      )}
                    </td>
                    <td>
                      <div className="academy-actions">
                        <button
                          type="button"
                          disabled={busy || !i}
                          aria-label={"Đưa lên " + l.title}
                          onClick={() => act(() => move(i, -1))}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={busy || i === lessons.length - 1}
                          aria-label={"Đưa xuống " + l.title}
                          onClick={() => act(() => move(i, 1))}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setEdit({
                              ...l,
                              minutes: l.duration_seconds / 60,
                              published: l.status === "ready",
                            })
                          }
                        >
                          Sửa bài giảng
                        </button>
                        <DeleteLearningData kind="videos" label="Xóa bài giảng" scope={{lesson_id:l.id}} demo={demo} onDeleted={async()=>{setEdit(null);await refresh()}}/>
                        {l.import_state === "failed" && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              act(async () => {
                                if (!demo)
                                  await api(
                                    `/academy/lessons/${l.id}/retry-import`,
                                    {},
                                  );
                                await refresh();
                              })
                            }
                          >
                            Thử sao chép lại
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!lessons.length && (
            <p>
              Khóa học chưa có bài giảng. Chọn video của lớp ở trên hoặc tải
              file mới.
            </p>
          )}
          {edit && (
            <form
              className="academy-lesson-edit-form"
              onSubmit={(e) => {
                e.preventDefault();
                act(async () => {
                  if (!demo)
                    await api(`/academy/lessons/${edit.id}/edit`, {
                      title: edit.title,
                      chapter: edit.chapter,
                      notes: edit.notes,
                      published: edit.published,
                      revision: edit.revision,
                      duration_seconds: Math.round(edit.minutes * 60),
                    });
                  setEdit(null);
                  await refresh();
                  notice("Đã cập nhật bài giảng.");
                });
              }}
            >
              <h3>Sửa thông tin bài giảng</h3>
              {fields(edit, setEdit)}
              <label>
                Thời lượng (phút)
                <input
                  type="number"
                  required
                  min="0.02"
                  max="480"
                  step="0.01"
                  value={edit.minutes}
                  onChange={(e) =>
                    setEdit({ ...edit, minutes: Number(e.target.value) })
                  }
                />
              </label>
              <button disabled={busy}>Lưu bài giảng</button>
              <button
                type="button"
                className="secondary"
                onClick={() => setEdit(null)}
              >
                Hủy sửa
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
