import {test,expect} from "@playwright/test";
test("teacher compositor produces a playable recording without stopping source tracks",async({page})=>{
 await page.goto("/?demo=1&role=teacher");
 const result=await page.evaluate(async()=>{
  const {BrowserMeetingCapture}=await import("/src/browser-recorder.ts" as string);
  const source=document.createElement("canvas");source.width=640;source.height=360;source.getContext("2d")!.fillRect(0,0,640,360);
  const stream=source.captureStream(25),chunks:Blob[]=[],errors:string[]=[];
  const capture=new BrowserMeetingCapture(()=>({tiles:{self:{stream,name:"Teacher"}}}),async(b:Blob)=>{chunks.push(b)},(e:Error)=>errors.push(e.message));
  await capture.start();await new Promise(r=>setTimeout(r,1200));await capture.stop();
  const recording=new Blob(chunks,{type:"video/webm"}),v=document.createElement("video");v.muted=true;v.src=URL.createObjectURL(recording);
  await new Promise<void>((resolve,reject)=>{v.onloadeddata=()=>resolve();v.onerror=()=>reject(Error("video is not playable"));v.load()});
  const result={bytes:recording.size,width:v.videoWidth,height:v.videoHeight,sourceLive:stream.getTracks().every(t=>t.readyState==="live"),errors};
  stream.getTracks().forEach(t=>t.stop());URL.revokeObjectURL(v.src);return result;
 });
 expect(result.bytes).toBeGreaterThan(100);expect(result.width).toBe(1280);expect(result.height).toBe(720);expect(result.sourceLive).toBe(true);expect(result.errors).toEqual([]);
});
test("multipart browser spool survives a failed upload and completes in byte order",async({page})=>{
 let fail=true,finished=0;const lengths:number[]=[];
 await page.route("**/api/meetings/m/recordings/r/parts/*",r=>r.fulfill({json:{url:"http://127.0.0.1:5173/test-r2/"+r.request().url().split("/").pop()}}));
 await page.route("**/test-r2/*",async r=>{if(fail){fail=false;await r.fulfill({status:503,body:"retry"});return;}lengths.push(r.request().postDataBuffer()!.length);await r.fulfill({status:200,body:""});});
 await page.route("**/api/meetings/m/recordings/r/finish",r=>{finished++;return r.fulfill({json:{ok:true}})});
 await page.goto("/?demo=1&role=teacher");
 const result=await page.evaluate(async()=>{
  const s=await import("/src/recording-store.ts" as string);
  await s.removeJob("r");await s.saveJob({id:"r",owner:"teacher",school:"school",meeting:"m",title:"test",bytes:0,chunks:0,uploaded:0,stopped:false,created:Date.now()});
  await s.appendChunk("r",new Blob([new Uint8Array(s.PART_SIZE+100)]));
  try{await s.uploadRecording("r")}catch{}
  const retained=await s.getJob("r");await s.uploadRecording("r");
  await s.appendChunk("r",new Blob([new Uint8Array(200)]));await s.stopJob("r");await s.uploadRecording("r");await s.uploadRecording("r");
  return {retained:retained.bytes,removed:!(await s.getJob("r"))};
 });
 expect(result.retained).toBe(16*1024*1024+100);expect(result.removed).toBe(true);expect(lengths).toEqual([16*1024*1024,300]);expect(finished).toBe(1);
});
