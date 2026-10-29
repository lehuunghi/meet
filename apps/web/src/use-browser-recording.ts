import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { BrowserMeetingCapture, type CaptureScene } from "./browser-recorder";
import { acquireCapture, appendChunk, saveJob, stopJob, uploadRecording, getJob, removeJob } from "./recording-store";
import type { DrawingState } from "./drawing-model";

type Job={id:string;meeting:string;lease:string};
export function useBrowserRecording(p:{enabled:boolean;meeting:string;owner:string;school:string;title:string;scene:CaptureScene}){
 const latest=useRef(p);latest.current=p;
 const [status,setStatus]=useState(""),[activeId,setActiveId]=useState("");
 const current=useRef<{stop:()=>Promise<void>}|null>(null);
 useEffect(()=>{
  if(!p.enabled)return;
  let cancelled=false,stopping:Promise<void>|undefined,job:Job|undefined,id="",capture:BrowserMeetingCapture|undefined,release:(()=>void)|undefined,releaseFile:(()=>void)|undefined,timer:number|undefined,busy=false,lastLease=Date.now();
  let drawing:DrawingState|undefined,target:string|undefined;
  let initialized:Promise<void>=Promise.resolve(),started=false;
  const call=async(action:string)=>{
   const res=await fetch(`/api/meetings/${p.meeting}/browser-recording/${job!.id}/${action}`,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json","X-Recording-Lease":job!.lease},body:JSON.stringify({State:started?"recording":"starting"}),signal:AbortSignal.timeout(20000)});
   const body=await res.json();if(!res.ok)throw Object.assign(Error(body.error||"Không điều khiển được ghi hình"),{status:res.status});return body;
  };
  const stop=()=>stopping??=(async()=>{
   cancelled=true;clearInterval(timer);
   await initialized.catch(()=>{});
   try {await capture?.stop();}catch(e){setStatus((e as Error).message);}
   try {if(id){const stored=await getJob(id);if(stored?.bytes){await stopJob(id);await uploadRecording(id,setStatus);await uploadRecording(id,setStatus);}else{await api(`/meetings/${p.meeting}/recordings/${id}/abort`,{});await removeJob(id);}}}catch(e){setStatus((e as Error).message+" · Có thể tải lại trong Bản ghi còn trên thiết bị.");}
   finally{releaseFile?.();release?.();if(job)await call("release").catch(()=>{});setActiveId("");}
  })();
  current.current={stop};
  const pump=async()=>{
   if(busy||cancelled||!job)return;busy=true;
   try{
    const state=await call("tick");if(cancelled)return;
    if(state.stop){void stop();return;}lastLease=Date.now();
    drawing=state.drawing||undefined;target=undefined;
    if(drawing?.mode==="screen"){
     for(const track of state.list||[]){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(track.session_id+":"+track.track_name));const key=[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,"0")).join("");if(key===drawing.target){target=track.user_id+":screen";break;}}
     if(target?.startsWith(p.owner+":"))target="self:screen";
    }
    if(id)void uploadRecording(id,setStatus).catch(e=>setStatus(e.message));
   }catch(e){setStatus((e as Error).message);if([401,403,409].includes((e as {status?:number}).status||0))void stop();}
   finally{busy=false;}
  };
  initialized=(async()=>{
   try{
    if(!window.MediaRecorder||!indexedDB)throw Error("Trình duyệt không hỗ trợ ghi và lưu phục hồi.");
    release=await acquireCapture("room:"+p.school+":"+p.meeting);if(cancelled)return;
    while(!cancelled&&!job){
     try{job=await api<Job>(`/meetings/${p.meeting}/browser-recording`,{});}catch(e){if((e as {status?:number}).status!==409)throw e;setStatus("Đang chờ quyền ghi của buổi học…");await new Promise(r=>setTimeout(r,5000));}
    }
    if(cancelled)return;
    const start=await call("start");id=start.id;
    await saveJob({id,owner:p.owner,school:p.school,meeting:p.meeting,title:p.title,bytes:0,chunks:0,uploaded:0,stopped:false,created:Date.now()});
    if(cancelled)return;
    releaseFile=await acquireCapture(id);if(cancelled)return;
    capture=new BrowserMeetingCapture(()=>({...latest.current.scene,drawing,target}),blob=>appendChunk(id,blob),e=>{setStatus(e.message);void stop();});
    await capture.start();started=true;if(cancelled)return;
    setActiveId(id);setStatus("Đang ghi trên thiết bị · Giữ trang mở đến khi tải xong");
    timer=window.setInterval(()=>{if(Date.now()-lastLease>45000){setStatus("Mất kết nối điều phối; dừng ghi để tránh trùng bản ghi.");void stop();}else void pump();},2000);void pump();
   }catch(e){setStatus((e as Error).message);throw e;}
  })();
  void initialized.catch(()=>{void stop();});
  const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue="";};window.addEventListener("beforeunload",warn);
  return()=>{window.removeEventListener("beforeunload",warn);void stop();};
 },[p.enabled,p.meeting,p.owner,p.school]);
 return {status,activeId,stop:async()=>{await current.current?.stop();}};
}
