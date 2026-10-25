import { api } from "./api";
export type Publication = {
  session_id: string;
  track_name: string;
  user_id: string;
  name: string;
};
export const publicationKey = (p: Publication) =>
  p.user_id + (p.track_name.startsWith("screen-") ? ":screen" : "");
// Cloudflare SFU accepts direct ICE connections. Do not make a configured-STUN-only
// installation wait on an unreachable public STUN service; keep TURN pools intact.
export function classroomIceServers(
  servers: RTCIceServer[] = [],
): RTCIceServer[] {
  return servers.some((server) =>
    (Array.isArray(server.urls) ? server.urls : [server.urls]).some((url) =>
      /^turns?:/i.test(url),
    ),
  )
    ? servers
    : [];
}
export async function gather(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      pc.removeEventListener("icegatheringstatechange", check);
      // SFU is ICE-lite: available host/server-reflexive candidates can still
      // establish outbound connectivity even if one STUN server never completes.
      // Keep DTLS/ICE validation unchanged; do not accept an empty candidate set.
      if (/^a=candidate:/m.test(pc.localDescription?.sdp || "")) resolve();
      else
        reject(
          new Error(
            "Không lấy được đường truyền media. Kiểm tra mạng và cấu hình TURN của trường.",
          ),
        );
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
  private sessionIDs = new Map<RTCPeerConnection, string>();
  private local: MediaStream | null = null;
  private known = new Set<string>();
  private knownOwners = new Map<string, string>();
  private closed = false;
  private receiver?: RTCPeerConnection;
  private receiverID?: string;
  private screen?: MediaStream;
  private screenPeer?: RTCPeerConnection;
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
    private request: typeof api = api,
  ) {}
  private async session(pc: RTCPeerConnection) {
    this.peers.push(pc);
    this.peerCreated.set(pc, Date.now());
    const s = await this.request(`/meetings/${this.meeting}/sfu`, {
      op: "new",
    });
    this.sessionIDs.set(pc, s.sessionId);
    if (this.closed) {
      pc.close();
      throw new Error("Đã rời lớp");
    }
    return s.sessionId as string;
  }
  private async call(body: unknown) {
    if (this.closed) throw new Error("Đã rời lớp");
    return this.request(`/meetings/${this.meeting}/sfu`, body);
  }
  publish(stream: MediaStream) {
    return this.serial(() => this.publishInternal(stream));
  }
  private async publishInternal(stream: MediaStream, presentation = false) {
    if (!presentation && this.local && this.local !== stream) {
      stream.getTracks().forEach((t) => this.local!.addTrack(t));
    } else if (!presentation) this.local = stream;
    if (!stream.getTracks().length) return;
    const ice = await this.request(`/meetings/${this.meeting}/ice`, {});
    const pc = new RTCPeerConnection({
      iceServers: classroomIceServers(ice.iceServers),
    });
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
        trackName:
          (presentation ? "screen-" : "") + t.kind + "-" + crypto.randomUUID(),
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
    const visibleStreams = new Set(
      list.filter((p) => p.user_id !== self).map(publicationKey),
    );
    this.remoteStreams.forEach((stream, key) => {
      if (!visibleStreams.has(key)) {
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
      const ice = await this.request(`/meetings/${this.meeting}/ice`, {});
      this.receiver = new RTCPeerConnection({
        iceServers: classroomIceServers(ice.iceServers),
      });
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
    if (!Array.isArray(result.tracks) || result.tracks.length !== batch.length)
      throw new Error("SFU trả thiếu các luồng nhận");
    result.tracks?.forEach((t: any, i: number) => {
      if (!t.errorCode && batch[i]) {
        const p = batch[i],
          key = p.session_id + ":" + p.track_name;
        this.labels.set(t.mid, {
          key: publicationKey(p),
          name:
            p.name + (p.track_name.startsWith("screen-") ? " · Màn hình" : ""),
        });
        this.known.add(key);
        this.knownOwners.set(key, p.user_id);
      }
    });
    if (result.sessionDescription) {
      await pc.setRemoteDescription(result.sessionDescription);
      await pc.setLocalDescription(await pc.createAnswer());
      await gather(pc);
      const accepted = await this.call({
        op: "renegotiate",
        session_id: this.receiverID,
        sessionDescription: pc.localDescription,
      });
      if (accepted.errorCode)
        throw new Error("SFU chưa chấp nhận kết nối nhận");
    }
    if (result.tracks?.some((t: any) => t.errorCode))
      throw new Error("Một luồng nhận bị lỗi; đang chuẩn bị kết nối lại");
    if (fresh.length > batch.length) await this.subscribeInternal(list, self);
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
  stopShare() {
    return this.serial(() => this.stopShareInternal());
  }
  private async stopShareInternal() {
    const screen = this.screen,
      pc = this.screenPeer;
    this.screen = undefined;
    this.screenPeer = undefined;
    screen?.getTracks().forEach((t) => t.stop());
    if (pc) {
      pc.close();
      this.peers = this.peers.filter((p) => p !== pc);
      this.peerCreated.delete(pc);
      const sid = this.sessionIDs.get(pc);
      this.sessionIDs.delete(pc);
      if (sid)
        await this.request(`/meetings/${this.meeting}/media/reset`, {
          session_id: sid,
        });
    }
  }
  private async shareInternal() {
    if (this.screen) {
      await this.stopShareInternal();
      return undefined;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error(
        "Trình duyệt này chưa hỗ trợ chia sẻ màn hình. Hãy dùng Chrome, Edge hoặc Safari trên máy tính. Bạn vẫn có thể xem màn hình người khác chia sẻ.",
      );
    }
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
    const track = display.getVideoTracks()[0];
    try {
      await this.publishInternal(display, true);
      this.screen = display;
      this.screenPeer = this.peers[this.peers.length - 1];
    } catch (e) {
      display.getTracks().forEach((t) => t.stop());
      throw e;
    }
    track.onended = () => {
      if (this.screen === display) void this.stopShare().catch(() => {});
    };
    return display;
  }
  changeDevice(kind: "audio" | "video", deviceID: string) {
    return this.serial(async () => {
      const selected = deviceID ? { deviceId: { exact: deviceID } } : true;
      const stream = await navigator.mediaDevices.getUserMedia(
        kind === "audio"
          ? { audio: selected, video: false }
          : { video: selected, audio: false },
      );
      const next = stream.getTracks()[0],
        old = this.local?.getTracks().find((t) => t.kind === kind);
      next.enabled = old?.enabled ?? false;
      const sender = this.peers
        .flatMap((p) => p.getSenders())
        .find((s) => s.track === old && !!old);
      try {
        if (sender && this.local) {
          await sender.replaceTrack(next);
          this.local.removeTrack(old!);
          this.local.addTrack(next);
          old?.stop();
        } else await this.publishInternal(stream);
      } catch (e) {
        stream.getTracks().forEach((t) => t.stop());
        throw e;
      }
      return this.local;
    });
  }
  setEnabled(kind: "audio" | "video", enabled: boolean) {
    return this.serial(() => this.setEnabledInternal(kind, enabled));
  }
  async audioLevels(): Promise<Record<string, number>> {
    const levels: Record<string, number> = {};
    if (this.receiver?.getStats) {
      const report = await this.receiver.getStats();
      report.forEach((stat) => {
        if (
          stat.type !== "inbound-rtp" ||
          (stat.kind || stat.mediaType) !== "audio"
        )
          return;
        let key = this.labels.get(stat.mid)?.key;
        if (!key && stat.trackIdentifier)
          this.remoteStreams.forEach((stream, id) => {
            if (
              stream.getAudioTracks().some((t) => t.id === stat.trackIdentifier)
            )
              key = id;
          });
        if (key && !key.endsWith(":screen"))
          levels[key] = Number(stat.audioLevel) || 0;
      });
    }
    if (
      this.local
        ?.getAudioTracks()
        .some((t) => t.enabled && t.readyState !== "ended")
    ) {
      for (const pc of this.peers) {
        if (!pc.getStats) continue;
        const report = await pc.getStats();
        report.forEach((stat) => {
          if (
            stat.type === "media-source" &&
            stat.kind === "audio" &&
            this.local
              ?.getAudioTracks()
              .some((t) => t.id === stat.trackIdentifier)
          )
            levels.self = Number(stat.audioLevel) || 0;
        });
      }
    }
    return levels;
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
        await this.request(`/meetings/${this.meeting}/media/reset`, {});
        this.peers.forEach((p) => p.close());
        this.peers = [];
        this.peerCreated.clear();
        this.sessionIDs.clear();
        this.screenPeer = undefined;
        this.screen?.getTracks().forEach((t) => {
          t.stop();
          this.local?.removeTrack(t);
        });
        this.screen = undefined;
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
