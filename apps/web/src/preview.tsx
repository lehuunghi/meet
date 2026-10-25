import { useState } from "react";
import { RoomTools } from "./room-tools";
export const previewRoles = [
  { id: "admin", name: "Lê Thu Hà", label: "Admin" },
  { id: "teacher", name: "Nguyễn Minh Anh", label: "Giáo viên" },
  { id: "student", name: "Nguyễn Hoàng An", label: "Học sinh" },
];
export const previewUsers = [
  {
    id: "teacher-minh",
    name: "Nguyễn Minh Anh",
    email: "minhanh@example.test",
    role: "teacher",
  },
  {
    id: "teacher-lan",
    name: "Trần Ngọc Lan",
    email: "ngoclan@example.test",
    role: "teacher",
  },
  {
    id: "student-an",
    name: "Nguyễn Hoàng An",
    email: "hoangan@example.test",
    role: "student",
  },
  {
    id: "student-binh",
    name: "Lê Thanh Bình",
    email: "thanhbinh@example.test",
    role: "student",
  },
  {
    id: "student-chi",
    name: "Phạm Mai Chi",
    email: "maichi@example.test",
    role: "student",
  },
];
export const previewClasses = [
  { id: "class-10a1", name: "10A1" },
  { id: "class-10a2", name: "10A2" },
  { id: "class-11a1", name: "11A1" },
];
export const previewCourses = [
  {
    id: "math",
    class_id: "class-10a1",
    name: "Toán học",
    class_name: "10A1",
    teacher: "Nguyễn Minh Anh",
  },
  {
    id: "physics",
    class_id: "class-10a1",
    name: "Vật lý",
    class_name: "10A1",
    teacher: "Nguyễn Minh Anh",
  },
  {
    id: "english",
    class_id: "class-10a2",
    name: "Tiếng Anh",
    class_name: "10A2",
    teacher: "Trần Ngọc Lan",
  },
  {
    id: "math-10a2",
    class_id: "class-10a2",
    name: "Toán học",
    class_name: "10A2",
    teacher: "Nguyễn Minh Anh",
  },
];
export function RoleSwitcher({ role }: { role: string }) {
  return (
    <div className="preview-switch">
      <div>
        <strong>Xem giao diện theo vai trò</strong>
        <small>
          Dữ liệu mẫu · Không kết nối camera, máy chủ hay Cloudflare
        </small>
      </div>
      <div>
        {previewRoles.map((v) => (
          <a
            className={v.id === role ? "selected" : ""}
            key={v.id}
            href={`?demo=1&role=${v.id}${["attendance", "recordings"].includes(new URLSearchParams(location.search).get("page") || "") ? "&page=" + new URLSearchParams(location.search).get("page") : ""}`}
          >
            {v.label}
          </a>
        ))}
      </div>
    </div>
  );
}
const roster = [
  {
    name: "Nguyễn Hoàng An",
    time: "44 phút 35 giây",
    joined: "08:00",
    left: "08:45",
    status: "Đã tham gia",
  },
  {
    name: "Lê Thanh Bình",
    time: "40 phút 12 giây",
    joined: "08:04",
    left: "08:45",
    status: "Đã tham gia",
  },
  {
    name: "Phạm Mai Chi",
    time: "0 giây",
    joined: "—",
    left: "—",
    status: "Chưa tham gia",
  },
];
export function PreviewRoom({
  role,
  title,
  onExit,
}: {
  role: string;
  title: string;
  onExit: () => void;
}) {
  const [mic, setMic] = useState(true),
    [camera, setCamera] = useState(true),
    [recording, setRecording] = useState(false),
    [tab, setTab] = useState("people"),
    [message, setMessage] = useState("");
  const [pinned, setPinned] = useState("");
  return (
    <main className="room">
      <header>
        <span className="brand">
          m<span>●</span> meet
        </span>
        <h2>{title}</h2>
        <button className="secondary" onClick={onExit}>
          Rời lớp
        </button>
      </header>
      <div className="banner">
        Phòng học xem trước · Các ô bên dưới là minh họa, không có luồng video
        hoặc ghi hình thật.
      </div>
      <div className="preview-classroom">
        <section>
          <div className="preview-stage">
            <span className="pill">Toán học · 10A1</span>
            <div>
              <small>NỘI DUNG BÀI HỌC MẪU</small>
              <h1>Hàm số và đồ thị</h1>
              <p>y = ax² + bx + c</p>
              <span className="graph-symbol">∿</span>
            </div>
            <small>Nguyễn Minh Anh · Màn hình trình bày minh họa</small>
          </div>
          <div className="preview-tiles">
            {["Nguyễn Minh Anh", "Nguyễn Hoàng An", "Lê Thanh Bình"].map(
              (name, i) => (
                <article
                  key={name}
                  className={pinned === name ? "is-pinned" : ""}
                >
                  <span>{name.split(" ").at(-1)?.[0]}</span>
                  <strong>{name}</strong>
                  <small>
                    {i === 0 ? "Giáo viên" : "Học sinh"} · Hình đại diện mẫu
                  </small>
                  <button
                    className="secondary"
                    onClick={() => setPinned(pinned === name ? "" : name)}
                  >
                    {pinned === name ? "Bỏ ghim" : "Ghim"}
                  </button>
                </article>
              ),
            )}
          </div>
          <div className="room-toolbar">
            <button onClick={() => setMic(!mic)}>
              {mic ? "Tắt mic" : "Bật mic"}
            </button>
            <button onClick={() => setCamera(!camera)}>
              {camera ? "Tắt camera" : "Bật camera"}
            </button>
            {role !== "student" && (
              <>
                <button
                  className="secondary"
                  onClick={() =>
                    setMessage(
                      "Chia sẻ màn hình cần cuộc gọi thật. Bản xem trước không yêu cầu quyền thiết bị.",
                    )
                  }
                >
                  Chia sẻ màn hình
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setRecording(!recording);
                    setMessage(
                      "Chỉ thay đổi trạng thái minh họa; không tạo bản ghi thật.",
                    );
                  }}
                >
                  {recording ? "● Dừng ghi mẫu" : "Ghi hình mẫu"}
                </button>
              </>
            )}
          </div>
          {message && (
            <div className="banner" role="status">
              {message}
            </div>
          )}
        </section>
        <section className="section preview-room-side">
          <div className="preview-tabs">
            <button
              className={tab === "people" ? "selected" : ""}
              onClick={() => setTab("people")}
            >
              Thành viên
            </button>
            <button
              className={tab === "attendance" ? "selected" : ""}
              onClick={() => setTab("attendance")}
            >
              Điểm danh
            </button>
          </div>
          {tab === "people" ? (
            <>
              {previewUsers.slice(0, 4).map((v) => (
                <div className="preview-person" key={v.id}>
                  <span className="avatar">
                    {v.name.split(" ").at(-1)?.[0]}
                  </span>
                  <div>
                    <strong>{v.name}</strong>
                    <small>
                      {v.role === "teacher" ? "Giáo viên" : "Học sinh"}
                    </small>
                  </div>
                </div>
              ))}
            </>
          ) : (
            <>
              <h3>
                {role === "student" ? "Thời gian của bạn" : "Theo dõi tham gia"}
              </h3>
              {(role === "student" ? roster.slice(0, 1) : roster).map((v) => (
                <div className="preview-person" key={v.name}>
                  <div>
                    <strong>{v.name}</strong>
                    <small>
                      {v.time} · {v.status}
                    </small>
                  </div>
                </div>
              ))}
            </>
          )}
        </section>
      </div>
      <RoomTools
        demo
        meeting="preview"
        user={{
          id: role,
          name: previewRoles.find((v) => v.id === role)?.name || "Bạn",
        }}
        joined
        canManage={role !== "student"}
        onReactions={(events) => {
          if (events.length)
            setMessage("Phản ứng minh họa: " + events[0].emoji);
        }}
      />
    </main>
  );
}
