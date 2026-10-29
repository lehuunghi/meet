import { useEffect, useState } from "react";
import { api } from "./api";
import { VNDateInput } from "./date-input";
import { vnTime } from "./date-format";
type Row = Record<string, any>;
export function AcademicOperations({
  demo,
  classes,
  courses,
  onChange,
}: {
  demo: boolean;
  classes: Row[];
  courses: Row[];
  onChange: () => Promise<void>;
}) {
  const [terms, setTerms] = useState<Row[]>([]),
    [history, setHistory] = useState<Row[]>([]),
    [sessions, setSessions] = useState<Row[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [term, setTerm] = useState({
      ID: "",
      Name: "",
      Starts: "",
      Ends: "",
      Closed: false,
      Revision: 0,
    }),
    [binding, setBinding] = useState({ Class: "", Term: "" }),
    [transfer, setTransfer] = useState({
      User: "",
      From: "",
      To: "",
      Reason: "",
    });
  const [schedule, setSchedule] = useState({
    Course: "",
    Name: "",
    Starts: "",
    Ends: "",
    startTime: "07:00",
    endTime: "08:00",
  });
  async function load() {
    if (demo) return;
    try {
      const [t, h, s] = await Promise.all([
        api<Row[]>("/academic/operations?kind=terms"),
        api<Row[]>("/academic/operations?kind=transfers"),
        api<Row[]>("/academic/operations?kind=sessions"),
      ]);
      setTerms(t);
      setHistory(h);
      setSessions(s);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [demo]);
  async function save(value: Row) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      if (demo) {
        setMessage("Bản xem thử: chưa ghi dữ liệu.");
        return;
      }
      await api("/academic/operations", value);
      await load();
      await onChange();
      setMessage("Đã lưu. Lịch sử buổi học cũ được giữ nguyên.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const [directory, setDirectory] = useState<Row[]>([]),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0);
  useEffect(() => {
    if (demo) return;
    const c = new AbortController();
    const timer = setTimeout(() => {
      api<Row[]>(
        "/academic/operations?kind=directory&q=" +
          encodeURIComponent(query) +
          "&page=" +
          page,
        undefined,
        "GET",
        c.signal,
      )
        .then(setDirectory)
        .catch((e) => {
          if (!c.signal.aborted) setMessage(e.message);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [query, page, demo]);
  const options = classes.map((c) => (
    <option key={c.id} value={c.id}>
      {c.short_id} · {c.name}
      {c.term_name ? " · " + c.term_name : ""}
    </option>
  ));
  return (
    <section aria-label="Năm học, chuyển lớp và lịch dạy">
      <p>
        Chuyển lớp chỉ áp dụng cho các buổi sau thời điểm chuyển. Buổi cũ giữ
        danh sách riêng. Dữ liệu trước phiên bản 0.33 là lịch sử kế thừa, cần
        đối chiếu khi có thay đổi lớp trước đây.
      </p>
      {message && (
        <div className="banner" role="status">
          {message}
        </div>
      )}
      <fieldset disabled={busy}>
        <legend>Tra cứu toàn bộ tài khoản</legend>
        <label>
          Tìm ID, mã SV, tên hoặc email
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Họ tên</th>
                <th>Mã SV</th>
                <th>Email</th>
                <th>Vai trò</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {directory.slice(0, 50).map((u) => (
                <tr key={u.id}>
                  <td>{u.short_id}</td>
                  <td>{u.name}</td>
                  <td>{u.student_code}</td>
                  <td>{u.email}</td>
                  <td>
                    {u.role === "student"
                      ? "Học sinh"
                      : u.role === "teacher"
                        ? "Giáo viên"
                        : "Quản trị"}
                  </td>
                  <td>{Number(u.active) ? "Hoạt động" : "Đã ngưng"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          className="secondary"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
        >
          Trang trước
        </button>
        <span> Trang {page + 1} </span>
        <button
          className="secondary"
          disabled={directory.length <= 50}
          onClick={() => setPage(page + 1)}
        >
          Trang sau
        </button>
      </fieldset>
      <fieldset disabled={busy}>
        <legend>Năm học / học kỳ</legend>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save({ Action: "term", ...term });
          }}
        >
          <label>
            Tên
            <input
              required
              maxLength={100}
              value={term.Name}
              onChange={(e) => setTerm({ ...term, Name: e.target.value })}
            />
          </label>
          <label>
            Từ ngày
            <VNDateInput
              required
              value={term.Starts}
              onValueChange={(Starts) => setTerm({ ...term, Starts })}
            />
          </label>
          <label>
            Đến ngày
            <VNDateInput
              required
              value={term.Ends}
              onValueChange={(Ends) => setTerm({ ...term, Ends })}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={term.Closed}
              onChange={(e) => setTerm({ ...term, Closed: e.target.checked })}
            />
            Khóa năm học/học kỳ — không mở buổi mới
          </label>
          <button>{term.ID ? "Lưu thay đổi" : "Thêm năm học/học kỳ"}</button>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              setTerm({
                ID: "",
                Name: "",
                Starts: "",
                Ends: "",
                Closed: false,
                Revision: 0,
              })
            }
          >
            Tạo mới
          </button>
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tên</th>
                <th>Thời gian</th>
                <th>Trạng thái</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {terms.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>
                    {vnTime(t.starts_on)} – {vnTime(t.ends_on)}
                  </td>
                  <td>{Number(t.closed) ? "Đã khóa" : "Hoạt động"}</td>
                  <td>
                    <button
                      className="secondary"
                      onClick={() =>
                        setTerm({
                          ID: t.id,
                          Name: t.name,
                          Starts: String(t.starts_on).slice(0, 10),
                          Ends: String(t.ends_on).slice(0, 10),
                          Closed: Boolean(Number(t.closed)),
                          Revision: Number(t.revision),
                        })
                      }
                    >
                      Sửa
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save({ Action: "class-term", ...binding });
          }}
        >
          <label>
            Lớp
            <select
              required
              value={binding.Class}
              onChange={(e) =>
                setBinding({ ...binding, Class: e.target.value })
              }
            >
              <option value="">Chọn lớp</option>
              {options}
            </select>
          </label>
          <label>
            Năm học/học kỳ
            <select
              required
              value={binding.Term}
              onChange={(e) => setBinding({ ...binding, Term: e.target.value })}
            >
              <option value="">Chọn năm học/học kỳ</option>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <button>Gán cho lớp</button>
        </form>
      </fieldset>
      <fieldset disabled={busy}>
        <legend>Chuyển lớp</legend>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (
              window.confirm(
                "Chuyển học sinh sang lớp mới và giữ lịch sử lớp cũ?",
              )
            )
              void save({ Action: "transfer", ...transfer });
          }}
        >
          <label>
            ID hoặc mã SV
            <input
              required
              value={transfer.User}
              onChange={(e) =>
                setTransfer({ ...transfer, User: e.target.value })
              }
            />
          </label>
          <label>
            Lớp hiện tại
            <select
              required
              value={transfer.From}
              onChange={(e) =>
                setTransfer({ ...transfer, From: e.target.value })
              }
            >
              <option value="">Chọn lớp</option>
              {options}
            </select>
          </label>
          <label>
            Lớp mới
            <select
              required
              value={transfer.To}
              onChange={(e) => setTransfer({ ...transfer, To: e.target.value })}
            >
              <option value="">Chọn lớp</option>
              {options}
            </select>
          </label>
          <label>
            Lý do
            <input
              required
              maxLength={500}
              value={transfer.Reason}
              onChange={(e) =>
                setTransfer({ ...transfer, Reason: e.target.value })
              }
            />
          </label>
          <button>Chuyển lớp</button>
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Học sinh</th>
                <th>Từ lớp</th>
                <th>Đến lớp</th>
                <th>Ngày chuyển</th>
                <th>Lý do</th>
              </tr>
            </thead>
            <tbody>
              {history.map((t) => (
                <tr key={t.id}>
                  <td>
                    {t.short_id} · {t.name}
                  </td>
                  <td>{t.from_name}</td>
                  <td>{t.to_name}</td>
                  <td>{vnTime(t.at)}</td>
                  <td>{t.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>
      <fieldset disabled={busy}>
        <legend>Lịch dạy và buổi cần kiểm tra</legend>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            try {
              void save({
                Action: "schedule",
                Course: schedule.Course,
                Name: schedule.Name,
                Starts: new Date(
                  schedule.Starts + "T" + schedule.startTime,
                ).toISOString(),
                Ends: new Date(
                  schedule.Ends + "T" + schedule.endTime,
                ).toISOString(),
              });
            } catch {
              setMessage("Nhập đủ ngày và giờ hợp lệ");
            }
          }}
        >
          <label>
            Môn
            <select
              required
              value={schedule.Course}
              onChange={(e) =>
                setSchedule({ ...schedule, Course: e.target.value })
              }
            >
              <option value="">Chọn môn</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.class_name} · {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tên buổi
            <input
              required
              maxLength={200}
              value={schedule.Name}
              onChange={(e) =>
                setSchedule({ ...schedule, Name: e.target.value })
              }
            />
          </label>
          <label>
            Ngày bắt đầu
            <VNDateInput
              required
              value={schedule.Starts}
              onValueChange={(Starts) => setSchedule({ ...schedule, Starts })}
            />
          </label>
          <label>
            Giờ bắt đầu
            <input
              type="time"
              required
              value={schedule.startTime}
              onChange={(e) =>
                setSchedule({ ...schedule, startTime: e.target.value })
              }
            />
          </label>
          <label>
            Ngày kết thúc
            <VNDateInput
              required
              value={schedule.Ends}
              onValueChange={(Ends) => setSchedule({ ...schedule, Ends })}
            />
          </label>
          <label>
            Giờ kết thúc
            <input
              type="time"
              required
              value={schedule.endTime}
              onChange={(e) =>
                setSchedule({ ...schedule, endTime: e.target.value })
              }
            />
          </label>
          <button>Lưu lịch dạy</button>
        </form>
        <p>
          Lịch trùng lớp hoặc giáo viên sẽ bị chặn. Không tự kết thúc khi giáo
          viên mất mạng.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Lớp · Môn</th>
                <th>Buổi học</th>
                <th>Thời gian dự kiến</th>
                <th>Trạng thái</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.class_name} · {s.subject}
                  </td>
                  <td>{s.title}</td>
                  <td>
                    {vnTime(s.starts_at)}
                    {s.ends_at ? " – " + vnTime(s.ends_at) : ""}
                  </td>
                  <td>
                    {Number(s.cancelled)
                      ? "Đã hủy lịch"
                      : s.status === "live"
                        ? "Đang học"
                        : s.status === "scheduled"
                          ? "Chuẩn bị"
                          : "Đã kết thúc"}
                    {Number(s.teacher_missing)
                      ? " · Kiểm tra kết nối giáo viên"
                      : ""}
                    {Number(s.stale_preparation)
                      ? " · Lịch đã quá giờ, cần kiểm tra"
                      : ""}
                  </td>
                  <td>
                    {s.status === "scheduled" ? (
                      <button
                        className="secondary"
                        onClick={() => {
                          if (window.confirm("Hủy buổi chưa bắt đầu?"))
                            void save({ Action: "cancel-schedule", ID: s.id });
                        }}
                      >
                        Hủy lịch
                      </button>
                    ) : (
                      s.status === "live" && (
                        <button
                          className="secondary"
                          onClick={() => {
                            if (
                              window.confirm(
                                "Kết thúc buổi học này cho tất cả mọi người?",
                              )
                            ) {
                              setBusy(true);
                              api(`/meetings/${s.id}/state`, {
                                status: "ended",
                              })
                                .then(load)
                                .catch((e) => setMessage(e.message))
                                .finally(() => setBusy(false));
                            }
                          }}
                        >
                          Kết thúc buổi
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>
    </section>
  );
}
