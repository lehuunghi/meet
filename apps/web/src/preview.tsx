import {MeetingDrawing,requestDrawing} from "./meeting-drawing";
import { useState } from "react";
import { RoomTools } from "./room-tools";
import { MeetingControls, MeetingClock, MeetingLeaveDialog, MeetingModal, type MeetingPanel } from "./meeting-controls";
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
  const [recordingEnabled,setRecordingEnabled]=useState(false);
  const [pinned, setPinned] = useState("");
  const [panelTab,setPanelTab]=useState<MeetingPanel>('people'),[raised,setRaised]=useState(false),[people,setPeople]=useState(2),[unread,setUnread]=useState(0),[mirror,setMirror]=useState(true);
  const [leaveChoice,setLeaveChoice]=useState<false|'leave'|'end'>(false),[info,setInfo]=useState('');
  const openPanel=(next:MeetingPanel)=>{setToolsOpen(!(toolsOpen&&panelTab===next));setPanelTab(next);};

  return (
    <main className={"room" + (toolsOpen ? " room-tools-open" : "")}>
      <header>
        <span className="room-header-identity"><MeetingClock/><span className="room-header-code">Phòng minh họa</span></span><span className="brand room-brand">VA Meet</span>
        <h2>{title}</h2>
      </header>
      <div className="banner">
        Phòng học xem trước · Các ô bên dưới là minh họa, không có luồng video
        hoặc ghi hình thật.
      </div>
      <div className="preview-classroom">
        <section>
          <div className="preview-stage" data-presentation={role!=="student"?role:"teacher"}>
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
          <div className="room-toolbar"><MeetingControls recordingEnabled={recordingEnabled} recordingState={recordingEnabled?"recording":"stopped"} onRecording={()=>{setRecordingEnabled(!recordingEnabled);setMessage(recordingEnabled?"Đã dừng ghi hình (xem trước)":"Đã bật ghi hình (xem trước)");}} onBoard={()=>requestDrawing("preview", "board")} joined mic={mic} camera={camera} sharing={false} raised={raised} busy={false} canManage={role!=='student'} people={people} unread={unread} panel={toolsOpen?panelTab:null} code="Phòng minh họa" onMic={()=>setMic(!mic)} onCamera={()=>setCamera(!camera)} onShare={()=>setMessage('Chia sẻ màn hình cần cuộc gọi thật. Bản xem trước không yêu cầu quyền thiết bị.')} onHand={()=>setRaised(!raised)} onReact={emoji=>setMessage('Phản ứng minh họa: '+emoji)} onPanel={openPanel} onLeave={()=>role!=='student'?setLeaveChoice('leave'):onExit()} onEnd={()=>setLeaveChoice('end')} onSettings={()=>setInfo('Cài đặt thiết bị')} onInfo={()=>setInfo('Thông tin phòng học')} mirror={mirror} onMirror={()=>setMirror(!mirror)} onFullscreen={()=>void document.querySelector<HTMLElement>('.room')?.requestFullscreen?.().catch(()=>setMessage('Trình duyệt chưa hỗ trợ toàn màn hình'))}/></div>
          {leaveChoice&&<MeetingLeaveDialog busy={false} ending={leaveChoice==='end'} onLeave={onExit} onEnd={onExit} onClose={()=>setLeaveChoice(false)}/>}
          {info&&<MeetingModal title={info} onClose={()=>setInfo('')}><p>Đây là bản xem trước. Không có kết nối SFU, truy cập camera/micro hoặc thay đổi buổi học thật.</p></MeetingModal>}
          {message && (
            <div className="banner" role="status">
              {message}
            </div>
          )}
        </section>
      </div>
      <MeetingDrawing demo joined meeting="preview" user={{id:role,name:role}} canManage={role!=="student"}/>
      <RoomTools panelTab={panelTab} onPanelTabChange={setPanelTab} handRaised={raised} onHandChange={setRaised} onStats={s=>{setPeople(s.people);setUnread(s.unread);}}
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
