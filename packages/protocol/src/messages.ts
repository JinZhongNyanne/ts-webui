import type { SharedApp } from "./apps.js";
import type { SharedSound } from "./sounds.js";
import type { StickerSet } from "./stickers.js";
import type { FtLimits } from "./files.js";
import { z } from "zod";
import type { TsChannel, TsClient, TsGroup, TsServerInfo } from "./types.js";
import { TsCmdRequestSchema, type PermsMessage, type TsCmdResult } from "./ts-commands.js";
import { WhisperSetSchema, type WhisperTargetMessage } from "./whisper.js";

/* ------------------------------------------------------------------ */
/* Browser -> Hub (validated on the hub with zod)                      */
/* ------------------------------------------------------------------ */

const channelIdSchema = z.string().regex(/^\d+$/, "channel id must be a decimal string");
const clientIdSchema = z.number().int().min(0).max(65535);

export const ConnectRequestSchema = z.object({
  type: z.literal("connect"),
  /** Required unless the hub has a fixed server (HUB_TS_SERVER), which then wins. */
  host: z.string().trim().min(1).max(253).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  nickname: z.string().trim().min(3).max(30),
  /** Previously exported identity string. Omit to have the hub create one. */
  identity: z.string().max(4096).optional(),
  serverPassword: z.string().max(200).optional(),
  defaultChannel: z.string().max(200).optional(),
  defaultChannelPassword: z.string().max(200).optional(),
  /**
   * Where this session's teamspeak-music-bot web UI lives: `host`,
   * `host:port` or a full `http(s)://` URL. Omitted or empty means the
   * TeamSpeak host on the bot's default port (MUSIC_BOT_DEFAULT_PORT).
   */
  musicBot: z.string().trim().max(253).optional(),
  /**
   * Subscribe to every channel right after connecting, so the tree shows who
   * is where (the hub's historical behaviour, and the default). False leaves
   * only the channels we join subscribed; the rest can be subscribed one by one.
   */
  subscribeAll: z.boolean().optional(),
});

/** teamspeak-music-bot's default `webPort`. */
export const MUSIC_BOT_DEFAULT_PORT = 3000;

export const ClientMessageSchema = z.discriminatedUnion("type", [
  ConnectRequestSchema,
  z.object({ type: z.literal("disconnect") }),
  z.object({ type: z.literal("ping"), t: z.number() }),
  z.object({
    type: z.literal("moveTo"),
    channelId: channelIdSchema,
    password: z.string().max(200).optional(),
  }),
  z.object({
    type: z.literal("sendText"),
    targetMode: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    /** Client id (mode 1) or channel id (mode 2); ignored for server (mode 3). */
    targetId: z.string().regex(/^\d+$/),
    message: z.string().min(1).max(8192),
  }),
  z.object({
    type: z.literal("poke"),
    clientId: clientIdSchema,
    message: z.string().max(100),
  }),
  z.object({ type: z.literal("setInputMuted"), muted: z.boolean() }),
  z.object({ type: z.literal("setOutputMuted"), muted: z.boolean() }),
  z.object({
    type: z.literal("setAway"),
    away: z.boolean(),
    message: z.string().max(80).optional(),
  }),
  z.object({ type: z.literal("setNickname"), nickname: z.string().trim().min(3).max(30) }),
  z.object({ type: z.literal("getChannelDescription"), channelId: channelIdSchema }),
  z.object({ type: z.literal("getClientInfo"), clientId: clientIdSchema }),
  /** Ask for a LiveKit token for the room bound to my current channel. */
  z.object({ type: z.literal("rtc.join") }),
  z.object({ type: z.literal("rtc.leave") }),
  /** Ask for a fresh asset token (see AssetTokenGrant) before the current one expires. */
  z.object({ type: z.literal("assetToken.refresh") }),
  /** Tell the hub (and thus channel mates) what I am publishing. */
  z.object({ type: z.literal("rtc.publishing"), camera: z.boolean(), screen: z.boolean() }),
  /**
   * Peer-to-peer signalling (mesh mode): relayed verbatim to another web user in
   * my channel's video room. Payload is opaque to the hub (SDP / ICE / metadata).
   */
  z.object({
    type: z.literal("rtc.signal"),
    to: clientIdSchema,
    payload: z.record(z.string(), z.unknown()),
  }),
  /** An allow-listed TeamSpeak command (see ts-commands.ts); answered by `ts.cmdResult`. */
  TsCmdRequestSchema,
  /** Whisper targets for the `UpWhisper` frames that follow (see whisper.ts). */
  WhisperSetSchema,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ConnectRequest = z.infer<typeof ConnectRequestSchema>;

/* ------------------------------------------------------------------ */
/* Hub -> Browser                                                      */
/* ------------------------------------------------------------------ */

export interface TextEvent {
  type: "text";
  targetMode: 1 | 2 | 3;
  targetId: string;
  invokerId: number;
  invokerName: string;
  invokerUid: string;
  message: string;
  at: number;
}

/** A song as the music bot reports it (fields beyond the known ones pass through). */
export interface MusicSong {
  id: string;
  name: string;
  platform: string;
  artist?: string;
  album?: string;
  duration?: number;
  coverUrl?: string;
  requestedBy?: string;
  [extra: string]: unknown;
}

/** Mirrors teamspeak-music-bot's BotStatus. */
export interface MusicBotStatus {
  id: string;
  name: string;
  connected: boolean;
  playing: boolean;
  paused: boolean;
  currentSong: MusicSong | null;
  queueSize: number;
  volume: number;
  playMode: string;
  elapsed: number;
  effectiveDuration?: number;
}

/** A list played in its own order: personal FM, or a recommendation. */
export type MusicRadio = "fm" | "recommend";

export interface MusicBotSummary {
  status: MusicBotStatus;
  queue: MusicSong[];
  /**
   * Set while personal FM or a recommendation plays; the hub then keeps the
   * bot in sequential mode and refuses the others. Absent from older hubs.
   */
  radio?: MusicRadio | null;
  /** From the bot config when the service account may read it; otherwise null. */
  nickname: string | null;
  serverAddress: string | null;
  defaultChannel: string | null;
  channelId: string | null;
}

export interface RoomVideoPublisher {
  clientId: number;
  nickname: string;
  camera: boolean;
  screen: boolean;
}

/** A web user who joined the channel's video room (mesh peers connect to these). */
export interface RoomVideoMember {
  clientId: number;
  nickname: string;
}

export interface RoomState {
  channelId: string;
  video: { publishers: RoomVideoPublisher[]; members: RoomVideoMember[] };
  /** Extension modules park their per-channel state here, keyed by module name. */
  ext: Record<string, unknown>;
}

/** Shape of RTCIceServer as sent to browsers. */
export interface IceServerInfo {
  urls: string[];
  username?: string;
  credential?: string;
}

/**
 * How web users exchange video/screen share:
 *  - "livekit": SFU, scales to large rooms (needs a LiveKit server)
 *  - "mesh": direct WebRTC between browsers, signalled through the hub (no extra server)
 *  - "none": video disabled
 */
export type RtcBackend = "livekit" | "mesh" | "none";

/**
 * A user's own customisations, stored by the hub and keyed by TeamSpeak UID:
 * an avatar icon and a sound that plays for others when they enter a channel.
 * Each field is the asset's revision (for cache busting) or null when unset.
 */
export interface UserProfile {
  uid: string;
  icon: number | null;
  sound: number | null;
}

export interface HubFeatures {
  video: boolean;
  music: boolean;
  rtc: RtcBackend;
  iceServers: IceServerInfo[];
  /** Channel file transfer limits (M3); absent from hubs that predate it. */
  files?: FtLimits;
}

/**
 * A short-lived, read-only credential for the asset routes that `<img>` and
 * `<audio>` load (icons, avatars, profile assets, TTS audio). It replaces the
 * session id in those URLs, so a leaked URL cannot drive the session.
 */
export interface AssetTokenGrant {
  token: string;
  /** Unix epoch milliseconds after which the hub refuses the token. */
  expiresAt: number;
}

export type ServerMessage =
  | {
      type: "hello";
      sessionId: string;
      features: HubFeatures;
      assetToken: AssetTokenGrant;
      /**
       * The build the hub runs (the image's commit), "" when unknown. The web
       * UI ships in the same image, so a page built from another commit is
       * stale and should offer a reload.
       */
      build: string;
    }
  /** A rotated token; earlier tokens stay valid until their own expiry. */
  | ({ type: "assetToken" } & AssetTokenGrant)
  | { type: "connecting" }
  | {
      type: "connected";
      selfClientId: number;
      /** Exported identity string; browser should persist it. */
      identity: string;
      uid: string;
      server: TsServerInfo;
    }
  | {
      type: "snapshot";
      channels: TsChannel[];
      clients: TsClient[];
      serverGroups: TsGroup[];
      channelGroups: TsGroup[];
    }
  | { type: "groups"; serverGroups: TsGroup[]; channelGroups: TsGroup[] }
  | { type: "channel.added"; channel: TsChannel }
  | { type: "channel.updated"; channelId: string; patch: Partial<TsChannel> }
  | { type: "channel.removed"; channelId: string }
  | {
      type: "client.entered";
      client: TsClient;
      /**
       * True when the client just connected to the server; false when it only
       * came into view (moved out of a channel we don't see, or we subscribed
       * to its channel). Absent from hubs that predate the field.
       */
      joinedServer?: boolean;
    }
  | {
      type: "client.left";
      clientId: number;
      reasonId: number;
      reasonMsg: string;
      /** Who did it, for a kick (5) or ban (6). */
      invokerName?: string;
    }
  | {
      type: "client.moved";
      clientId: number;
      channelId: string;
      reasonId: number;
      invokerId?: number;
      invokerName?: string;
      /** The kick reason, for reasonId 4 (kicked from the channel). */
      reasonMsg?: string;
    }
  | { type: "client.updated"; clientId: number; patch: Partial<TsClient> }
  | { type: "client.info"; clientId: number; raw: Record<string, string> }
  | { type: "channel.description"; channelId: string; description: string }
  /**
   * Someone changed the description (the server does not say to what): a
   * page that shows it asks again with `getChannelDescription`. Not fetched
   * for every session up front, see TsSession.
   */
  | { type: "channel.descriptionChanged"; channelId: string }
  | TextEvent
  | { type: "poked"; invokerId: number; invokerName: string; message: string; at: number }
  | { type: "server.updated"; patch: Partial<TsServerInfo> }
  | { type: "error"; code: string; message: string; fatal?: boolean }
  | { type: "log"; level: LogLevel; scope: string; message: string; at: number }
  /**
   * The TeamSpeak connection ended. `byUser` marks the ones the user asked for,
   * so the client knows whether to offer a reconnect. `reason` is a text code
   * (see text-code.ts) or raw driver text.
   */
  | { type: "disconnected"; reason: string; byUser: boolean }
  | { type: "pong"; t: number }
  | { type: "music.state"; bots: MusicBotSummary[] }
  | { type: "music.unavailable"; reason: string }
  | { type: "rtc.token"; url: string; token: string; room: string }
  /** Mesh mode reply to rtc.join: peers arrive via room.state.video.members. */
  | { type: "rtc.mesh"; room: string; selfClientId: number; iceServers: IceServerInfo[] }
  | { type: "rtc.signal"; from: number; payload: Record<string, unknown> }
  | { type: "room.state"; state: RoomState }
  | { type: "profile.updated"; profile: UserProfile }
  /** The Apps window list changed (anyone added or removed a site); the whole list. */
  | { type: "apps.updated"; apps: SharedApp[] }
  /** The soundboard changed (anyone uploaded, renamed, re-levelled or deleted a clip); the whole list. */
  | { type: "sounds.updated"; sounds: SharedSound[] }
  /**
   * One sticker scope changed; the whole scope. A `shared` set goes to every
   * connected session, a `personal` one only to the sessions of the identity
   * it belongs to (see stickers/routes.ts).
   */
  | { type: "stickers.updated"; set: StickerSet }
  | TsCmdResult
  | PermsMessage
  | WhisperTargetMessage;

export type LogLevel = "debug" | "info" | "warn" | "error";

export type ServerMessageType = ServerMessage["type"];
