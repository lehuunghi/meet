import { useEffect, useState } from "react";
import { api } from "./api";

export function DeleteLearningData({ kind, label, scope = {}, demo = false, onDeleted }: {kind:"attendance"|"videos"|"all";label:string;scope?:Record<string,string>;demo?:boolean;onDeleted?:()=>void|Promise<void>}) {
 const [open,setOpen]=useState(false),[confirm,setConfirm]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 return <div className="learning-delete-action">
  <button type="button" className="secondary danger" disabled={busy} onClick={()=>{setOpen(!open);setConfirm("");setError("");setNotice("")}}>{label}</button>
  {open && <form className="learning-delete-confirm" onSubmit={async e=>{e.preventDefault();if(busy || confirm!=="XÓA")return;setBusy(true);setError("");try{if(!demo)await api("/academy/admin/data-cleanup",{kind,...scope,confirm});await onDeleted?.();setOpen(false);setNotice(demo?"Đã xóa dữ liệu minh họa.":"Đã xóa. File video được dọn khỏi R2 tự động.")}catch(e){setError((e as Error).message)}finally{setBusy(false)}}}>
   <p>{kind==="attendance"?"Xóa toàn bộ kết quả và lịch sử ra/vào của phạm vi đã chọn. Báo cáo đã xóa sẽ không còn hiển thị.":scope.recording_id || scope.meeting_id?"Xóa bản ghi lớp học đã chọn. Bản sao đã đăng riêng thành bài giảng vẫn được giữ lại.":kind==="all"?"Xóa toàn bộ điểm danh, bản ghi và bài giảng video. Giữ khóa học, lớp, tài khoản và quyền VIP.":scope.lesson_id?"Xóa bài giảng, video và tiến độ xem liên quan. Giữ bản ghi lớp học gốc.":"Xóa tất cả bản ghi lớp học và bài giảng video. Giữ khóa học, lớp, tài khoản và quyền VIP."}</p>
   <label>Nhập XÓA để xác nhận<input value={confirm} onChange={e=>setConfirm(e.target.value)} autoComplete="off" required disabled={busy}/></label>
   <div className="academy-actions"><button className="danger" disabled={busy || confirm!=="XÓA"}>{busy?"Đang xóa…":"Xác nhận xóa"}</button><button type="button" className="secondary" disabled={busy} onClick={()=>setOpen(false)}>Hủy</button></div>
  </form>}
  {error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
 </div>
}

export function LearningDataCleanup({demo=false}:{demo?:boolean}) {
 const [counts,setCounts]=useState<any>(null),[error,setError]=useState("");
 async function refresh(){try{setCounts(demo?{attendance_rows:12,recordings:2,lessons:3,pending_objects:0}:(await api<any[]>("/academy/admin/data-cleanup?kind=all"))[0]);setError("")}catch(e){setError((e as Error).message)}}
 useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),15000);return()=>clearInterval(timer)},[demo]);
 return <details className="learning-data-cleanup"><summary>Quản lý dữ liệu điểm danh & video</summary>
  <p>Chỉ quản trị có đủ quyền được xóa. Kết thúc các buổi đang học và đợi sao chép video hoàn tất trước khi thực hiện.</p>
  {counts && <p>{counts.attendance_rows} dòng điểm danh · {counts.recordings} bản ghi · {counts.lessons} bài giảng · <strong>{counts.pending_objects} file R2 chờ xóa</strong></p>}
  {error && <p role="alert" className="error">{error}</p>}
  <div className="academy-actions"><DeleteLearningData kind="attendance" label="Xóa tất cả điểm danh" demo={demo} onDeleted={refresh}/><DeleteLearningData kind="videos" label="Xóa tất cả video" demo={demo} onDeleted={refresh}/></div>
  <button type="button" className="secondary" onClick={()=>void refresh()}>Kiểm tra trạng thái</button>
 </details>
}
