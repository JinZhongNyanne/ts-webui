/**
 * WebSocket link to the hub. JSON text frames carry protocol messages,
 * binary frames carry voice.
 *
 * The link is meant to stay up for the life of the tab: once `open()` has been
 * called, a socket that drops is dialled again with exponential backoff until
 * `close()` says otherwise. Re-establishing the *TeamSpeak* session on top of a
 * fresh link is the store's job (it holds the connect request).
 */
import {
  decodeVoiceFrame,
  encodeVoiceFrame,
  isDownstreamKind,
  VoiceFrameKind,
  type ClientMessage,
  type ServerMessage,
  type VoiceFrame,
} from "@jinz/protocol";
import { t } from "../i18n";

export type HubState = "closed" | "connecting" | "open";

/** The hub closes a socket with this code when the hub password is missing. */
export const WS_CLOSE_UNAUTHORIZED = 4401;
/** The `reason` passed to state listeners for that close. */
export const HUB_UNAUTHORIZED = "unauthorized";

type MessageListener = (msg: ServerMessage) => void;
type VoiceListener = (frame: VoiceFrame) => void;
type StateListener = (state: HubState, reason?: string) => void;
type LatencyListener = (ms: number) => void;

export function defaultHubUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws`;
}

/** Keepalive: also what the round-trip shown in the status bar is measured on. */
const PING_MS = 15_000;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

export class HubConnection {
  private ws: WebSocket | null = null;
  private upSeq = 0;
  private readonly messageListeners = new Set<MessageListener>();
  private readonly voiceListeners = new Set<VoiceListener>();
  private readonly stateListeners = new Set<StateListener>();
  private readonly latencyListeners = new Set<LatencyListener>();
  /** Set by open(), cleared by close(): whether the link should be dialled. */
  private wanted = false;
  private url = "";
  private opening: Promise<void> | null = null;
  private pingTimer: number | null = null;
  private retryTimer: number | null = null;
  private attempt = 0;
  state: HubState = "closed";
  latencyMs: number | null = null;

  open(url = defaultHubUrl()): Promise<void> {
    this.url = url;
    this.wanted = true;
    if (this.state === "open") return Promise.resolve();
    // A second caller during the handshake must wait for it, not resolve early.
    if (this.opening) return this.opening;
    this.opening = this.dial();
    return this.opening;
  }

  close(): void {
    this.wanted = false;
    this.clearTimers();
    this.attempt = 0;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    if (this.state !== "closed") this.setState("closed");
  }

  private dial(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      this.setState("connecting");
      ws.onopen = () => {
        this.opening = null;
        this.attempt = 0;
        this.setState("open");
        this.startPings();
        resolve();
      };
      ws.onerror = () => {
        if (this.state === "connecting") reject(new Error(t("event.gatewayUnreachable")));
      };
      ws.onclose = (ev) => {
        // A socket replaced by a later dial must not tear down its successor.
        if (this.ws !== ws) return;
        this.ws = null;
        this.opening = null;
        this.latencyMs = null;
        this.stopPings();
        if (ev.code === WS_CLOSE_UNAUTHORIZED) {
          // Redialling cannot help until someone types the password again.
          this.wanted = false;
          this.setState("closed", HUB_UNAUTHORIZED);
          return;
        }
        this.setState("closed", ev.reason || `code ${ev.code}`);
        if (this.wanted) this.scheduleRetry();
      };
      ws.onmessage = (ev) => this.onFrame(ev);
    });
  }

  private onFrame(ev: MessageEvent): void {
    if (typeof ev.data === "string") {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === "pong") {
        this.latencyMs = Math.max(0, Date.now() - msg.t);
        for (const l of this.latencyListeners) l(this.latencyMs);
        return;
      }
      for (const l of this.messageListeners) l(msg);
    } else if (ev.data instanceof ArrayBuffer) {
      const frame = decodeVoiceFrame(new Uint8Array(ev.data));
      // Said in the channel or whispered to us; the listener tells them apart.
      if (frame && isDownstreamKind(frame.kind)) {
        for (const l of this.voiceListeners) l(frame);
      }
    }
  }

  /**
   * Exponential backoff with full jitter, so a hub restart does not bring every
   * browser back in the same instant.
   */
  private scheduleRetry(): void {
    if (this.retryTimer !== null) return;
    const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** this.attempt);
    const wait = BACKOFF_MIN_MS + Math.random() * (ceiling - BACKOFF_MIN_MS);
    this.attempt++;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      if (!this.wanted || this.ws) return;
      this.opening = this.dial();
      // Nobody is awaiting this one; a rejected dial just schedules the next.
      this.opening.catch(() => undefined);
    }, wait);
  }

  private startPings(): void {
    this.stopPings();
    this.pingTimer = window.setInterval(() => {
      this.send({ type: "ping", t: Date.now() });
    }, PING_MS);
    this.send({ type: "ping", t: Date.now() });
  }

  private stopPings(): void {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private clearTimers(): void {
    this.stopPings();
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  send(msg: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  /** `kind`: `Up` for the channel, `UpWhisper` for the targets of the last `whisper.set`. */
  sendVoice(codec: number, payload: Uint8Array, kind: VoiceFrameKind = VoiceFrameKind.Up): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.upSeq = (this.upSeq + 1) & 0xffff;
    this.ws.send(encodeVoiceFrame({ kind, clientId: 0, codec, seq: this.upSeq, payload }));
  }

  onMessage(fn: MessageListener): () => void {
    this.messageListeners.add(fn);
    return () => this.messageListeners.delete(fn);
  }

  onVoice(fn: VoiceListener): () => void {
    this.voiceListeners.add(fn);
    return () => this.voiceListeners.delete(fn);
  }

  onState(fn: StateListener): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  onLatency(fn: LatencyListener): () => void {
    this.latencyListeners.add(fn);
    return () => this.latencyListeners.delete(fn);
  }

  private setState(state: HubState, reason?: string): void {
    this.state = state;
    for (const l of this.stateListeners) l(state, reason);
  }
}
