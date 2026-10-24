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
  private peerCreated = new Map<RTCPeerConnection, number>();
  private local: MediaStream | null = null;
  private known = new Set<string>();
  private knownOwners = new Map<string, string>();
  private closed = false;
  private receiver?: RTCPeerConnection;
  private receiverID?: string;
  private screen?: MediaStream;
  private screenSender?: RTCRtpSender;
  private remoteStreams = new Map<string, MediaStream>();
  private labels = new Map<string, { key: string; name: string }>();
  private queue: Promise<unknown> = Promise.resolve();
  private created = Date.now();
  private disconnectedAt = 0;
  private retryAt = 0;
  private failures = 0;
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(() => {
      if (this.closed) throw new Error("Đã rời lớp");
      return work();
    });
    this.queue = next.catch(() => {
      this.created = 0;
    });
    return next;
  }
  constructor(
    private meeting: string,
    private onTrack: (key: string, stream: MediaStream, name: string) => void,
    private onRemove: (key: string) => void = () => {},
    private onState: (state: string) => void = () => {},
  ) {}
  private async session(pc: RTCPeerConnection) {
    this.peers.push(pc);
    this.peerCreated.set(pc, Date.now());
    const s = await api(`/meetings/${this.meeting}/sfu`, { op: "new" });
    if (this.closed) {
      pc.close();
      throw new Error("Đã rời lớp");
    }
    return s.sessionId as string;
  }
  private async call(body: unknown) {
    if (this.closed) throw new Error("Đã rời lớp");
    return api(`/meetings/${this.meeting}/sfu`, body);
  }
  publish(stream: MediaStream) {
    return this.serial(() => this.publishInternal(stream));
  }
  private async publishInternal(stream: MediaStream) {
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
  subscribe(list: Publication[], self: string) {
    return this.serial(() => this.subscribeInternal(list, self));
  }
  private async subscribeInternal(list: Publication[], self: string) {
    const present = new Set(
      list.filter((p) => p.user_id !== self).map((p) => p.user_id),
    );
    this.remoteStreams.forEach((stream, key) => {
      if (!present.has(key)) {
        stream.getTracks().forEach((t) => t.stop());
        this.remoteStreams.delete(key);
        this.onRemove(key);
      }
    });
    this.knownOwners.forEach((owner, key) => {
      if (!present.has(owner)) {
        this.known.delete(key);
        this.knownOwners.delete(key);
      }
    });
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
        if (this.closed) {
          e.track.stop();
          return;
        }
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
        this.knownOwners.set(key, p.user_id);
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
    if (result.tracks?.some((t: any) => t.errorCode))
      throw new Error("Một luồng nhận bị lỗi; đang chuẩn bị kết nối lại");
  }
  toggle(kind: "audio" | "video") {
    this.local
      ?.getTracks()
      .filter((t) => t.kind === kind)
      .forEach((t) => (t.enabled = !t.enabled));
  }
  share() {
    return this.serial(() => this.shareInternal());
  }
  private async shareInternal() {
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
        await this.publishInternal(display);
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
  setEnabled(kind: "audio" | "video", enabled: boolean) {
    return this.serial(() => this.setEnabledInternal(kind, enabled));
  }
  private async setEnabledInternal(kind: "audio" | "video", enabled: boolean) {
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
      await this.publishInternal(stream);
    }
    this.local
      ?.getTracks()
      .filter((t) => t.kind === kind)
      .forEach((t) => (t.enabled = enabled));
    return this.local;
  }
  recover(force = false) {
    return this.serial(async () => {
      const now = Date.now();
      const failed = this.peers.some(
        (p) =>
          p.connectionState === "failed" ||
          p.iceConnectionState === "failed" ||
          ((p.connectionState === "connecting" ||
            p.connectionState === "new") &&
            now - (this.peerCreated.get(p) || now) > 30000),
      );
      const disconnected = this.peers.some(
        (p) =>
          p.connectionState === "disconnected" ||
          p.iceConnectionState === "disconnected",
      );
      if (disconnected && !this.disconnectedAt) this.disconnectedAt = now;
      if (!disconnected) this.disconnectedAt = 0;
      if (
        !force &&
        !failed &&
        !(this.disconnectedAt && now - this.disconnectedAt > 10000) &&
        now - this.created < 45 * 60000
      )
        return;
      if (now < this.retryAt) return;
      this.onState("Đang kết nối lại…");
      try {
        await api(`/meetings/${this.meeting}/media/reset`, {});
        this.peers.forEach((p) => p.close());
        this.peers = [];
        this.peerCreated.clear();
        this.screen?.getTracks().forEach((t) => {
          t.stop();
          this.local?.removeTrack(t);
        });
        this.screen = undefined;
        this.screenSender = undefined;
        this.receiver = undefined;
        this.receiverID = undefined;
        this.known.clear();
        this.knownOwners.clear();
        this.labels.clear();
        this.remoteStreams.forEach((stream, key) => {
          stream.getTracks().forEach((t) => t.stop());
          this.onRemove(key);
        });
        this.remoteStreams.clear();
        if (this.local) await this.publishInternal(this.local);
        this.created = Date.now();
        this.disconnectedAt = 0;
        this.failures = 0;
        this.retryAt = 0;
        this.onState("Đã kết nối lại");
      } catch (e) {
        this.failures++;
        this.retryAt =
          Date.now() + Math.min(60000, 2000 * 2 ** Math.min(this.failures, 5));
        this.created = 0; // Keep retrying even if a failed attempt allocated no peer.
        this.onState("Kết nối gián đoạn · sẽ tự thử lại");
        throw e;
      }
    });
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
    this.remoteStreams.forEach((stream) =>
      stream.getTracks().forEach((t) => t.stop()),
    );
  }
}
