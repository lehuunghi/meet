import { useState } from "react";
import { RoomTools } from "./room-tools";
import { CallIcon } from "./call-icon";
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
    [toolsOpen, setToolsOpen] = useState(false),
    [message, setMessage] = useState("");
  const [pinned, setPinned] = useState("");
  return (
    <main className={"room" + (toolsOpen ? " room-tools-open" : "")}>
      <header>
        <span className="brand">
          m<span>●</span> meet
        </span>
        <h2>{title}</h2>
      </header>
      <div className="banner">
        Phòng học xem trước · Các ô bên dưới là minh họa, không có luồng video
        hoặc ghi hình thật.
      </div>
      <div className="preview-classroom">
        <section>
          <div className="preview-stage">
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
            <button
              className="call-control"
              aria-label={mic ? "Tắt mic" : "Bật mic"}
              aria-pressed={mic}
              onClick={() => setMic(!mic)}
            >
              <CallIcon kind="mic" off={!mic} />
              <span className="control-label">
                {mic ? "Tắt mic" : "Bật mic"}
              </span>
            </button>
            <button
              className="call-control"
              aria-label={camera ? "Tắt camera" : "Bật camera"}
              aria-pressed={camera}
              onClick={() => setCamera(!camera)}
            >
              <CallIcon kind="camera" off={!camera} />
              <span className="control-label">
                {camera ? "Tắt camera" : "Bật camera"}
              </span>
            </button>
            <button
              className="call-control"
              aria-label="Chia sẻ màn hình"
              onClick={() =>
                setMessage(
                  "Chia sẻ màn hình cần cuộc gọi thật. Bản xem trước không yêu cầu quyền thiết bị.",
                )
              }
            >
              <CallIcon kind="present" />
              <span className="control-label">Chia sẻ màn hình</span>
            </button>
            <button
              className="call-control"
              aria-label="Người tham gia & trò chuyện"
              aria-expanded={toolsOpen}
              onClick={() => setToolsOpen(!toolsOpen)}
            >
              <CallIcon kind="people" />
              <span className="control-label">Người tham gia & trò chuyện</span>
            </button>
            <button
              className="call-control room-leave"
              aria-label="Rời lớp"
              onClick={onExit}
            >
              <CallIcon kind="leave" />
              <span className="control-label">Rời lớp</span>
            </button>
          </div>{" "}
          {message && (
            <div className="banner" role="status">
              {message}
            </div>
          )}
        </section>
      </div>
      <RoomTools
        open={toolsOpen}
        onClose={() => setToolsOpen(false)}
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
