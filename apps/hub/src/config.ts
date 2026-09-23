import { isIP } from "node:net";
import { z } from "zod";
import { FT_MEDIA_OPENS_PER_MIN, type IceServerInfo, type RtcBackend } from "@jinz/protocol";
import { normalizeOrigin } from "./security/origin.js";

const boolFromEnv = z
  .string()
  .optional()
  .transform((v) => v === "1" || v?.toLowerCase() === "true");

/** Unset stays unset, so the caller can pick a default that depends on NODE_ENV. */
const optionalBoolFromEnv = z
  .string()
  .optional()
  .transform((v) =>
    v === undefined || v === "" ? undefined : v === "1" || v.toLowerCase() === "true",
  );

const DEV_SESSION_SECRET = "dev-only-secret-change-me-please";

const rate = (fallback: number) => z.coerce.number().int().min(0).default(fallback);

const csv = z
  .string()
  .default("")
  .transform((s) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  );

const ConfigSchema = z.object({
  HUB_HOST: z.string().default("127.0.0.1"),
  HUB_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HUB_PUBLIC_ORIGIN: z.string().default("http://localhost:5173"),
  /** Extra browser origins allowed to talk to this hub (comma separated). */
  HUB_ALLOWED_ORIGINS: csv,
  /** Trust `X-Forwarded-For`. Only enable behind a proxy you control: it decides client IPs. */
  HUB_TRUST_PROXY: boolFromEnv,
  /**
   * Allow TeamSpeak targets on loopback/private ranges. Defaults to on in
   * development (that is where a local test server lives) and off in
   * production, where it would make the hub a probe into its own network.
   */
  HUB_ALLOW_PRIVATE_TS_SERVERS: optionalBoolFromEnv,
  /** Simultaneous browser sessions from one IP (0 = unlimited). */
  HUB_MAX_SESSIONS_PER_IP: z.coerce.number().int().min(0).default(10),
  /** Per-IP HTTP API requests per minute (0 = unlimited). */
  HUB_HTTP_RATE_PER_MIN: rate(300),
  /** Per-session TeamSpeak connect attempts per minute (0 = unlimited). */
  HUB_CONNECT_RATE_PER_MIN: rate(10),
  /** Per-session TTS syntheses per minute (0 = unlimited). */
  HUB_TTS_RATE_PER_MIN: rate(30),
  /** Per-session music-bot proxy calls per minute (0 = unlimited). */
  HUB_MUSIC_RATE_PER_MIN: rate(120),
  /** Per-session websocket commands per minute, voice excluded (0 = unlimited). */
  HUB_COMMAND_RATE_PER_MIN: rate(600),
  /**
   * Per-session allow-listed TeamSpeak commands (`ts.cmd`) per minute, on top
   * of the command limit above (0 = unlimited). Each one costs a round trip on
   * the TeamSpeak server, whose own anti-flood would otherwise be the limit.
   */
  HUB_TS_CMD_RATE_PER_MIN: rate(120),
  /** Largest channel file upload the hub passes on, in bytes (0 = no uploads). */
  HUB_FT_MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .min(0)
    .default(100 * 1024 * 1024),
  /** File transfers (uploads and downloads) one session may run at once. */
  HUB_FT_MAX_TRANSFERS_PER_SESSION: z.coerce.number().int().min(1).max(20).default(3),
  /**
   * Per-session transfer starts (download links and uploads) per minute
   * (0 = unlimited). Each is a command on the TeamSpeak server as well.
   */
  HUB_FT_RATE_PER_MIN: rate(30),
  /**
   * Per-session media opens per minute (0 = unlimited): a chat video's link and
   * every seek a player makes, each a transfer start on the TeamSpeak server.
   * Counted on top of HUB_FT_RATE_PER_MIN, which media opens spend as well.
   */
  HUB_FT_MEDIA_OPENS_PER_MIN: rate(FT_MEDIA_OPENS_PER_MIN),
  /**
   * File transfers the whole hub runs at once. Each holds a browser request,
   * a socket to the file port and a transfer on the TeamSpeak server.
   */
  HUB_FT_MAX_TRANSFERS: z.coerce.number().int().min(1).max(1000).default(32),
  /**
   * The stall watchdog: a transfer that moves fewer than HUB_FT_STALL_MIN_BYTES
   * in any HUB_FT_STALL_SECONDS is cut off (a trickling upload, a download
   * nobody reads). The defaults (64 KiB a minute, about 1 KB/s) leave room for
   * the slowest real links.
   */
  HUB_FT_STALL_SECONDS: z.coerce.number().int().min(5).max(3600).default(60),
  HUB_FT_STALL_MIN_BYTES: z.coerce
    .number()
    .int()
    .min(1)
    .default(64 * 1024),
  /** Bytes the hub-wide icon/avatar cache may hold (at least 1 MiB). */
  HUB_ASSET_CACHE_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1024 * 1024)
    .default(64 * 1024 * 1024),
  /**
   * Host to dial for the fixed server's file port (TCP 30033 by default),
   * when it differs from HUB_TS_SERVER: e.g. the TS server's LAN address
   * while voice goes to its public name. Ignored without HUB_TS_SERVER.
   */
  HUB_FT_HOST: z.string().trim().default(""),
  /**
   * The address native TeamSpeak clients know the fixed server by, `host[:port]`.
   * The page needs it for links other clients can open (files shared in chat).
   * Defaults to HUB_TS_SERVER when that is a name; an IP there (often a LAN
   * address) is never shown to the page unless named here.
   */
  HUB_TS_PUBLIC_ADDRESS: z.string().trim().default(""),
  HUB_SESSION_SECRET: z.string().min(16).default(DEV_SESSION_SECRET),
  /**
   * Shared password a browser must enter before it can use this hub at all.
   * Empty = open to anyone who can load the page (the old behaviour).
   */
  HUB_PASSWORD: z.string().default(""),
  /**
   * The one TeamSpeak server this hub connects to, `host[:port]`. When set,
   * the browser only picks a nickname: whatever address, password or music bot
   * it sends is ignored. Empty = the browser names the server.
   */
  HUB_TS_SERVER: z.string().trim().default(""),
  /** Server password for HUB_TS_SERVER. */
  HUB_TS_PASSWORD: z.string().default(""),
  HUB_ALLOWED_TS_SERVERS: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean),
    ),
  HUB_DEFAULT_TS_SERVER: z.string().default("localhost:9987"),
  /** Directory of the built web UI to serve in production. Empty = don't serve. */
  HUB_STATIC_DIR: z.string().default(""),
  /** Where per-user profiles (avatar icon, entry sound) are stored. */
  HUB_DATA_DIR: z.string().default("./data"),
  HUB_LOG_LEVEL: z.string().default("info"),
  HUB_LOG_PRETTY: boolFromEnv,

  /**
   * Default music bot for sessions that do not name one at connect time.
   * Empty = the TeamSpeak host on the bot's default port. A bot named by the
   * browser always wins over this.
   */
  MUSICBOT_URL: z.string().default(""),
  /** Credentials used only when a session lands on MUSICBOT_URL; other bots run in guest mode. */
  MUSICBOT_USERNAME: z.string().default(""),
  MUSICBOT_PASSWORD: z.string().default(""),
  /** Accept the bot's self-signed/untrusted HTTPS certificate. */
  MUSICBOT_INSECURE_TLS: boolFromEnv,

  /**
   * Video / screen-share transport between web users:
   *  auto    = LiveKit when fully configured, otherwise browser-to-browser mesh
   *  mesh    = always direct WebRTC (no extra server; fine for a handful of people)
   *  livekit = require LiveKit (video disabled if not configured)
   *  off     = no video
   */
  RTC_MODE: z.enum(["auto", "mesh", "livekit", "off"]).default("auto"),
  /** STUN servers for mesh mode (comma separated). */
  RTC_STUN_URLS: csv.transform((urls) =>
    urls.length ? urls : ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
  ),
  /** Optional TURN relay for mesh mode (needed when both peers sit behind strict NAT). */
  RTC_TURN_URLS: csv,
  RTC_TURN_USERNAME: z.string().default(""),
  RTC_TURN_PASSWORD: z.string().default(""),

  LIVEKIT_URL: z.string().default(""),
  LIVEKIT_PUBLIC_URL: z.string().default(""),
  LIVEKIT_API_KEY: z.string().default(""),
  LIVEKIT_API_SECRET: z.string().default(""),

  NODE_ENV: z.string().default("development"),
  /** The commit this image was built from, baked in by the Dockerfile; "" when unknown. */
  BUILD_ID: z.string().trim().default(""),
});

export type Config = z.infer<typeof ConfigSchema> & {
  isProd: boolean;
  /** Normalized origins accepted on the websocket handshake and on writes. */
  allowedOrigins: string[];
  allowPrivateTsServers: boolean;
  videoEnabled: boolean;
  rtcBackend: RtcBackend;
  iceServers: IceServerInfo[];
  /** Parsed HUB_TS_SERVER; null when the browser names the server. */
  fixedServer: FixedServer | null;
  /** HUB_FT_HOST when it applies (fixed-server mode); null otherwise. */
  fileTransferHost: string | null;
  /** What the page may call the fixed server in links for native clients; see HUB_TS_PUBLIC_ADDRESS. */
  publicServer: { host: string; port: number } | null;
};

export interface FixedServer {
  host: string;
  port: number;
  password: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const c = parsed.data;
  const isProd = c.NODE_ENV === "production";
  const livekitReady = Boolean(c.LIVEKIT_URL && c.LIVEKIT_API_KEY && c.LIVEKIT_API_SECRET);
  const rtcBackend = pickRtcBackend(c.RTC_MODE, livekitReady);
  // Passes are signed with the secret: a public default would let anyone mint one.
  if (isProd && c.HUB_PASSWORD && c.HUB_SESSION_SECRET === DEV_SESSION_SECRET) {
    throw new Error("Invalid configuration: HUB_PASSWORD needs a real HUB_SESSION_SECRET");
  }
  let fixedServer: FixedServer | null = null;
  if (c.HUB_TS_SERVER) {
    const target = parseHostPort(c.HUB_TS_SERVER);
    if (!target)
      throw new Error(`Invalid configuration: HUB_TS_SERVER: bad address "${c.HUB_TS_SERVER}"`);
    fixedServer = { ...target, password: c.HUB_TS_PASSWORD };
  }
  const ftHost = fixedServer && c.HUB_FT_HOST ? parseHostPort(c.HUB_FT_HOST)?.host : null;
  if (ftHost === undefined) {
    throw new Error(`Invalid configuration: HUB_FT_HOST: bad host "${c.HUB_FT_HOST}"`);
  }
  let publicServer: { host: string; port: number } | null = null;
  if (c.HUB_TS_PUBLIC_ADDRESS) {
    const named = parseHostPort(c.HUB_TS_PUBLIC_ADDRESS);
    if (!named) {
      throw new Error(
        `Invalid configuration: HUB_TS_PUBLIC_ADDRESS: bad address "${c.HUB_TS_PUBLIC_ADDRESS}"`,
      );
    }
    publicServer = { host: named.host, port: named.port };
  } else if (fixedServer && isIP(fixedServer.host) === 0) {
    publicServer = { host: fixedServer.host, port: fixedServer.port };
  }
  return {
    ...c,
    isProd,
    allowedOrigins: [c.HUB_PUBLIC_ORIGIN, ...c.HUB_ALLOWED_ORIGINS]
      .map(normalizeOrigin)
      .filter(Boolean),
    allowPrivateTsServers: c.HUB_ALLOW_PRIVATE_TS_SERVERS ?? !isProd,
    videoEnabled: rtcBackend !== "none",
    rtcBackend,
    iceServers: buildIceServers(c),
    fixedServer,
    fileTransferHost: ftHost,
    publicServer,
  };
}

const DEFAULT_TS_PORT = 9987;

/** `host`, `host:port`, `[v6]` or `[v6]:port`; null for anything else. */
export function parseHostPort(value: string): { host: string; port: number } | null {
  const m = /^(?:\[([0-9a-f:.]+)\]|([^\s:/@[\]]+))(?::(\d{1,5}))?$/i.exec(value.trim());
  if (!m) return null;
  const host = (m[1] ?? m[2] ?? "").toLowerCase();
  const port = m[3] === undefined ? DEFAULT_TS_PORT : Number(m[3]);
  if (!host || port < 1 || port > 65535) return null;
  return { host, port };
}

export function pickRtcBackend(mode: Config["RTC_MODE"], livekitReady: boolean): RtcBackend {
  switch (mode) {
    case "off":
      return "none";
    case "mesh":
      return "mesh";
    case "livekit":
      return livekitReady ? "livekit" : "none";
    default:
      return livekitReady ? "livekit" : "mesh";
  }
}

function buildIceServers(
  c: Pick<
    z.infer<typeof ConfigSchema>,
    "RTC_STUN_URLS" | "RTC_TURN_URLS" | "RTC_TURN_USERNAME" | "RTC_TURN_PASSWORD"
  >,
): IceServerInfo[] {
  const out: IceServerInfo[] = [];
  if (c.RTC_STUN_URLS.length) out.push({ urls: c.RTC_STUN_URLS });
  if (c.RTC_TURN_URLS.length) {
    const turn: IceServerInfo = { urls: c.RTC_TURN_URLS };
    if (c.RTC_TURN_USERNAME) turn.username = c.RTC_TURN_USERNAME;
    if (c.RTC_TURN_PASSWORD) turn.credential = c.RTC_TURN_PASSWORD;
    out.push(turn);
  }
  return out;
}

/**
 * ICE servers safe to hand out before a session has connected to TeamSpeak.
 * TURN entries carry credentials for a relay we pay for, so they only go to a
 * session that is actually in a channel (see the `rtc.join` reply).
 */
export function publicIceServers(iceServers: IceServerInfo[]): IceServerInfo[] {
  return iceServers.filter((s) => !s.username && !s.credential);
}

/** Returns true when the browser may connect to this TeamSpeak host:port. */
export function isServerAllowed(config: Config, host: string, port: number): boolean {
  if (config.HUB_ALLOWED_TS_SERVERS.length === 0) return true;
  return isServerListed(config, host, port);
}

/** True only when the operator named this host in HUB_ALLOWED_TS_SERVERS. */
export function isServerListed(config: Config, host: string, port: number): boolean {
  const h = host.toLowerCase();
  return config.HUB_ALLOWED_TS_SERVERS.some((entry) => entry === h || entry === `${h}:${port}`);
}

/** What a `connect` request actually dials once the operator's settings are applied. */
export interface ConnectTarget {
  host: string;
  port: number;
  serverPassword?: string;
  /** The browser's music bot choice; undefined = MUSICBOT_URL or the TeamSpeak host. */
  musicBot?: string;
  /** The operator named this server, so it may sit in a private range. */
  operatorNamed: boolean;
}

export type ConnectTargetError = "server_required" | "server_not_allowed";

/**
 * With HUB_TS_SERVER set the browser's address, password and music bot are
 * ignored: the operator decided all three. Otherwise the browser's choice is
 * checked against HUB_ALLOWED_TS_SERVERS.
 */
export function resolveConnectTarget(
  config: Config,
  req: { host?: string; port?: number; serverPassword?: string; musicBot?: string },
): ConnectTarget | { error: ConnectTargetError } {
  const fixed = config.fixedServer;
  if (fixed) {
    return {
      host: fixed.host,
      port: fixed.port,
      serverPassword: fixed.password || undefined,
      operatorNamed: true,
    };
  }
  if (!req.host) return { error: "server_required" };
  const port = req.port ?? DEFAULT_TS_PORT;
  if (!isServerAllowed(config, req.host, port)) return { error: "server_not_allowed" };
  return {
    host: req.host,
    port,
    serverPassword: req.serverPassword,
    musicBot: req.musicBot,
    operatorNamed: isServerListed(config, req.host, port),
  };
}
