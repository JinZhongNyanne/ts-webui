/**
 * BFF for teamspeak-music-bot.
 *
 * Logs in with a service account (the bot only knows cookie sessions), keeps
 * the cookie fresh, proxies whitelisted REST calls and relays the bot's /ws
 * state stream to our browser sessions.
 */
import WebSocket from "ws";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { Agent, type Dispatcher } from "undici";
import type { MusicBotStatus, MusicBotSummary, MusicRadio, MusicSong } from "@jinz/protocol";
import type { Logger } from "../logger.js";
import { MUSIC_TLS_ERROR, MUSIC_UNREACHABLE } from "./target.js";
import type { BotUrlState } from "./music-state.js";
import {
  addedSongs,
  BOT_GUEST_NAME,
  RequesterBook,
  relabelResponse,
  relabelSong,
} from "./requesters.js";

export interface BotBridgeOptions {
  baseUrl: string;
  username: string;
  password: string;
  logger: Logger;
  /** Skip TLS certificate verification (self-signed bot instances). */
  insecureTls?: boolean;
  /**
   * IP the target guard resolved; every socket dials it instead of resolving
   * the hostname again, so the guard's answer is the one that is used.
   */
  pinnedAddress?: string | null;
  /**
   * Where the bots' radios and requesters are kept. The pool hands in one per
   * bot URL so they outlive a bridge stopped because its last session left,
   * and a hub restart; see music-state.ts.
   */
  state?: BotUrlState;
  /** Called after the bridge changed `state`, so it can be saved. */
  onStateChange?: () => void;
}

/** A `net.connect`-style lookup that always answers with the pinned address. */
export function pinnedLookup(address: string): LookupFunction {
  const family = isIP(address);
  return (_hostname, options, callback) => {
    const cb = callback as (...args: unknown[]) => void;
    if (typeof options === "object" && options !== null && "all" in options && options.all) {
      cb(null, [{ address, family }]);
    } else {
      cb(null, address, family);
    }
  };
}

export interface ProxyResult {
  status: number;
  body: unknown;
}

type Listener = (bots: MusicBotSummary[]) => void;

interface BotConfigLite {
  nickname?: string;
  serverAddress?: string;
  serverPort?: number;
  defaultChannel?: string;
  channelId?: string | number;
}

/** Node/OpenSSL codes that mean "the certificate was refused", not "no route". */
const TLS_ERROR_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

/** True when `err` (or anything it wraps) is a certificate rejection. */
export function isTlsError(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 5; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && TLS_ERROR_CODES.has(code)) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** `http://host:port` of a base URL; the URL itself when it does not parse. */
function originOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return baseUrl;
  }
}

export class BotBridge {
  private cookie = "";
  private ws: WebSocket | null = null;
  private stopped = false;
  private reconnectDelay = 1000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly bots = new Map<string, MusicBotSummary>();
  /** Bots playing personal FM or a recommendation; see radio.ts. */
  private readonly radios: Map<string, MusicRadio>;
  private readonly radioOwners: Map<string, string>;
  /**
   * When each FM started, as far as this bridge knows (its own start for one
   * restored from disk). A song credited to someone since then is theirs, not
   * the FM's: the bot announces no single-song add, so it shows up in the
   * same queue update as FM's own songs.
   */
  private readonly fmSince = new Map<string, number>();
  private readonly createdAt = Date.now();
  /** Who requested what through the hub; see requesters.ts. */
  private readonly requesters: RequesterBook;
  /**
   * The name the bot credits the hub's requests to: its account's username,
   * or the guest name. Rows carrying it get the hub's own record instead.
   */
  private identity: string;
  private readonly listeners = new Set<Listener>();
  private readonly log: Logger;
  private readonly baseUrl: string;
  /**
   * Scheme + host(:port) of the bot, sent as `Origin` on every call. The bot's
   * `/api` CSRF gate refuses any POST/DELETE whose Origin (or Referer) host does
   * not equal its own Host header, answering `403 {"error":"bad origin"}`.
   * Node's fetch never adds Origin by itself, so we must.
   */
  private readonly origin: string;
  /** undici dispatcher; set when the address is pinned or the certificate is not verified. */
  private readonly dispatcher: Dispatcher | undefined;
  private readonly lookup: LookupFunction | undefined;
  available = false;
  /**
   * Why the last start attempt failed, as a text code the browser translates.
   * A TLS failure is called out separately: "unreachable" sends the operator
   * hunting for a network problem when the certificate is simply expired.
   */
  unavailableReason: string = MUSIC_UNREACHABLE;

  constructor(private readonly opts: BotBridgeOptions) {
    this.log = opts.logger;
    this.radios = opts.state?.radios ?? new Map();
    this.radioOwners = opts.state?.radioOwners ?? new Map();
    this.requesters = opts.state?.requesters ?? new RequesterBook();
    this.identity = this.useGuest() ? BOT_GUEST_NAME : opts.username;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.origin = originOf(this.baseUrl);
    this.lookup = opts.pinnedAddress ? pinnedLookup(opts.pinnedAddress) : undefined;
    this.dispatcher =
      opts.insecureTls || this.lookup
        ? new Agent({
            connect: {
              rejectUnauthorized: !opts.insecureTls,
              ...(this.lookup ? { lookup: this.lookup } : {}),
            },
          })
        : undefined;
  }

  /**
   * fetch() through the pinned/TLS-lenient dispatcher. Redirects are refused:
   * the target guard vetted this URL, not wherever a 3xx might point.
   */
  private http(url: string, init: RequestInit = {}): Promise<Response> {
    const extra = this.dispatcher ? { dispatcher: this.dispatcher } : {};
    return fetch(url, { ...init, redirect: "error", ...extra } as RequestInit);
  }

  async start(): Promise<void> {
    try {
      await this.login();
      await this.refreshAll();
      this.available = true;
      this.unavailableReason = MUSIC_UNREACHABLE;
    } catch (err) {
      this.unavailableReason = isTlsError(err) ? MUSIC_TLS_ERROR : MUSIC_UNREACHABLE;
      this.log.warn(
        { err, reason: this.unavailableReason },
        "music bot not reachable yet; will keep retrying",
      );
    }
    this.connectWs();
  }

  stop(): void {
    this.stopped = true;
    this.available = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    // The keep-alive pool holds the process open otherwise.
    void this.dispatcher?.close().catch(() => undefined);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  summaries(): MusicBotSummary[] {
    return [...this.bots.values()].map((b) => {
      const id = b.status.id;
      const relabel = <T>(song: T): T => relabelSong(song, this.requesters, id, this.identity);
      return {
        ...b,
        status: { ...b.status, currentSong: relabel(b.status.currentSong) },
        queue: b.queue.map(relabel),
        radio: this.radioOf(id),
      };
    });
  }

  /** What the bot is playing in locked order, if anything. */
  radioOf(botId: string): MusicRadio | null {
    return this.radios.get(botId) ?? null;
  }

  /**
   * Records a radio starting or ending and tells every session. `owner` is who
   * started it; songs FM adds later are credited to them.
   */
  setRadio(botId: string, radio: MusicRadio | null, owner?: string): void {
    const ownerBefore = this.radioOwners.get(botId);
    const ownerAfter = radio === "fm" && owner ? owner : undefined;
    if (this.radioOf(botId) === radio && ownerBefore === ownerAfter) return;
    if (radio) this.radios.set(botId, radio);
    else this.radios.delete(botId);
    if (ownerAfter) this.radioOwners.set(botId, ownerAfter);
    else this.radioOwners.delete(botId);
    if (radio === "fm") this.fmSince.set(botId, Date.now());
    else this.fmSince.delete(botId);
    this.opts.onStateChange?.();
    this.notify();
  }

  /** The queue as last reported, before a call changes it. */
  queueOf(botId: string): MusicSong[] {
    return this.bots.get(botId)?.queue ?? [];
  }

  /** Fetches the queue now, for a call whose songs only the queue names. */
  async refreshQueue(botId: string): Promise<MusicSong[]> {
    await this.fetchQueue(botId);
    return this.queueOf(botId);
  }

  /**
   * Credits songs to the TeamSpeak user who requested them. `fromDiff` songs
   * were worked out from the queue, so only those the bot credited to the
   * hub's own account are taken: anyone else's are not ours to rename.
   */
  credit(botId: string, songs: readonly MusicSong[], name: string, fromDiff = false): void {
    const ours = fromDiff ? songs.filter((s) => this.isOurs(s)) : songs;
    if (!this.requesters.record(botId, ours, name)) return;
    this.opts.onStateChange?.();
    this.notify();
  }

  /** A proxied GET answer with the hub's requesters filled in. */
  relabel(path: string, body: unknown): unknown {
    return relabelResponse(path, body, this.requesters, this.identity);
  }

  private isOurs(song: MusicSong): boolean {
    const by = typeof song.requestedBy === "string" ? song.requestedBy.trim() : "";
    return by === "" || by === this.identity;
  }

  /* ------------------------------- HTTP -------------------------------- */

  /**
   * Obtains a bot session cookie. With credentials this is a member/admin login;
   * without them it falls back to the bot's guest mode (must be enabled by the
   * bot admin), which allows song requests with the guest permission set.
   */
  private useGuest(): boolean {
    return !this.opts.username || !this.opts.password;
  }

  private async login(): Promise<void> {
    const useGuest = this.useGuest();
    const res = await this.http(`${this.baseUrl}/api/session/${useGuest ? "guest" : "login"}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: this.origin },
      body: useGuest
        ? "{}"
        : JSON.stringify({ username: this.opts.username, password: this.opts.password }),
    });
    if (!res.ok) {
      throw new Error(
        useGuest
          ? `music bot guest session refused (HTTP ${res.status}); enable guest mode or set MUSICBOT_USERNAME/PASSWORD`
          : `music bot login failed: HTTP ${res.status}`,
      );
    }
    const cookies = res.headers.getSetCookie();
    const first = cookies[0]?.split(";")[0];
    if (!first) throw new Error("music bot login returned no session cookie");
    this.cookie = first;
    this.log.info({ mode: useGuest ? "guest" : "account" }, "music bot session established");
    await this.learnIdentity();
  }

  /** Asks the bot what name it credits our requests to; the guess stands if it will not say. */
  private async learnIdentity(): Promise<void> {
    try {
      const me = await this.request("GET", "/api/session/me", undefined, false);
      const name = (me.body as { username?: unknown } | null)?.username;
      if (me.status === 200 && typeof name === "string" && name.trim()) {
        this.identity = name.trim();
      }
    } catch (err) {
      this.log.debug({ err }, "could not read the bot session's username");
    }
  }

  /** Performs an authenticated request; re-logs in once on 401. */
  async request(method: string, path: string, body?: unknown, retry = true): Promise<ProxyResult> {
    if (!this.cookie) await this.login();
    const init: RequestInit = {
      method,
      headers: {
        cookie: this.cookie,
        accept: "application/json",
        origin: this.origin,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };
    const res = await this.http(`${this.baseUrl}${path}`, init);
    if (res.status === 401 && retry) {
      await this.login();
      return this.request(method, path, body, false);
    }
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }
    }
    return { status: res.status, body: parsed };
  }

  private async refreshAll(): Promise<void> {
    const list = await this.request("GET", "/api/bot");
    if (list.status !== 200) throw new Error(`bot list failed: HTTP ${list.status}`);
    const statuses = ((list.body as { bots?: MusicBotStatus[] })?.bots ?? []) as MusicBotStatus[];
    const seen = new Set<string>();
    await Promise.all(
      statuses.map(async (status) => {
        seen.add(status.id);
        await this.upsert(status, undefined, true);
      }),
    );
    for (const id of [...this.bots.keys()]) if (!seen.has(id)) this.bots.delete(id);
    this.notify();
  }

  private async upsert(
    status: MusicBotStatus,
    queue?: MusicSong[],
    fetchDetails = false,
  ): Promise<void> {
    const prev = this.bots.get(status.id);
    const next: MusicBotSummary = {
      status,
      queue: queue ?? prev?.queue ?? [],
      nickname: prev?.nickname ?? null,
      serverAddress: prev?.serverAddress ?? null,
      defaultChannel: prev?.defaultChannel ?? null,
      channelId: prev?.channelId ?? null,
    };
    this.bots.set(status.id, next);
    // A queue emptied from the bot's own UI or a chat command ended the radio
    // without the hub seeing it.
    if (queue?.length === 0 && this.radios.has(status.id)) {
      this.radios.delete(status.id);
      this.radioOwners.delete(status.id);
      this.fmSince.delete(status.id);
      this.opts.onStateChange?.();
    }
    // FM tops the queue up at its end on its own, crediting the account that
    // started it. Only songs appended past the old end count, and none that
    // someone requested through the hub while FM played.
    const fmOwner = this.radioOwners.get(status.id);
    if (queue && prev && fmOwner && this.radios.get(status.id) === "fm") {
      const since = this.fmSince.get(status.id) ?? this.createdAt;
      const appended = addedSongs(prev.queue, queue.slice(prev.queue.length));
      const ours = appended.filter(
        (s) =>
          this.isOurs(s) &&
          !this.requesters.creditedSince(
            status.id,
            { id: String(s.id), platform: s.platform },
            since,
          ),
      );
      if (this.requesters.record(status.id, ours, fmOwner)) this.opts.onStateChange?.();
    }
    if (fetchDetails || (!queue && !prev)) {
      await Promise.all([
        this.fetchQueue(status.id),
        prev ? Promise.resolve() : this.fetchConfig(status.id),
      ]);
    }
  }

  private async fetchQueue(botId: string): Promise<void> {
    try {
      const r = await this.request("GET", `/api/player/${encodeURIComponent(botId)}/queue`);
      const b = this.bots.get(botId);
      if (r.status === 200 && b) {
        const body = r.body as { queue?: MusicSong[]; status?: MusicBotStatus };
        if (Array.isArray(body.queue)) b.queue = body.queue;
        if (body.status) b.status = body.status;
      }
    } catch (err) {
      this.log.debug({ err, botId }, "queue fetch failed");
    }
  }

  private async fetchConfig(botId: string): Promise<void> {
    try {
      const r = await this.request("GET", `/api/bot/${encodeURIComponent(botId)}/config`);
      const b = this.bots.get(botId);
      if (r.status === 200 && b) {
        const c = r.body as BotConfigLite;
        b.nickname = c.nickname ?? null;
        b.serverAddress = c.serverAddress
          ? `${c.serverAddress}${c.serverPort ? `:${c.serverPort}` : ""}`
          : null;
        b.defaultChannel = c.defaultChannel ?? null;
        b.channelId =
          c.channelId !== undefined && c.channelId !== null ? String(c.channelId) : null;
      }
    } catch (err) {
      this.log.debug({ err, botId }, "config fetch failed (service account may lack bot.manage)");
    }
  }

  /* -------------------------------- WS --------------------------------- */

  private connectWs(): void {
    if (this.stopped) return;
    const url = `${this.baseUrl.replace(/^http/, "ws")}/ws`;
    const ws = new WebSocket(url, {
      headers: { cookie: this.cookie, origin: this.origin },
      rejectUnauthorized: !this.opts.insecureTls,
      followRedirects: false,
      ...(this.lookup ? { lookup: this.lookup } : {}),
    });
    this.ws = ws;
    ws.on("open", () => {
      this.reconnectDelay = 1000;
      // The socket being up says nothing about the REST side: without a session
      // cookie every proxied call 401s, so the panel must not claim to work.
      this.available = this.cookie !== "";
      this.log.info({ available: this.available }, "music bot websocket connected");
    });
    ws.on("message", (data) => {
      try {
        void this.onWsMessage(JSON.parse(data.toString()) as Record<string, unknown>);
      } catch (err) {
        this.log.debug({ err }, "bad music bot ws message");
      }
    });
    ws.on("unexpected-response", (_req, res) => {
      this.log.warn({ status: res.statusCode }, "music bot websocket rejected");
      if (res.statusCode === 401 || res.statusCode === 403) this.cookie = "";
      ws.terminate();
    });
    ws.on("error", (err) => this.log.debug({ err }, "music bot websocket error"));
    ws.on("close", () => {
      this.ws = null;
      this.available = false;
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        if (!this.cookie) await this.login();
        await this.refreshAll();
      } catch (err) {
        this.log.debug({ err }, "music bot still unavailable");
      }
      this.connectWs();
    }, delay);
  }

  private async onWsMessage(msg: Record<string, unknown>): Promise<void> {
    switch (msg["type"]) {
      case "init": {
        const bots = (msg["bots"] as MusicBotStatus[] | undefined) ?? [];
        for (const s of bots) await this.upsert(s);
        this.notify();
        break;
      }
      case "stateChange": {
        const status = msg["status"] as MusicBotStatus | undefined;
        if (status) {
          await this.upsert(
            status,
            Array.isArray(msg["queue"]) ? (msg["queue"] as MusicSong[]) : undefined,
          );
          this.notify();
        }
        break;
      }
      case "botConnected":
      case "botDisconnected": {
        const status = msg["status"] as MusicBotStatus | undefined;
        if (status) {
          await this.upsert(status);
          this.notify();
        }
        break;
      }
      case "botRemoved": {
        const id = msg["botId"];
        if (typeof id === "string") {
          this.bots.delete(id);
          this.notify();
        }
        break;
      }
      default:
        break;
    }
  }

  private notify(): void {
    const list = this.summaries();
    for (const l of this.listeners) l(list);
  }
}
