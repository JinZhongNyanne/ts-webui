/**
 * One browser WebSocket connection.
 *
 * Text frames carry JSON `ClientMessage`s; binary frames carry voice.
 * Each session owns at most one TeamSpeak connection (TsSession).
 */
import { randomUUID } from "node:crypto";
import type { WebSocket, RawData } from "ws";
import {
  ClientMessageSchema,
  decodeVoiceFrame,
  encodeVoiceFrame,
  isOpusCodec,
  TS_CMD_HUB_CODES,
  VoiceFrameKind,
  type ClientMessage,
  type ServerMessage,
} from "@jinz/protocol";
import type { Config } from "../config.js";
import type { Logger } from "../logger.js";
import { publicIceServers, resolveConnectTarget } from "../config.js";
import { RateLimiter } from "../security/limits.js";
import { TsSession } from "../gateway/TsSession.js";
import { hubTsFailure, runTsCmd, tsCmdIdOf } from "../gateway/commands.js";
import type { SessionRegistry } from "./registry.js";
import { ASSET_TOKEN_ROTATE_MS } from "./asset-token.js";
import type { BridgePool, PooledBridge } from "../musicbot/BridgePool.js";
import { MUSIC_UNREACHABLE, assertMusicBotTarget, resolveMusicBotUrl } from "../musicbot/target.js";
import { fixedServerRoomName, roomNameFor, type LiveKitService } from "../rtc/livekit.js";
import { serverKeyOf, type RoomRegistry } from "../rooms/RoomRegistry.js";

export interface SessionContext {
  config: Config;
  logger: Logger;
  registry: SessionRegistry;
  music?: BridgePool;
  rtc?: LiveKitService;
  rooms?: RoomRegistry;
}

/** The music bot this session attached to, with what it owes the pool. */
interface MusicAttachment {
  readonly url: string;
  readonly bridge: PooledBridge;
  readonly unsubscribe: () => void;
}

/**
 * A laptop that sleeps or a tab that is force-closed leaves a socket the OS
 * never tells us about. Without a heartbeat that session's TeamSpeak client
 * lives on forever, filling the channel with ghosts and burning the server's
 * per-identity clone limit.
 */
const HEARTBEAT_MS = 20_000;

/** Drop voice for a socket already this far behind (bytes). */
const VOICE_BACKLOG_LIMIT = 1024 * 1024;

export class Session {
  readonly id = randomUUID();
  private ts: TsSession | null = null;
  private musicLink: MusicAttachment | null = null;
  private downSeq = 0;
  private closed = false;
  private readonly log: Logger;
  private isAlive = true;
  private readonly heartbeat: NodeJS.Timeout;
  /** Hands the browser a fresh asset token well before the current one expires. */
  private readonly tokenRotation: NodeJS.Timeout;
  /** Commands (not voice) this socket may issue, and connects it may attempt. */
  private readonly commands: RateLimiter;
  private readonly connects: RateLimiter;
  /** Allow-listed TeamSpeak commands (`ts.cmd`), each a round trip on the TS server. */
  private readonly tsCmds: RateLimiter;

  constructor(
    private readonly ws: WebSocket,
    private readonly ctx: SessionContext,
  ) {
    this.log = ctx.logger.child({ session: this.id.slice(0, 8) });
    this.commands = new RateLimiter({
      limit: ctx.config.HUB_COMMAND_RATE_PER_MIN,
      windowMs: 60_000,
      maxKeys: 1,
    });
    this.connects = new RateLimiter({
      limit: ctx.config.HUB_CONNECT_RATE_PER_MIN,
      windowMs: 60_000,
      maxKeys: 1,
    });
    this.tsCmds = new RateLimiter({
      limit: ctx.config.HUB_TS_CMD_RATE_PER_MIN,
      windowMs: 60_000,
      maxKeys: 1,
    });
    ws.on("pong", () => {
      this.isAlive = true;
    });
    this.heartbeat = setInterval(() => {
      if (!this.isAlive) {
        this.log.info("no pong within the heartbeat window; terminating");
        this.dispose("heartbeat timeout");
        ws.terminate();
        return;
      }
      this.isAlive = false;
      try {
        ws.ping();
      } catch (err) {
        this.log.warn({ err }, "ping failed");
      }
    }, HEARTBEAT_MS);
    this.tokenRotation = setInterval(() => this.sendAssetToken(), ASSET_TOKEN_ROTATE_MS);
    ws.on("message", (data, isBinary) => this.onMessage(data, isBinary));
    ws.on("close", () => this.dispose("socket closed"));
    ws.on("error", (err) => {
      this.log.warn({ err }, "websocket error");
      this.dispose("socket error");
    });
    ctx.registry.add(this);
    this.send({
      type: "hello",
      sessionId: this.id,
      assetToken: ctx.registry.mintAssetToken(this.id),
      build: ctx.config.BUILD_ID,
      features: {
        video: ctx.config.videoEnabled,
        // Every session can bring its own bot, so the panel is always offered.
        music: true,
        rtc: ctx.config.rtcBackend,
        // TURN credentials are handed out per channel join, not to every socket.
        iceServers: publicIceServers(ctx.config.iceServers),
        files: {
          maxUploadBytes: ctx.config.HUB_FT_MAX_UPLOAD_BYTES,
          maxTransfers: ctx.config.HUB_FT_MAX_TRANSFERS_PER_SESSION,
          // Chat video streams through a range-capable media link (files/media-routes.ts).
          mediaStreaming: true,
        },
      },
    });
  }

  get tsSession(): TsSession | null {
    return this.ts;
  }

  /** The music bot this session attached to on connect; null until then. */
  get music(): PooledBridge | null {
    return this.musicLink?.bridge ?? null;
  }

  /**
   * `send` is called from fan-out loops over every session, so a socket that
   * fails mid-write must not abort the broadcast for everyone after it.
   */
  send(msg: ServerMessage): void {
    if (this.closed || this.ws.readyState !== this.ws.OPEN) return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch (err) {
      this.log.warn({ err, type: msg.type }, "send failed");
    }
  }

  /** Mints and delivers a new asset token; earlier ones stay valid until they expire. */
  private sendAssetToken(): void {
    if (this.closed) return;
    this.send({ type: "assetToken", ...this.ctx.registry.mintAssetToken(this.id) });
  }

  private sendVoiceDown(clientId: number, codec: number, data: Uint8Array, whisper: boolean): void {
    if (this.closed || this.ws.readyState !== this.ws.OPEN) return;
    // A backed-up socket (a stalled or sleeping client) would otherwise grow
    // the send buffer without bound. Late voice is worthless anyway, so drop it
    // rather than buffer it; the heartbeat culls the session if it stays stuck.
    if (this.ws.bufferedAmount > VOICE_BACKLOG_LIMIT) return;
    this.downSeq = (this.downSeq + 1) & 0xffff;
    try {
      this.ws.send(
        encodeVoiceFrame({
          kind: whisper ? VoiceFrameKind.DownWhisper : VoiceFrameKind.Down,
          clientId,
          codec,
          seq: this.downSeq,
          payload: data,
        }),
        { binary: true },
      );
    } catch (err) {
      this.log.warn({ err }, "voice send failed");
    }
  }

  private onMessage(data: RawData, isBinary: boolean): void {
    // Any traffic at all proves the peer is there, so a busy session is never
    // culled just because one pong went missing.
    this.isAlive = true;
    if (isBinary) {
      this.onVoiceUp(toUint8(data));
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      this.send({ type: "error", code: "bad_json", message: "message is not valid JSON" });
      return;
    }
    // Voice has its own backpressure; this is the ceiling on everything else,
    // so one socket cannot drive the TeamSpeak command queue for everybody.
    // A `ts.cmd` is always answered by its own result, so the page's promise
    // fails right away instead of waiting out its timeout.
    const cmdId = tsCmdIdOf(parsed);
    if (!this.commands.take(this.id)) {
      if (cmdId) {
        this.send(hubTsFailure(cmdId, TS_CMD_HUB_CODES.rateLimited, "hub.rateLimited"));
        return;
      }
      this.send({ type: "error", code: "rate_limited", message: "hub.rateLimited" });
      return;
    }
    const result = ClientMessageSchema.safeParse(parsed);
    if (!result.success) {
      if (cmdId) {
        this.send(hubTsFailure(cmdId, TS_CMD_HUB_CODES.badArgs, "tsErr.badArgs"));
        return;
      }
      this.send({
        type: "error",
        code: "bad_message",
        message: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      });
      return;
    }
    void this.handle(result.data).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn({ err, type: result.data.type }, "command failed");
      this.send({ type: "error", code: "command_failed", message });
    });
  }

  private onVoiceUp(buf: Uint8Array): void {
    const frame = decodeVoiceFrame(buf);
    if (!frame) return;
    // We only ever encode Opus; anything else would be noise in the channel.
    if (!isOpusCodec(frame.codec)) return;
    if (frame.kind === VoiceFrameKind.Up) this.ts?.sendVoice(frame.payload, frame.codec);
    else if (frame.kind === VoiceFrameKind.UpWhisper) {
      this.ts?.sendWhisper(frame.payload, frame.codec);
    }
  }

  private async handle(msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case "ping":
        this.send({ type: "pong", t: msg.t });
        return;
      case "assetToken.refresh":
        this.sendAssetToken();
        return;
      case "connect":
        await this.connect(msg);
        return;
      case "disconnect":
        await this.disconnectTs("hub.byeUser", true);
        return;
      // Room bookkeeping is keyed by the session, not by the TeamSpeak link,
      // and `rooms.leave()` already runs when a session ends. The browser
      // sends these while tearing its room down, which races the disconnect,
      // so answering `not_connected` only put a red line in the user's log on
      // every reconnect. Accept them whether or not a session is up.
      case "rtc.leave":
        this.ctx.rooms?.setVideo(this.id, false);
        return;
      case "rtc.publishing":
        this.ctx.rooms?.setPublishing(this.id, msg.camera, msg.screen);
        return;
      case "ts.cmd":
        await this.runTsCmd(msg);
        return;
    }

    const ts = this.ts;
    if (!ts) {
      this.send({ type: "error", code: "not_connected", message: "not connected to a server" });
      return;
    }

    switch (msg.type) {
      case "moveTo":
        await ts.moveTo(msg.channelId, msg.password);
        return;
      case "sendText":
        await ts.sendText(msg.targetMode, msg.targetId, msg.message);
        return;
      case "poke":
        await ts.poke(msg.clientId, msg.message);
        return;
      case "setInputMuted":
        await ts.setInputMuted(msg.muted);
        return;
      case "setOutputMuted":
        await ts.setOutputMuted(msg.muted);
        return;
      case "whisper.set": {
        const kept = ts.setWhisperTarget(msg.target);
        this.send({ type: "whisper.target", ...kept });
        return;
      }
      case "setAway":
        await ts.setAway(msg.away, msg.message);
        return;
      case "setNickname":
        await ts.setNickname(msg.nickname);
        return;
      case "getChannelDescription":
        await ts.requestChannelDescription(msg.channelId);
        return;
      case "getClientInfo": {
        const raw = await ts.fetchClientInfo(msg.clientId);
        this.send({ type: "client.info", clientId: msg.clientId, raw });
        return;
      }
      case "rtc.join": {
        const channelId = ts.selfChannelId;
        const backend = this.ctx.config.rtcBackend;
        if (backend === "none" || !channelId) {
          this.send({ type: "error", code: "rtc_unavailable", message: "hub.rtcDisabled" });
          return;
        }
        const { host, port } = ts.endpoint;
        // The name reaches the page, and a fixed server's address stays on the hub.
        const room = this.ctx.config.fixedServer
          ? fixedServerRoomName(channelId)
          : roomNameFor(host, port, channelId);
        if (backend === "livekit" && this.ctx.rtc) {
          const token = await this.ctx.rtc.mintToken(room, {
            clientId: ts.selfClientId,
            nickname: ts.selfNickname,
            uid: ts.selfUid,
          });
          this.ctx.rooms?.setVideo(this.id, true);
          this.send({ type: "rtc.token", url: this.ctx.rtc.publicUrl, token, room });
          return;
        }
        // Mesh: the browser learns its peers from room.state and signals via rtc.signal.
        this.send({
          type: "rtc.mesh",
          room,
          selfClientId: ts.selfClientId,
          iceServers: this.ctx.config.iceServers,
        });
        this.ctx.rooms?.setVideo(this.id, true);
        return;
      }
      case "rtc.signal": {
        const peer = this.ctx.rooms?.peerOf(this.id, msg.to);
        if (!peer) {
          this.log.debug({ to: msg.to }, "rtc.signal to unknown peer dropped");
          return;
        }
        peer.session.send({ type: "rtc.signal", from: ts.selfClientId, payload: msg.payload });
        return;
      }
    }
  }

  private async runTsCmd(msg: Extract<ClientMessage, { type: "ts.cmd" }>): Promise<void> {
    // Every attempt spends budget, connected or not, so a page that loops on
    // a failing command is slowed down the same way either way.
    if (!this.tsCmds.take(this.id)) {
      this.send(hubTsFailure(msg.id, TS_CMD_HUB_CODES.rateLimited, "hub.rateLimited"));
      return;
    }
    const ts = this.ts;
    if (!ts) {
      this.send(hubTsFailure(msg.id, TS_CMD_HUB_CODES.notConnected, "tsErr.notConnected"));
      return;
    }
    const result = await runTsCmd(ts, msg, this.log);
    if (!result.ok) this.log.debug({ cmd: msg.cmd, code: result.code }, "ts.cmd failed");
    this.send(result);
  }

  private async connect(msg: Extract<ClientMessage, { type: "connect" }>): Promise<void> {
    if (this.ts) {
      this.send({ type: "error", code: "already_connected", message: "already connected" });
      return;
    }
    if (!this.connects.take(this.id)) {
      this.send({ type: "error", code: "rate_limited", message: "hub.rateLimited" });
      return;
    }
    const target = resolveConnectTarget(this.ctx.config, msg);
    if ("error" in target) {
      const message =
        target.error === "server_required" ? "hub.serverRequired" : "hub.serverNotAllowed";
      // Fatal: the page must leave "connecting" and show the form again.
      this.send({ type: "error", code: target.error, message, fatal: true });
      return;
    }
    const { host, port } = target;

    const ts = new TsSession(
      {
        host,
        port,
        nickname: msg.nickname,
        identity: msg.identity,
        serverPassword: target.serverPassword,
        defaultChannel: msg.defaultChannel,
        defaultChannelPassword: msg.defaultChannelPassword,
        subscribeAll: msg.subscribeAll,
        // Only ever set for the operator's fixed server (see config.ts).
        fileTransferHost: this.ctx.config.fileTransferHost ?? undefined,
        // An operator who names a host explicitly means it, private range or not.
        allowPrivateTargets: this.ctx.config.allowPrivateTsServers || target.operatorNamed,
        logger: this.log.child({ ts: `${host}:${port}` }),
      },
      {
        onMessage: (m) => this.send(m),
        onVoice: (clientId, codec, data, whisper) =>
          this.sendVoiceDown(clientId, codec, data, whisper),
        onClosed: (reason) => {
          this.ctx.rooms?.leave(this.id);
          // Whatever still runs on this connection's behalf stops now (a
          // media stream: see SessionRegistry.onEnd), even when the session
          // had already let go of it.
          this.ctx.registry.connectionClosed(this.id, ts);
          if (this.ts === ts) {
            this.ts = null;
            this.detachMusic();
            this.send({ type: "disconnected", reason, byUser: false });
          }
        },
        onSelfChannel: (channelId) => {
          this.ctx.rooms?.join(
            { serverKey: serverKeyOf(host, port), channelId },
            {
              session: this,
              clientId: ts.selfClientId,
              nickname: ts.selfNickname,
              video: false,
              camera: false,
              screen: false,
            },
          );
        },
      },
    );
    this.ts = ts;
    try {
      await ts.connect();
      this.log.info({ host, port, nickname: msg.nickname }, "teamspeak connected");
      // The bot is a convenience on top of the voice link: whatever goes
      // wrong here is reported on the music panel, never as a connect failure.
      void this.attachMusic(target.musicBot, host).catch((err: unknown) => {
        this.log.warn({ err }, "music bot attach failed");
        this.send({ type: "music.unavailable", reason: MUSIC_UNREACHABLE });
      });
    } catch (err) {
      const message = describeConnectError(err);
      this.log.warn({ err }, "teamspeak connect failed");
      this.send({ type: "error", code: "connect_failed", message, fatal: true });
      this.dropTs();
      await ts.disconnect().catch(() => undefined);
    }
  }

  /**
   * Picks, vets and joins this session's music bot. The explicit choice from
   * the browser wins, then the operator's MUSICBOT_URL, then the TeamSpeak
   * host on the bot's default port.
   */
  private async attachMusic(requested: string | undefined, tsHost: string): Promise<void> {
    const pool = this.ctx.music;
    if (!pool) return;
    const url = resolveMusicBotUrl(requested || this.ctx.config.MUSICBOT_URL, tsHost);
    let pinned: string | null = null;
    try {
      const vetted = await assertMusicBotTarget(url, {
        tsHost,
        allowPrivate: this.ctx.config.allowPrivateTsServers,
        trustedUrl: pool.globalUrl,
      });
      pinned = vetted.address;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.log.warn({ err, requested, url }, "music bot target refused");
      this.send({ type: "music.unavailable", reason });
      return;
    }
    // `url` is non-null here: the guard throws on a null resolve.
    const target = url as string;
    // The TeamSpeak side may have gone away while DNS was answering.
    if (this.closed || !this.ts) return;
    const bridge = await pool.acquire(target, pinned);
    if (this.closed || !this.ts || this.musicLink) {
      pool.release(target);
      return;
    }
    this.musicLink = {
      url: target,
      bridge,
      unsubscribe: bridge.subscribe((bots) => this.send({ type: "music.state", bots })),
    };
    this.log.info({ url: target, available: bridge.available }, "music bot attached");
    if (bridge.available) this.send({ type: "music.state", bots: bridge.summaries() });
    else this.send({ type: "music.unavailable", reason: bridge.unavailableReason });
  }

  /** Lets go of the music bridge; safe to call when none is attached. */
  private detachMusic(): void {
    const link = this.musicLink;
    if (!link) return;
    this.musicLink = null;
    link.unsubscribe();
    this.ctx.music?.release(link.url);
  }

  private async disconnectTs(reason: string, byUser: boolean): Promise<void> {
    const ts = this.dropTs();
    this.detachMusic();
    if (ts) {
      await ts.disconnect().catch(() => undefined);
      this.send({ type: "disconnected", reason, byUser });
    }
  }

  /** Graceful hub shutdown: tell TeamSpeak we are leaving, then close the socket. */
  async shutdown(): Promise<void> {
    const ts = this.dropTs();
    this.detachMusic();
    if (ts) await ts.disconnect().catch(() => undefined);
    this.send({ type: "disconnected", reason: "hub.byeShutdown", byUser: false });
    this.ws.close(1001, "hub shutdown");
  }

  private dispose(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeat);
    clearInterval(this.tokenRotation);
    this.ctx.registry.remove(this.id);
    this.ctx.rooms?.leave(this.id);
    const ts = this.dropTs();
    this.detachMusic();
    if (ts) void ts.disconnect().catch(() => undefined);
    this.log.debug({ reason }, "session disposed");
  }

  /**
   * Lets go of the TeamSpeak connection and says so at once. Its own close
   * (onClosed) comes only once the server has been told goodbye, which can
   * take seconds; a media stream running on the connection's behalf must not
   * go on for them.
   */
  private dropTs(): TsSession | null {
    const ts = this.ts;
    this.ts = null;
    if (ts) this.ctx.registry.connectionClosed(this.id, ts);
    return ts;
  }
}

/**
 * Returns an i18n key the web client translates (see `translateCode()` in
 * apps/web/src/i18n), or the raw driver message when we have no key for it.
 */
function describeConnectError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError") return "hub.connectTimeout";
    if (/ENOTFOUND|EAI_AGAIN/.test(err.message)) return "hub.connectDnsFailed";
    if (/ECONNREFUSED/.test(err.message)) return "hub.connectRefused";
    return err.message;
  }
  return String(err);
}

function toUint8(data: RawData): Uint8Array {
  if (Buffer.isBuffer(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return new Uint8Array(data as ArrayBuffer);
}
