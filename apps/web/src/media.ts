import { api } from "./api";
export type Publication = {
  session_id: string;
  track_name: string;
  user_id: string;
  name: string;
};
export async function gather(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      pc.removeEventListener("icegatheringstatechange", check);
      reject(new Error("ICE gathering timeout"));
    }, 10000);
    function check() {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timer);
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    }
    pc.addEventListener("icegatheringstatechange", check);
    check();
  });
}
export class ClassroomMedia {
  private peers: RTCPeerConnection[] = [];
  private local: MediaStream | null = null;
  private known = new Set<string>();
  private closed = false;
  private receiver?: RTCPeerConnection;
  private receiverID?: string;
  private screen?: MediaStream;
  private screenSender?: RTCRtpSender;
  private remoteStreams = new Map<string, MediaStream>();
  private labels = new Map<string, { key: string; name: string }>();
  constructor(
    private meeting: string,
    private onTrack: (key: string, stream: MediaStream, name: string) => void,
  ) {}
  private async session(pc: RTCPeerConnection) {
    const s = await api(`/meetings/${this.meeting}/sfu`, { op: "new" });
    this.peers.push(pc);
    return s.sessionId as string;
  }
  private async call(body: unknown) {
    return api(`/meetings/${this.meeting}/sfu`, body);
  }
  async publish(stream: MediaStream) {
    if (this.local && this.local !== stream) {
      stream.getTracks().forEach((t) => this.local!.addTrack(t));
    } else this.local = stream;
    if (!stream.getTracks().length) return;
    const ice = await api(`/meetings/${this.meeting}/ice`, {});
    const pc = new RTCPeerConnection({ iceServers: ice.iceServers });
    const sid = await this.session(pc);
    const ts = stream.getTracks().map((t) => ({
      t,
      tr: pc.addTransceiver(t, { direction: "sendonly", streams: [stream] }),
    }));
    await pc.setLocalDescription(await pc.createOffer());
    await gather(pc);
    const result = await this.call({
      op: "tracks",
      session_id: sid,
      sessionDescription: pc.localDescription,
      tracks: ts.map(({ t, tr }) => ({
        location: "local",
        mid: tr.mid,
        trackName: t.kind + "-" + crypto.randomUUID(),
      })),
    });
    if (result.errorCode || result.tracks?.some((t: any) => t.errorCode))
      throw new Error("SFU từ chối phát media");
    await pc.setRemoteDescription(result.sessionDescription);
  }
  async subscribe(list: Publication[], self: string) {
    const fresh = list.filter(
      (p) =>
        p.user_id !== self &&
        !this.known.has(p.session_id + ":" + p.track_name),
    );
    if (this.closed || !fresh.length) return;
    if (!this.receiver) {
      const ice = await api(`/meetings/${this.meeting}/ice`, {});
      this.receiver = new RTCPeerConnection({ iceServers: ice.iceServers });
      this.receiver.ontrack = (e) => {
        const label = this.labels.get(e.transceiver.mid || "");
        if (label) {
          const merged = this.remoteStreams.get(label.key) || new MediaStream();
          merged
            .getTracks()
            .filter((t) => t.kind === e.track.kind && t.id !== e.track.id)
            .forEach((t) => {
              merged.removeTrack(t);
              t.stop();
            });
          if (!merged.getTracks().some((t) => t.id === e.track.id))
            merged.addTrack(e.track);
          this.remoteStreams.set(label.key, merged);
          this.onTrack(
            label.key,
            new MediaStream(merged.getTracks()),
            label.name,
          );
        }
      };
      this.receiverID = await this.session(this.receiver);
    }
    const pc = this.receiver;
    const batch = fresh.slice(0, 50);
    const result = await this.call({
      op: "tracks",
      session_id: this.receiverID,
      tracks: batch.map((p) => ({
        location: "remote",
        sessionId: p.session_id,
        trackName: p.track_name,
      })),
    });
    if (result.errorCode) throw new Error("Không nhận được media");
    result.tracks?.forEach((t: any, i: number) => {
      if (!t.errorCode && batch[i]) {
        const p = batch[i],
          key = p.session_id + ":" + p.track_name;
        this.labels.set(t.mid, { key: p.user_id, name: p.name });
        this.known.add(key);
      }
    });
    if (result.sessionDescription) {
      await pc.setRemoteDescription(result.sessionDescription);
      await pc.setLocalDescription(await pc.createAnswer());
      await gather(pc);
      await this.call({
        op: "renegotiate",
        session_id: this.receiverID,
        sessionDescription: pc.localDescription,
      });
    }
  }
  toggle(kind: "audio" | "video") {
    this.local
      ?.getTracks()
      .filter((t) => t.kind === kind)
      .forEach((t) => (t.enabled = !t.enabled));
  }
  async share() {
    const video = this.local?.getVideoTracks()[0];
    let sender =
      this.screenSender ||
      this.peers.flatMap((p) => p.getSenders()).find((s) => s.track === video);
    if (this.screen && sender) {
      await sender.replaceTrack(video || null);
      this.screen.getTracks().forEach((t) => t.stop());
      this.screen = undefined;
    }
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: true,
    });
    const track = display.getVideoTracks()[0];
    if (!sender) {
      try {
        await this.publish(display);
        sender = this.peers
          .flatMap((p) => p.getSenders())
          .find((s) => s.track === track);
      } catch (e) {
        display.getTracks().forEach((t) => t.stop());
        throw e;
      }
      if (!sender) {
        display.getTracks().forEach((t) => t.stop());
        throw new Error("Không phát được màn hình");
      }
    }
    const activeSender = sender;
    this.screen = display;
    this.screenSender = sender;
    await sender.replaceTrack(track);
    track.onended = () => {
      if (this.screen === display) {
        this.screen = undefined;
        void activeSender.replaceTrack(video || null).catch(() => {});
        if (!video) this.local?.removeTrack(track);
      }
    };
    return display;
  }
  async setEnabled(kind: "audio" | "video", enabled: boolean) {
    if (
      !this.local
        ?.getTracks()
        .some((t) => t.kind === kind && t.readyState !== "ended") &&
      enabled
    ) {
      this.local
        ?.getTracks()
        .filter((t) => t.kind === kind && t.readyState === "ended")
        .forEach((t) => this.local!.removeTrack(t));
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: kind === "audio",
        video: kind === "video",
      });
      await this.publish(stream);
    }
    this.local
      ?.getTracks()
      .filter((t) => t.kind === kind)
      .forEach((t) => (t.enabled = enabled));
    return this.local;
  }
  close() {
    this.closed = true;
    this.screen?.getTracks().forEach((t) => t.stop());
    this.screen = undefined;
    this.peers.forEach((p) => {
      p.getSenders().forEach((s) => s.track?.stop());
      p.close();
    });
    this.local?.getTracks().forEach((t) => t.stop());
  }
}
