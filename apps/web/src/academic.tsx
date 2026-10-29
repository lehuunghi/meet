import { AcademicOperations } from "./academic-operations";
import { ClassManager } from "./class-manager";
import { useEffect, useState, useRef } from "react";
import { api } from "./api";
import { previewClasses, previewCourses, previewUsers } from "./preview";
import {
  parseAccountText,
  parseSubjectText,
  type AccountDraft,
} from "./academic-data";
import "./academic.css";
type Row = Record<string, any>;
const newAccount = (): AccountDraft => ({
  id: "",
  email: "",
  student_code: "",
  name: "",
  password: "",
  revision: 0,
  key: crypto.randomUUID(),
});
export function AcademicAdmin({
  demo,
  onChange,
  canManageAccounts = true,
}: {
  demo: boolean;
  onChange: () => Promise<void>;
  canManageAccounts?: boolean;
}) {
  const [tab, setTab] = useState("courses"),
    [classes, setClasses] = useState<Row[]>([]),
    [courses, setCourses] = useState<Row[]>([]),
    [teachers, setTeachers] = useState<AccountDraft[]>([]),
    [students, setStudents] = useState<AccountDraft[]>([]),
    [selected, setSelected] = useState(""),
    [search, setSearch] = useState(""),
    [paste, setPaste] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const classId =
    classes.find((c) => c.id === selected)?.id || classes[0]?.id || "";
  const cl = classes.find((c) => c.id === classId);
  const studentRequest = useRef(0);
  const dirty =
    [...students, ...teachers].some(
      (v) =>
        v.dirty ||
        (!v.id && (v.email || v.name || v.student_code || v.password)),
    ) || courses.some((v) => v.dirty || v.assignmentDirty);
  async function load() {
    if (demo) {
      setClasses((prev) =>
        prev.length
          ? prev
          : previewClasses.map((v, i) => ({
              ...v,
              short_id: `LH000${i + 1}`,
            })),
      );
      setCourses((prev) =>
        prev.length
          ? prev
          : previewCourses.map((v, i) => ({
              ...v,
              short_id: `MH000${i + 1}`,
              revision: 1,
              teacher_id: i < 2 ? "teacher-minh" : i === 2 ? "teacher-lan" : "",
              dirty: false,
            })),
      );
      setTeachers((prev) =>
        prev.length
          ? prev
          : previewUsers
              .filter((v) => v.role === "teacher")
              .map((v, i) => ({
                ...v,
                short_id: `GV000${i + 1}`,
                student_code: "",
                password: "",
                revision: 1,
              })),
      );
      return;
    }
    const [c, u, k] = await Promise.all([
      api<Row[]>("/classes?include_deleted=1"),
      api<Row[]>("/users"),
      api<Row[]>("/catalog"),
    ]);
    setClasses(c);
    setCourses(
      k.map((v) => ({
        ...v,
        assistant_ids:
          typeof v.assistant_ids === "string"
            ? JSON.parse(v.assistant_ids)
            : v.assistant_ids || [],
        dirty: false,
      })),
    );
    setTeachers(
      u
        .filter((v) => v.role === "teacher")
        .map(
          (v) =>
            ({
              ...v,
              password: "",
              student_code: "",
              dirty: false,
            }) as AccountDraft,
        ),
    );
  }
  async function loadStudents(id: string) {
    const seq = ++studentRequest.current;
    if (!id) {
      setStudents([]);
      return;
    }
    if (demo) {
      setStudents(
        previewUsers
          .filter((v) => v.role === "student")
          .slice(0, id === "class-10a1" ? 3 : 1)
          .map((v, i) => ({
            ...v,
            short_id: `SV000${i + 1}`,
            student_code: `SV20260${i + 1}`,
            password: "",
            revision: 1,
            dirty: false,
          })),
      );
      return;
    }
    const incoming = await api<AccountDraft[]>(`/classes/${id}/students`);
    if (seq !== studentRequest.current) return;
    setStudents(
      incoming.map((v) => ({
        ...v,
        password: "",
        dirty: false,
      })),
    );
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void run(load);
  }, []);
  useEffect(() => {
    void run(() => loadStudents(classId));
  }, [classId]);
  function updateAccount(i: number, field: string, value: string) {
    const setter = tab === "students" ? setStudents : setTeachers;
    setter((v) =>
      v.map((r, n) => (n === i ? { ...r, [field]: value, dirty: true } : r)),
    );
  }
  async function saveAccounts() {
    const role = tab === "students" ? "student" : "teacher",
      rows = (role === "student" ? students : teachers).filter(
        (v) =>
          v.dirty ||
          (!v.id && (v.email || v.name || v.student_code || v.password)),
      );
    if (!rows.length) {
      setNotice("Không có dòng thay đổi");
      return;
    }
    if (demo) {
      const setter = role === "student" ? setStudents : setTeachers;
      setter((v) =>
        v.map((r, i) => ({
          ...r,
          id: r.id || `demo-${i}`,
          short_id:
            r.short_id ||
            `${role === "student" ? "SV" : "GV"}${String(i + 1).padStart(4, "0")}`,
          password: "",
          dirty: false,
          revision: Math.max(1, r.revision + 1),
        })),
      );
      setNotice("Đã cập nhật bản mẫu trong phiên này, không lưu máy chủ");
      return;
    }
    await api(
      role === "student"
        ? `/classes/${classId}/students/batch`
        : "/teachers/batch",
      {
        rows: rows.map((v) => ({
          id: v.short_id || v.id,
          email: v.email,
          student_code: role === "student" ? v.student_code : "",
          name: v.name,
          password: v.password,
          revision: v.revision,
        })),
      },
    );
    await load();
    if (role === "student") await loadStudents(classId);
    await onChange();
    setNotice(`Đã lưu ${rows.length} dòng. Mật khẩu đã được xóa khỏi bảng.`);
  }
  async function teacherAction(v: AccountDraft, remove: boolean) {
    if (dirty) {
      setError(
        "Lưu hoặc bỏ các dòng đang sửa trước khi ngưng hoặc xóa giáo viên.",
      );
      return;
    }
    const confirm = remove
      ? window.prompt(
          "Xóa giáo viên sẽ thu hồi đăng nhập và gỡ phân công, giữ lịch sử. Nhập đúng email: " +
            v.email,
        )
      : "";
    if (remove && confirm !== v.email) return;
    await run(async () => {
      const state =
        v.state === "suspended" || v.active === false ? "active" : "suspended";
      if (demo) {
        setTeachers(
          teachers.flatMap((t) =>
            t.id !== v.id
              ? [t]
              : remove
                ? []
                : [{ ...t, state, active: state === "active" }],
          ),
        );
        return;
      }
      if (remove)
        await api(`/accounts/${v.id}/delete`, {
          confirm,
          revision: v.revision,
        });
      else
        await api("/accounts", {
          id: v.id,
          state,
          permissions: [],
          revision: v.revision,
        });
      await load();
      await onChange();
      setNotice(
        remove
          ? "Đã xóa giáo viên và gỡ phân công."
          : "Đã cập nhật trạng thái giáo viên.",
      );
    });
  }
  const visibleCourses = courses.filter((v) => v.class_id === classId),
    accountRows = tab === "students" ? students : teachers;
  const match = (v: Row) =>
    Object.values(v).some(
      (x) =>
        typeof x === "string" && x.toLowerCase().includes(search.toLowerCase()),
    );
  return (
    <div className="academic-admin">
      <div className="academic-tabs" role="tablist" aria-label="Quản lý học vụ">
        {[
          ["classes", "Lớp học"],
          ["operations", "Năm học & lịch dạy"],
          ["courses", "Môn học"],
          ["students", "Học sinh theo lớp"],
          ["teachers", "Giáo viên"],
          ["assignments", "Phân công giảng dạy"],
        ].map(([id, name]) => (
          <button
            role="tab"
            aria-selected={tab === id}
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => {
              if (dirty) {
                setError(
                  "Lưu hoặc bỏ các dòng đang sửa trước khi chuyển bảng.",
                );
                return;
              }
              setTab(id);
              setSearch("");
              setPaste("");
            }}
          >
            {name}
          </button>
        ))}
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="banner" role="status">
          {notice}
        </div>
      )}
      {tab === "operations" && (
        <AcademicOperations
          demo={demo}
          classes={classes}
          courses={courses}
          onChange={async () => {
            await load();
            await onChange();
          }}
        />
      )}
      <section className="section">
        <div className="academic-filters">
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (demo) {
                  setCourses([]);
                  setTeachers([]);
                }
                await load();
                await loadStudents(classId);
                setNotice("Đã tải lại và bỏ thay đổi chưa lưu");
              })
            }
          >
            Tải lại / bỏ thay đổi
          </button>
          {!["teachers", "classes", "operations"].includes(tab) && (
            <label>
              Lớp học
              <select
                aria-label="Lớp quản lý"
                value={classId}
                disabled={busy}
                onChange={(e) => {
                  if (dirty) {
                    setError("Lưu hoặc bỏ thay đổi trước khi đổi lớp.");
                    return;
                  }
                  setSelected(e.target.value);
                }}
              >
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.short_id} · {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Tìm theo ID, mã SV, tên hoặc email
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="SV0123 / MH0045 / tên…"
            />
          </label>
          {tab === "courses" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(async () => {
                  if (demo) {
                    const name = String(f.get("name"));
                    setClasses((v) => [
                      ...v,
                      {
                        id: crypto.randomUUID(),
                        name,
                        short_id: `LH${String(v.length + 1).padStart(4, "0")}`,
                      },
                    ]);
                    setNotice("Đã thêm lớp trong bản mẫu");
                    return;
                  }
                  await api("/classes", { name: f.get("name") });
                  await load();
                });
              }}
            >
              <label>
                Tạo lớp mới
                <input name="name" required placeholder="10A3" />
              </label>
              <button disabled={busy}>Thêm lớp</button>
            </form>
          )}
        </div>
      </section>
      {tab === "classes" && (
        <ClassManager
          demo={demo}
          rows={classes}
          onDemo={setClasses}
          onUpdated={async () => {
            await load();
            await onChange();
          }}
          onInspect={(id: string) => {
            setSelected(id);
            setTab("courses");
          }}
        />
      )}
      {cl?.state === "deleted" && !["classes", "teachers"].includes(tab) && (
        <p>
          Lớp đã xóa — chỉ xem lịch sử. Video trong khóa học vẫn giữ nguyên.
        </p>
      )}
      <fieldset
        className="academic-panels"
        disabled={
          cl?.state === "deleted" && !["classes", "teachers"].includes(tab)
        }
      >
        {tab === "courses" && (
          <section className="section">
            <div className="section-title">
              <div>
                <h2>Môn học · {cl?.name || "Chọn lớp"}</h2>
                <p>
                  Mỗi dòng một môn. Có thể tạo trước, gán giáo viên ở bảng phân
                  công sau. ID ngắn giữ nguyên khi sửa.
                </p>
              </div>
              <button
                className="secondary"
                disabled={!classId || busy}
                onClick={() =>
                  setCourses((v) => [
                    ...v,
                    {
                      id: "",
                      key: crypto.randomUUID(),
                      class_id: classId,
                      name: "",
                      revision: 0,
                      teacher_id: "",
                      dirty: true,
                    },
                  ])
                }
              >
                + Thêm dòng môn
              </button>
            </div>
            <details className="academic-paste">
              <summary>Dán nhiều dòng từ Excel hoặc CSV</summary>
              <p>
                Một cột tên môn, tối đa 100 dòng. Tiêu đề tùy chọn: name hoặc
                Tên môn.
              </p>
              <textarea
                aria-label="Danh sách môn nhập trực tiếp"
                rows={5}
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
              />
              <button
                className="secondary"
                disabled={busy || !classId}
                onClick={() =>
                  void run(async () => {
                    const names = parseSubjectText(paste);
                    setCourses((v) => [
                      ...v,
                      ...names.map((name) => ({
                        id: "",
                        key: crypto.randomUUID(),
                        class_id: classId,
                        name,
                        revision: 0,
                        teacher_id: "",
                        dirty: true,
                      })),
                    ]);
                    setPaste("");
                    setNotice("Đã thêm môn vào bảng để kiểm tra trước khi lưu");
                  })
                }
              >
                Đưa môn vào bảng
              </button>
            </details>
            <table className="academic-table">
              <thead>
                <tr>
                  <th>ID môn</th>
                  <th>Tên môn</th>
                  <th>Giáo viên hiện tại</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {courses.map(
                  (v, i) =>
                    v.class_id === classId &&
                    match(v) && (
                      <tr key={v.id || v.key}>
                        <td data-label="ID môn">
                          {v.short_id || "Cấp khi lưu"}
                        </td>
                        <td data-label="Tên môn">
                          <input
                            aria-label={`Tên môn ${v.short_id || i}`}
                            value={v.name}
                            onChange={(e) =>
                              setCourses((r) =>
                                r.map((c, n) =>
                                  n === i
                                    ? {
                                        ...c,
                                        name: e.target.value,
                                        dirty: true,
                                      }
                                    : c,
                                ),
                              )
                            }
                          />
                        </td>
                        <td data-label="Giáo viên">
                          {teachers.find(
                            (t) =>
                              t.id === v.teacher_id ||
                              t.short_id === v.teacher_id,
                          )?.name || "Chưa phân công"}
                        </td>
                        <td data-label="Thao tác">
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                if (v.id && !demo) {
                                  await api(
                                    "/classes/" +
                                      classId +
                                      "/courses/" +
                                      v.id +
                                      "/delete",
                                    { revision: v.revision },
                                  );
                                  await onChange();
                                }
                                setCourses((rows) =>
                                  rows.filter((_, n) => n !== i),
                                );
                                setNotice("Đã xóa dòng môn");
                              })
                            }
                          >
                            Xóa dòng môn
                          </button>
                        </td>
                      </tr>
                    ),
                )}
              </tbody>
            </table>
            <button
              disabled={busy || !classId}
              onClick={() =>
                void run(async () => {
                  const dirty = visibleCourses.filter((v) => v.dirty);
                  if (!dirty.length) {
                    setNotice("Không có dòng thay đổi");
                    return;
                  }
                  if (demo) {
                    setCourses((v) =>
                      v.map((c, i) => ({
                        ...c,
                        id: c.id || `demo-course-${i}`,
                        short_id:
                          c.short_id || `MH${String(i + 1).padStart(4, "0")}`,
                        revision: Math.max(1, c.revision + 1),
                        dirty: false,
                      })),
                    );
                    setNotice("Đã lưu môn vào bản mẫu, chưa lưu máy chủ");
                    return;
                  }
                  await api(`/classes/${classId}/courses/batch`, {
                    rows: dirty.map((v) => ({
                      id: v.short_id || v.id,
                      name: v.name,
                      revision: v.revision,
                    })),
                  });
                  await load();
                  await onChange();
                  setNotice("Đã lưu môn học");
                })
              }
            >
              Lưu các môn thay đổi
            </button>
          </section>
        )}
        {(tab === "students" || tab === "teachers") && (
          <section className="section">
            <div className="section-title">
              <div>
                <h2>
                  {tab === "students"
                    ? `Danh sách học sinh · ${cl?.name || "Chọn lớp"}`
                    : "Danh sách giáo viên"}
                </h2>
                <p>
                  {tab === "students"
                    ? "Email, mã SV, họ tên, mật khẩu. Mã SV đăng nhập được như email."
                    : "Nhập giáo viên riêng; phân công lớp/môn ở tab kế bên."}{" "}
                  Password trống trên dòng đã lưu = giữ nguyên.
                </p>
              </div>
              <button
                className="secondary"
                disabled={busy || (tab === "students" && !classId)}
                onClick={() => {
                  const set = tab === "students" ? setStudents : setTeachers;
                  set((v) => [...v, newAccount()]);
                }}
              >
                + Thêm dòng
              </button>
            </div>
            <details className="academic-paste">
              <summary>Dán nhiều dòng từ Excel hoặc CSV</summary>
              <p>
                {tab === "students"
                  ? "email,student_code,name,password"
                  : "email,name,password"}{" "}
                — phân cách bằng dấu phẩy hoặc tab, tối đa 100 dòng.
              </p>
              <textarea
                aria-label="Danh sách nhập trực tiếp"
                rows={5}
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                placeholder={
                  tab === "students"
                    ? "an@example.edu,SV2026001,Nguyễn An,mật_khẩu_riêng"
                    : "minh@example.edu,Nguyễn Minh,mật_khẩu_riêng"
                }
              />
              <button
                className="secondary"
                onClick={() =>
                  void run(async () => {
                    const added = parseAccountText(
                      paste,
                      tab === "students" ? "student" : "teacher",
                    );
                    const set = tab === "students" ? setStudents : setTeachers;
                    set((v) => [...v, ...added]);
                    setPaste("");
                    setNotice(
                      `Đã đưa ${added.length} dòng vào bảng; kiểm tra rồi bấm Lưu`,
                    );
                  })
                }
              >
                Đưa vào bảng để kiểm tra
              </button>
            </details>
            {tab === "teachers" && (
              <label className="academic-upload">
                Import XLSX giáo viên riêng — một sheet, header
                email,name,password
                <input
                  type="file"
                  accept=".xlsx"
                  disabled={busy || demo}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file)
                      void run(async () => {
                        const f = new FormData();
                        f.set("file", file);
                        await api("/teachers/import", f);
                        await load();
                        setNotice("Đã import giáo viên");
                      });
                  }}
                />
              </label>
            )}
            <table className="academic-table">
              <thead>
                <tr>
                  <th>ID riêng</th>
                  <th>Email</th>
                  {tab === "students" && <th>Mã SV</th>}
                  <th>Họ tên</th>
                  <th>Mật khẩu mới</th>
                  {tab === "teachers" && <th>Trạng thái / thao tác</th>}
                </tr>
              </thead>
              <tbody>
                {accountRows.map(
                  (v, i) =>
                    match(v) && (
                      <tr key={v.id || v.key}>
                        <td data-label="ID riêng">
                          {v.short_id || "Cấp khi lưu"}
                        </td>
                        <td data-label="Email">
                          <input
                            aria-label={`Email dòng ${i + 1}`}
                            value={v.email}
                            onChange={(e) =>
                              updateAccount(i, "email", e.target.value)
                            }
                          />
                        </td>
                        {tab === "students" && (
                          <td data-label="Mã SV">
                            <input
                              aria-label={`Mã SV dòng ${i + 1}`}
                              value={v.student_code || ""}
                              onChange={(e) =>
                                updateAccount(i, "student_code", e.target.value)
                              }
                            />
                          </td>
                        )}
                        <td data-label="Họ tên">
                          <input
                            aria-label={`Họ tên dòng ${i + 1}`}
                            value={v.name}
                            onChange={(e) =>
                              updateAccount(i, "name", e.target.value)
                            }
                          />
                        </td>
                        <td data-label="Mật khẩu mới">
                          <input
                            type="password"
                            autoComplete="new-password"
                            aria-label={`Mật khẩu dòng ${i + 1}`}
                            value={v.password}
                            onChange={(e) =>
                              updateAccount(i, "password", e.target.value)
                            }
                            placeholder={
                              v.id ? "Giữ nguyên" : "6 ký tự, tối đa 72 byte"
                            }
                          />
                        </td>
                        {tab === "teachers" && (
                          <td data-label="Trạng thái / thao tác">
                            <small>
                              {v.state === "suspended" || v.active === false
                                ? "Đang ngưng dạy"
                                : "Đang hoạt động"}
                            </small>
                            <div className="academy-actions">
                              {v.id && (
                                <button
                                  disabled={busy || !canManageAccounts}
                                  onClick={() => void teacherAction(v, false)}
                                >
                                  {v.state === "suspended" || v.active === false
                                    ? "Kích hoạt giáo viên"
                                    : "Ngưng giáo viên"}
                                </button>
                              )}
                              <button
                                disabled={
                                  busy || (!!v.id && !canManageAccounts)
                                }
                                onClick={() => {
                                  if (!v.id) {
                                    setTeachers(
                                      teachers.filter((_, n) => n !== i),
                                    );
                                    return;
                                  }
                                  void teacherAction(v, true);
                                }}
                              >
                                {v.id ? "Xóa giáo viên" : "Xóa dòng"}
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ),
                )}
              </tbody>
            </table>
            <button
              disabled={busy || (tab === "students" && !classId)}
              onClick={() => void run(saveAccounts)}
            >
              Lưu các dòng thay đổi
            </button>
            {tab === "students" && (
              <details className="academic-paste">
                <summary>Gán học sinh đã có bằng ID ngắn</summary>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run(async () => {
                      if (demo) {
                        setNotice("Bản mẫu không gán dữ liệu máy chủ");
                        return;
                      }
                      await api("/enrollments", {
                        class_id: cl?.short_id || classId,
                        user_id: f.get("student"),
                      });
                      await loadStudents(classId);
                      setNotice("Đã thêm học sinh có sẵn vào lớp");
                    });
                  }}
                >
                  <label>
                    ID học sinh
                    <input name="student" required placeholder="SV0123" />
                  </label>
                  <button disabled={busy}>Gán vào lớp</button>
                </form>
              </details>
            )}
          </section>
        )}
        {tab === "assignments" && (
          <section className="section">
            <h2>Bảng phân công lớp – môn – giáo viên</h2>
            <p>
              Mỗi môn một giáo viên chính và tối đa 10 trợ giảng. Trợ giảng được
              vào lớp và xem điểm danh; giáo viên chính bắt đầu/kết thúc buổi.
              Không đổi khi môn có buổi live.
            </p>
            <table className="academic-table">
              <thead>
                <tr>
                  <th>Lớp</th>
                  <th>ID môn</th>
                  <th>Môn học</th>
                  <th>Giáo viên</th>
                </tr>
              </thead>
              <tbody>
                {courses.map(
                  (v, i) =>
                    v.class_id === classId &&
                    v.id &&
                    match(v) && (
                      <tr key={v.id}>
                        <td data-label="Lớp">
                          {cl?.short_id} · {cl?.name}
                        </td>
                        <td data-label="ID môn">{v.short_id}</td>
                        <td data-label="Môn">{v.name}</td>
                        <td data-label="Giáo viên">
                          <select
                            aria-label={`Giáo viên môn ${v.short_id}`}
                            value={v.teacher_id || ""}
                            onChange={(e) =>
                              setCourses((rows) =>
                                rows.map((c, n) =>
                                  n === i
                                    ? {
                                        ...c,
                                        teacher_id: e.target.value,
                                        assignmentDirty: true,
                                      }
                                    : c,
                                ),
                              )
                            }
                          >
                            <option value="">Chưa phân công</option>
                            {teachers
                              .filter((t) => t.id)
                              .map((t) => (
                                <option value={t.id} key={t.id}>
                                  {t.short_id} · {t.name}
                                </option>
                              ))}
                          </select>
                          {(v.assistant_ids || []).map(
                            (id: string, j: number) => (
                              <div key={j} className="assistant-row">
                                <select
                                  aria-label={
                                    "Trợ giảng " +
                                    (j + 1) +
                                    " môn " +
                                    v.short_id
                                  }
                                  value={id}
                                  onChange={(e) =>
                                    setCourses((rows) =>
                                      rows.map((c, n) =>
                                        n === i
                                          ? {
                                              ...c,
                                              assistant_ids:
                                                c.assistant_ids.map(
                                                  (a: string, k: number) =>
                                                    k === j
                                                      ? e.target.value
                                                      : a,
                                                ),
                                              assignmentDirty: true,
                                            }
                                          : c,
                                      ),
                                    )
                                  }
                                >
                                  <option value="">Chọn trợ giảng</option>
                                  {teachers
                                    .filter(
                                      (t) => t.id && t.id !== v.teacher_id,
                                    )
                                    .map((t) => (
                                      <option key={t.id} value={t.id}>
                                        {t.short_id} · {t.name}
                                      </option>
                                    ))}
                                </select>
                                <button
                                  className="secondary"
                                  onClick={() =>
                                    setCourses((rows) =>
                                      rows.map((c, n) =>
                                        n === i
                                          ? {
                                              ...c,
                                              assistant_ids:
                                                c.assistant_ids.filter(
                                                  (_: string, k: number) =>
                                                    k !== j,
                                                ),
                                              assignmentDirty: true,
                                            }
                                          : c,
                                      ),
                                    )
                                  }
                                >
                                  Xóa trợ giảng
                                </button>
                              </div>
                            ),
                          )}
                          <button
                            className="secondary"
                            disabled={(v.assistant_ids || []).length >= 10}
                            onClick={() =>
                              setCourses((rows) =>
                                rows.map((c, n) =>
                                  n === i
                                    ? {
                                        ...c,
                                        assistant_ids: [
                                          ...(c.assistant_ids || []),
                                          "",
                                        ],
                                        assignmentDirty: true,
                                      }
                                    : c,
                                ),
                              )
                            }
                          >
                            + Thêm trợ giảng
                          </button>
                        </td>
                      </tr>
                    ),
                )}
              </tbody>
            </table>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const rows = visibleCourses.filter((v) => v.assignmentDirty);
                  if (demo) {
                    setCourses((v) =>
                      v.map((c) => ({ ...c, assignmentDirty: false })),
                    );
                    setNotice("Đã lưu phân công trong bản mẫu");
                    return;
                  }
                  if (!rows.length) {
                    setNotice("Không có phân công thay đổi");
                    return;
                  }
                  await api("/assignments", {
                    rows: rows.map((v) => ({
                      course_id: v.short_id || v.id,
                      teacher_id: v.teacher_id,
                      assistant_ids: (v.assistant_ids || []).filter(Boolean),
                      revision: v.revision,
                    })),
                  });
                  await load();
                  await onChange();
                  setNotice("Đã lưu phân công");
                })
              }
            >
              Lưu phân công
            </button>
          </section>
        )}
      </fieldset>
    </div>
  );
}
