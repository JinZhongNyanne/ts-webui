/**
 * Browser-to-browser video / screen share for one TeamSpeak channel.
 *
 * Every web user who joined the channel's video room keeps one RTCPeerConnection
 * per other member (full mesh). Signalling (SDP, ICE, stream metadata) is relayed
 * by the hub as `rtc.signal`; the member list comes from `room.state`.
 *
 * Negotiation follows the W3C "perfect negotiation" pattern so that both sides can
 * add tracks at any time without glare: the peer with the higher client id is the
 * polite one and rolls back on collisions.
 *
 * Media flows directly between browsers (or via a TURN relay when configured), so a
 * publisher uploads one copy per viewer. That is fine for a handful of people; for
 * large rooms configure LiveKit instead and the hub switches backends automatically.
 */
import type { ClientMessage, IceServerInfo, RoomVideoMember } from "@jinz/protocol";
import {
  DEFAULT_SCREEN_OPTIONS,
  displayMediaConstraints,
  mediaTrackAttachers,
  screenBitrate,
  type PeerPath,
  type PeerStatus,
  type LocalMedia,
  type RtcRoom,
  type RtcRoomEvents,
  type ScreenShareOptions,
  type TrackSource,
  type TrackView,
} from "./types";
import { t } from "../i18n";

type SignalPayload =
  | { kind: "sdp"; description: RTCSessionDescriptionInit }
  | { kind: "ice"; candidate: RTCIceCandidateInit }
  | { kind: "meta"; name: string; camera: string | null; screen: string | null };

interface Peer {
  clientId: number;
  nickname: string;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  settingRemoteAnswer: boolean;
  /** Serialises signal handling so ICE candidates never overtake the SDP they belong to. */
  queue: Promise<void>;
  /** Remote streams by MediaStream id (msid). */
  streams: Map<string, MediaStream>;
  /** Which remote stream is which, from the peer's meta message. */
  remote: { camera: string | null; screen: string | null };
  /** Our transceivers towards this peer, by local track id. */
  senders: Map<string, RTCRtpTransceiver>;
  path: PeerPath;
}

export interface MeshRoomOptions extends RtcRoomEvents {
  selfClientId: number;
  selfName: string;
  iceServers: IceServerInfo[];
  send(msg: ClientMessage): void;
}

/** Subset of RTCIceCandidateStats we read (not in every TS dom lib). */
interface CandidateStats {
  candidateType?: string;
}

const CAMERA_ENCODING: RTCRtpEncodingParameters = { maxBitrate: 1_500_000, maxFramerate: 30 };

export class MeshRoom implements RtcRoom {
  readonly kind = "mesh" as const;
  private readonly byId = new Map<number, Peer>();
  /** Signals that arrived before room.state introduced the sender. */
  private readonly early = new Map<number, SignalPayload[]>();
  private camera: MediaStream | null = null;
  private screen: MediaStream | null = null;
  private screenOpts: ScreenShareOptions | null = null;
  private closed = false;

  constructor(private readonly o: MeshRoomOptions) {}

  /* ------------------------------------------------------------------ state */

  get cameraOn(): boolean {
    return this.camera !== null;
  }

  get screenOn(): boolean {
    return this.screen !== null;
  }

  get participantCount(): number {
    return this.byId.size + 1;
  }

  get peers(): PeerStatus[] {
    return [...this.byId.values()].map((p) => ({
      clientId: p.clientId,
      nickname: p.nickname,
      state: p.pc.connectionState,
      path: p.path,
    }));
  }

  get tracks(): TrackView[] {
    const out: TrackView[] = [];
    const push = (
      track: MediaStreamTrack,
      source: TrackSource,
      clientId: number,
      name: string,
      isLocal: boolean,
    ) => {
      if (track.readyState === "ended") return;
      out.push({
        sid: `${clientId}:${track.id}`,
        kind: track.kind === "video" ? "video" : "audio",
        source,
        clientId,
        participantName: name,
        isLocal,
        ...mediaTrackAttachers(track),
      });
    };
    const me = this.o.selfClientId;
    for (const track of this.camera?.getVideoTracks() ?? [])
      push(track, "camera", me, t("info.me"), true);
    for (const track of this.screen?.getTracks() ?? []) {
      push(track, track.kind === "video" ? "screen" : "screen_audio", me, t("info.me"), true);
    }
    for (const p of this.byId.values()) {
      for (const stream of p.streams.values()) {
        const base: TrackSource =
          stream.id === p.remote.camera
            ? "camera"
            : stream.id === p.remote.screen
              ? "screen"
              : "unknown";
        for (const t of stream.getTracks()) {
          const source: TrackSource =
            t.kind === "audio" ? (base === "screen" ? "screen_audio" : "mic") : base;
          push(t, source, p.clientId, p.nickname, false);
        }
      }
    }
    return out;
  }

  /* ---------------------------------------------------------------- members */

  /** Reconciles peers with the hub's member list (self is ignored). */
  setMembers(members: RoomVideoMember[]): void {
    if (this.closed) return;
    const wanted = new Set<number>();
    for (const m of members) {
      if (m.clientId === this.o.selfClientId) continue;
      wanted.add(m.clientId);
      const existing = this.byId.get(m.clientId);
      if (existing) existing.nickname = m.nickname;
      else this.addPeer(m);
    }
    for (const [id, p] of this.byId) if (!wanted.has(id)) this.removePeer(p);
    this.o.onChange();
  }

  private addPeer(m: RoomVideoMember): void {
    const pc = new RTCPeerConnection({
      iceServers: this.o.iceServers as RTCIceServer[],
      bundlePolicy: "max-bundle",
    });
    const peer: Peer = {
      clientId: m.clientId,
      nickname: m.nickname,
      pc,
      // Exactly one side is polite; both compute it from the same numbers.
      polite: this.o.selfClientId > m.clientId,
      makingOffer: false,
      ignoreOffer: false,
      settingRemoteAnswer: false,
      queue: Promise.resolve(),
      streams: new Map(),
      remote: { camera: null, screen: null },
      senders: new Map(),
      path: "unknown",
    };
    pc.onnegotiationneeded = () => void this.negotiate(peer);
    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.signal(peer, { kind: "ice", candidate: ev.candidate.toJSON() });
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") pc.restartIce();
      this.o.onChange();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") void this.probePath(peer);
      this.o.onChange();
    };
    pc.ontrack = (ev) => {
      const stream = ev.streams[0];
      if (!stream) return;
      if (!peer.streams.has(stream.id)) {
        peer.streams.set(stream.id, stream);
        stream.addEventListener("removetrack", () => {
          if (stream.getTracks().length === 0) peer.streams.delete(stream.id);
          this.o.onChange();
        });
      }
      for (const type of ["ended", "mute", "unmute"] as const) {
        ev.track.addEventListener(type, () => this.o.onChange());
      }
      this.o.onChange();
    };
    this.byId.set(peer.clientId, peer);

    // Introduce ourselves, then push whatever we already publish (kicks off negotiation).
    this.sendMeta(peer);
    if (this.camera) this.attachStream(peer, this.camera, "camera");
    if (this.screen) this.attachStream(peer, this.screen, "screen");

    const queued = this.early.get(peer.clientId);
    if (queued) {
      this.early.delete(peer.clientId);
      for (const payload of queued) this.enqueue(peer, payload);
    }
  }

  private removePeer(peer: Peer): void {
    this.byId.delete(peer.clientId);
    peer.pc.onnegotiationneeded = null;
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.close();
    peer.streams.clear();
  }

  /* ------------------------------------------------------------- signalling */

  private signal(peer: Peer, payload: SignalPayload): void {
    if (this.closed) return;
    this.o.send({ type: "rtc.signal", to: peer.clientId, payload });
  }

  private sendMeta(peer?: Peer): void {
    const payload: SignalPayload = {
      kind: "meta",
      name: this.o.selfName,
      camera: this.camera?.id ?? null,
      screen: this.screen?.id ?? null,
    };
    for (const p of peer ? [peer] : this.byId.values()) this.signal(p, payload);
  }

  handleSignal(from: number, raw: Record<string, unknown>): void {
    if (this.closed) return;
    const payload = raw as unknown as SignalPayload;
    const peer = this.byId.get(from);
    if (!peer) {
      const list = this.early.get(from) ?? [];
      list.push(payload);
      this.early.set(from, list.slice(-64));
      return;
    }
    this.enqueue(peer, payload);
  }

  private enqueue(peer: Peer, payload: SignalPayload): void {
    peer.queue = peer.queue
      .then(() => this.apply(peer, payload))
      .catch((err: unknown) => {
        this.o.onError(
          t("video.errNegotiate", {
            name: peer.nickname,
            reason: err instanceof Error ? err.message : String(err),
          }),
        );
      });
  }

  private async negotiate(peer: Peer): Promise<void> {
    try {
      peer.makingOffer = true;
      await peer.pc.setLocalDescription();
      this.signal(peer, { kind: "sdp", description: peer.pc.localDescription!.toJSON() });
    } catch (err) {
      this.o.onError(
        t("video.errConnectPeer", {
          name: peer.nickname,
          reason: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      peer.makingOffer = false;
    }
  }

  private async apply(peer: Peer, payload: SignalPayload): Promise<void> {
    const pc = peer.pc;
    if (pc.signalingState === "closed") return;
    switch (payload.kind) {
      case "meta":
        peer.remote = { camera: payload.camera ?? null, screen: payload.screen ?? null };
        if (payload.name) peer.nickname = payload.name;
        this.o.onChange();
        return;
      case "sdp": {
        const description = payload.description;
        const readyForOffer =
          !peer.makingOffer && (pc.signalingState === "stable" || peer.settingRemoteAnswer);
        const collision = description.type === "offer" && !readyForOffer;
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        peer.settingRemoteAnswer = description.type === "answer";
        try {
          await pc.setRemoteDescription(description); // implicit rollback when polite
        } finally {
          peer.settingRemoteAnswer = false;
        }
        if (description.type === "offer") {
          await pc.setLocalDescription();
          this.signal(peer, { kind: "sdp", description: pc.localDescription!.toJSON() });
        }
        return;
      }
      case "ice":
        try {
          await pc.addIceCandidate(payload.candidate);
        } catch (err) {
          if (!peer.ignoreOffer) throw err;
        }
        return;
    }
  }

  private async probePath(peer: Peer): Promise<void> {
    try {
      const stats = await peer.pc.getStats();
      let pair: RTCIceCandidatePairStats | undefined;
      stats.forEach((s) => {
        if (s.type === "transport" && (s as RTCTransportStats).selectedCandidatePairId) {
          pair = stats.get((s as RTCTransportStats).selectedCandidatePairId!) as
            RTCIceCandidatePairStats | undefined;
        }
      });
      if (!pair) {
        stats.forEach((s) => {
          if (s.type === "candidate-pair" && (s as RTCIceCandidatePairStats).nominated) {
            pair = s as RTCIceCandidatePairStats;
          }
        });
      }
      if (!pair) return;
      const local = stats.get(pair.localCandidateId) as CandidateStats | undefined;
      const remote = stats.get(pair.remoteCandidateId) as CandidateStats | undefined;
      const types = [local?.candidateType, remote?.candidateType];
      peer.path = types.includes("relay")
        ? "relay"
        : types.includes("srflx")
          ? "srflx"
          : types.includes("prflx")
            ? "prflx"
            : local?.candidateType === "host"
              ? "host"
              : "unknown";
      this.o.onChange();
    } catch {
      /* stats are best effort */
    }
  }

  /* ------------------------------------------------------------- publishing */

  private attachStream(peer: Peer, stream: MediaStream, source: "camera" | "screen"): void {
    for (const track of stream.getTracks()) {
      const init: RTCRtpTransceiverInit = { direction: "sendonly", streams: [stream] };
      if (track.kind === "video") {
        init.sendEncodings = [
          source === "camera"
            ? { ...CAMERA_ENCODING }
            : {
                maxBitrate: screenBitrate(this.screenOpts ?? DEFAULT_SCREEN_OPTIONS),
                maxFramerate: (this.screenOpts ?? DEFAULT_SCREEN_OPTIONS).fps,
              },
        ];
      }
      const tr = peer.pc.addTransceiver(track, init);
      peer.senders.set(track.id, tr);
      if (track.kind === "video") void this.tuneSender(tr.sender, source);
    }
  }

  /** Keep text sharp (resolution) or motion smooth (frame rate) when bandwidth is short. */
  private async tuneSender(sender: RTCRtpSender, source: "camera" | "screen"): Promise<void> {
    try {
      const params = sender.getParameters();
      if (!params.encodings?.length) return;
      const hint = source === "screen" ? this.screenOpts?.contentHint : "motion";
      params.degradationPreference =
        hint === "detail" ? "maintain-resolution" : "maintain-framerate";
      await sender.setParameters(params);
    } catch {
      /* not all browsers accept degradationPreference */
    }
  }

  private detachStream(peer: Peer, stream: MediaStream): void {
    for (const track of stream.getTracks()) {
      const tr = peer.senders.get(track.id);
      if (!tr) continue;
      peer.senders.delete(track.id);
      try {
        tr.stop(); // renegotiates; the remote track ends
      } catch {
        peer.pc.removeTrack(tr.sender);
      }
    }
  }

  async setCamera(on: boolean): Promise<void> {
    if (this.closed || on === this.cameraOn) return;
    if (on) {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        audio: false,
      });
      this.camera = stream;
      stream.getVideoTracks()[0]?.addEventListener("ended", () => void this.setCamera(false));
      this.sendMeta();
      for (const p of this.byId.values()) this.attachStream(p, stream, "camera");
    } else {
      const s = this.camera;
      this.camera = null;
      if (s) this.dropLocal(s);
      this.sendMeta();
    }
    this.o.onChange();
  }

  async setScreen(on: boolean, opts: ScreenShareOptions, stream?: MediaStream): Promise<void> {
    if (this.closed) return;
    if (!on) {
      const s = this.screen;
      this.screen = null;
      this.screenOpts = null;
      if (s) this.dropLocal(s);
      this.sendMeta();
      this.o.onChange();
      return;
    }
    if (this.screen) await this.setScreen(false, opts);
    const s =
      stream ?? (await navigator.mediaDevices.getDisplayMedia(displayMediaConstraints(opts)));
    const video = s.getVideoTracks()[0];
    if (video) {
      try {
        video.contentHint = opts.contentHint;
      } catch {
        /* optional */
      }
      video.addEventListener("ended", () => {
        if (this.screen === s) {
          void this.setScreen(false, opts);
          this.o.onScreenEnded();
        }
      });
    }
    this.screen = s;
    this.screenOpts = opts;
    this.sendMeta();
    for (const p of this.byId.values()) this.attachStream(p, s, "screen");
    this.o.onChange();
  }

  detachLocalMedia(): LocalMedia {
    const camera = this.camera;
    const screen = this.screen;
    this.camera = null;
    this.screen = null;
    this.screenOpts = null;
    // Detach from the peers without stopping the tracks; `dropLocal` would.
    for (const s of [camera, screen]) {
      if (!s) continue;
      for (const p of this.byId.values()) this.detachStream(p, s);
    }
    if (camera || screen) {
      this.sendMeta();
      this.o.onChange();
    }
    return { camera, screen };
  }

  private dropLocal(stream: MediaStream): void {
    for (const p of this.byId.values()) this.detachStream(p, stream);
    for (const t of stream.getTracks()) t.stop();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const s of [this.camera, this.screen]) s?.getTracks().forEach((t) => t.stop());
    this.camera = null;
    this.screen = null;
    for (const p of [...this.byId.values()]) this.removePeer(p);
    this.early.clear();
  }
}
