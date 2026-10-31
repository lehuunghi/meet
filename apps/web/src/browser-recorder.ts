import { drawingPage, paintDrawing, type DrawingState } from "./drawing-model";

export type CaptureTile = { stream: MediaStream; name: string };
export type CaptureScene = { tiles: Record<string, CaptureTile>; drawing?: DrawingState; target?: string };

// Draw media owned by the meeting, never the user's desktop or device screen.
export class BrowserMeetingCapture {
  private canvas = document.createElement("canvas");
  private audio = new AudioContext();
  private mix = this.audio.createMediaStreamDestination();
  private sources = new Map<string, { stream: MediaStream; signature: string; video: HTMLVideoElement; audio?: MediaStreamAudioSourceNode }>();
  private timer?: number;
  private recorder?: MediaRecorder;
  private writes = Promise.resolve();
  private failure?: Error;
  private output?: MediaStream;
  private oscillator = this.audio.createOscillator();
  constructor(private scene: () => CaptureScene, private append: (blob: Blob) => Promise<void>, private onError: (e: Error) => void) {
    this.canvas.width = 1280; this.canvas.height = 720;
    const silence = this.audio.createGain(); silence.gain.value = 0;
    this.oscillator.connect(silence).connect(this.mix); this.oscillator.start();
  }
  async start() {
    const mime = ["video/webm;codecs=vp8,opus", "video/webm"].find(t => MediaRecorder.isTypeSupported(t));
    if (!mime) throw Error("Trình duyệt chưa hỗ trợ ghi WebM. Dùng Chrome hoặc Edge trên máy tính.");
    await this.audio.resume();
    if(this.audio.state!=="running") throw Error("Bấm bật ghi hình để cho phép trình duyệt xử lý âm thanh.");
    this.draw(); this.timer = window.setInterval(() => this.draw(), 40);
    this.output = this.canvas.captureStream(25);
    this.mix.stream.getAudioTracks().forEach(t => this.output!.addTrack(t));
    this.recorder = new MediaRecorder(this.output, {mimeType: mime, videoBitsPerSecond: 1_500_000, audioBitsPerSecond: 96_000});
    this.recorder.ondataavailable = e => {
      if(!e.data.size) return;
      this.writes = this.writes.then(() => this.append(e.data)).catch(e => {
        this.failure = e instanceof Error ? e : Error(String(e));
        this.onError(this.failure);
        if(this.recorder?.state === "recording") this.recorder.stop();
      });
    };
    this.recorder.onerror = () => this.onError(Error("Trình duyệt ngừng ghi; giữ trang mở để lưu các phần đã có."));
    this.recorder.start(5000);
  }
  private draw() {
    const scene = this.scene(), ctx = this.canvas.getContext("2d")!;
    for(const [key,tile] of this.sources) if(!scene.tiles[key]) {tile.audio?.disconnect();tile.video.srcObject=null;this.sources.delete(key);}
    for(const [key,tile] of Object.entries(scene.tiles)) {
      const signature=tile.stream.getTracks().map(t=>t.id).join(":");
      if(this.sources.get(key)?.signature===signature)continue;
      this.sources.get(key)?.audio?.disconnect();
      const video=document.createElement("video");video.muted=true;video.playsInline=true;video.srcObject=tile.stream;void video.play().catch(()=>{});
      let source:MediaStreamAudioSourceNode|undefined;
      if(tile.stream.getAudioTracks().length){source=this.audio.createMediaStreamSource(tile.stream);source.connect(this.mix);}
      this.sources.set(key,{stream:tile.stream,signature,video,audio:source});
    }
    ctx.fillStyle="#202124";ctx.fillRect(0,0,1280,720);
    const ink=scene.drawing,page=ink?.active?drawingPage(ink):undefined;
    if(ink?.active&&ink.mode==="board"&&page){paintDrawing(ctx,page,1280,720,true);return;}
    const keys=[...this.sources.keys()],screen=(scene.target&&keys.includes(scene.target)?scene.target:keys.find(k=>k.endsWith(":screen"))),person=keys.find(k=>!k.endsWith(":screen")&&this.sources.get(k)!.video.videoWidth);
    const key=screen||person;
    if(!key){ctx.fillStyle="#fff";ctx.font="24px sans-serif";ctx.fillText("Đang chờ nội dung lớp học",40,360);return;}
    const video=this.sources.get(key)!.video;
    if(video.videoWidth&&this.sources.get(key)!.stream.getVideoTracks().some(t=>t.enabled&&t.readyState==="live")){const scale=Math.min(1280/video.videoWidth,720/video.videoHeight),w=video.videoWidth*scale,h=video.videoHeight*scale,x=(1280-w)/2,y=(720-h)/2;ctx.drawImage(video,x,y,w,h);if(screen&&ink?.active&&ink.mode==="screen"&&page&&scene.target===screen){ctx.save();ctx.translate(x,y);paintDrawing(ctx,page,w,h);ctx.restore();}}
    if(screen&&person){const v=this.sources.get(person)!.video;if(v.videoWidth&&this.sources.get(person)!.stream.getVideoTracks().some(t=>t.enabled&&t.readyState==="live"))ctx.drawImage(v,1000,16,264,149);}
  }
  async stop() {
    try {
      if(this.recorder&&this.recorder.state!=="inactive") await new Promise<void>(resolve=>{this.recorder!.addEventListener("stop",()=>resolve(),{once:true});this.recorder!.stop();});
      await this.writes;
      if(this.failure)throw this.failure;
    } finally {
      clearInterval(this.timer);this.sources.forEach(t=>{t.audio?.disconnect();t.video.srcObject=null});this.sources.clear();
      this.output?.getVideoTracks().forEach(t=>t.stop());this.oscillator.stop();await this.audio.close();
    }
  }
}
