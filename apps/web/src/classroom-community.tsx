import { useEffect, useState } from "react";
import { api } from "./api";
export function ClassroomCommunity({
  course,
  role,
  demo = false,
  people = false,
}: any) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const sample = {
    announcements: [],
    teachers: [
      { id: "demo-teacher", name: course.teacher || "Chưa phân công" },
    ],
    students: [],
    student_count: 0,
    can_manage: role !== "student",
  };
  async function reload() {
    const v = demo ? sample : await api(`/courses/${course.id}/classroom`);
    setData(v);
  }
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    void (
      demo ? Promise.resolve(sample) : api(`/courses/${course.id}/classroom`)
    )
      .then((v) => {
        if (active) setData(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [course.id, demo]);
  return (
    <section
      className="classroom-community"
      aria-label={people ? "Thành viên môn học" : "Thông báo môn học"}
    >
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Đang tải thông tin lớp…</p>}
      {data &&
        (people ? (
          <>
            <h3>Giáo viên</h3>
            {data.teachers.map((t: any) => (
              <div className="classroom-person" key={t.id}>
                <span aria-hidden="true">{t.name.slice(0, 1)}</span>
                <strong>{t.name}</strong>
              </div>
            ))}
            {!data.teachers.length && (
              <p>Chưa có giáo viên đang hoạt động được phân công.</p>
            )}
            <h3>
              Học sinh {demo ? "· bản minh họa" : `(${data.student_count})`}
            </h3>
            {data.can_manage ? (
              data.students.map((s: any) => (
                <div className="classroom-person" key={s.id}>
                  <span aria-hidden="true">{s.name.slice(0, 1)}</span>
                  <strong>{s.name}</strong>
                  <small>{s.short_id}</small>
                </div>
              ))
            ) : (
              <p>Danh sách chi tiết học sinh do giáo viên phụ trách quản lý.</p>
            )}
            {data.can_manage && !data.students.length && (
              <p>
                {demo
                  ? "Danh sách học sinh hiển thị khi sử dụng lớp thật."
                  : "Chưa có học sinh đang hoạt động trong lớp."}
              </p>
            )}
          </>
        ) : (
          <>
            <h3>Thông báo của giáo viên</h3>
            {data.can_manage && (
              <details>
                <summary>Đăng thông báo cho môn học</summary>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (busy) return;
                    const f = e.currentTarget,
                      v = Object.fromEntries(new FormData(f));
                    setBusy(true);
                    setError("");
                    void (async () => {
                      if (demo)
                        setData({
                          ...data,
                          announcements: [
                            {
                              id: crypto.randomUUID(),
                              title: v.title,
                              body: v.body,
                              author: "Giáo viên minh họa",
                              created_at: new Date().toISOString(),
                            },
                            ...data.announcements,
                          ],
                        });
                      else {
                        await api(`/courses/${course.id}/classroom`, v);
                        await reload();
                      }
                      f.reset();
                    })()
                      .catch((e) => setError(e.message))
                      .finally(() => setBusy(false));
                  }}
                >
                  <label>
                    Tiêu đề thông báo
                    <input name="title" required maxLength={200} />
                  </label>
                  <label>
                    Nội dung thông báo
                    <textarea name="body" required maxLength={10000} rows={4} />
                  </label>
                  {demo && (
                    <small>
                      Bản minh họa: không lưu hoặc gửi cho học sinh thật.
                    </small>
                  )}
                  <button disabled={busy}>
                    {busy ? "Đang đăng…" : "Đăng thông báo"}
                  </button>
                </form>
              </details>
            )}
            {data.announcements.map((a: any) => (
              <article className="classroom-announcement" key={a.id}>
                <small>
                  {a.author} · {new Date(a.created_at).toLocaleString("vi-VN")}
                </small>
                <h4>{a.title}</h4>
                <p>{a.body}</p>
              </article>
            ))}
            {!data.announcements.length && (
              <p>Chưa có thông báo của giáo viên.</p>
            )}
          </>
        ))}
    </section>
  );
}
