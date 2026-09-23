/**
 * One TeamSpeak client connection driven on behalf of one browser.
 *
 * Wraps @honeybbq/teamspeak-client, keeps an authoritative channel/client
 * model built from the raw command stream, and emits protocol messages the
 * browser understands.
 */
import {
  Client,
  generateIdentity,
  getClientInfo,
  identityFromString,
  poke as tsPoke,
  sendTextMessage,
  ServerError,
  type Identity,
  type Logger as TsLogger,
} from "@honeybbq/teamspeak-client";
import type {
  LogLevel,
  ServerMessage,
  TsChannel,
  TsClient,
  TsGroup,
  TsServerInfo,
  WhisperTarget,
} from "@jinz/protocol";
import { encodeTextCode, TS_CMD_HUB_CODES } from "@jinz/protocol";
import type { Logger } from "../logger.js";
import { tapRawCommands, type RawCommand } from "./raw.js";
import { forgetCachedAsset, getCachedAsset, setCachedAsset } from "./asset-cache.js";
import { relinkOnEnter, relinkOnLeave, relinkOnMove, type OrderFix } from "./channel-order.js";
import { subscribeNewChannel } from "./channel-subscribe.js";
import {
  channelFromParams,
  channelPatchFromParams,
  clientFromParams,
  clientPatchFromParams,
  connectionIpOf,
  detectFlavor,
  groupFromParams,
  serverInfoFromParams,
  serverPatchFromParams,
} from "./parse.js";
import { pinnedResolver, resolveDialTarget, type LookupFn } from "./dial-target.js";
import {
  buildTsCommand,
  checkCommandText,
  repairDirectRows,
  TS_CMD_TIMEOUT_MS,
  TsCommandFailure,
  TsCommandRefused,
  type PreparedCommand,
} from "./commands.js";
import { channelPasswordHash } from "./channel-commands.js";
import { PacedRequests } from "./paced-requests.js";
import {
  getCachedCatalog,
  parsePermissionList,
  setCachedCatalog,
  type PermCatalog,
} from "./perms.js";
import { OwnPermissions } from "./own-perms.js";
import { avatarMatches, avatarPath, isAvatarHash } from "./avatar.js";
import { collectCapped } from "./capped-download.js";
import { INTERNAL_AVATAR_MAX_BYTES, INTERNAL_ICON_MAX_BYTES } from "../files/internal-limits.js";
import { guardFor, isFloodBan, TS_CMD_MAX_WAIT_MS, type ServerGuard } from "./server-guard.js";
import { selfBanNotice } from "./ban-notice.js";
import { foldGroupRow } from "./group-list.js";
import { clientsHiddenByUnsubscribe, REASON_LEFT_VIEW } from "./subscriptions.js";
import { FtWaiters, type FtStart } from "../files/ft-waiters.js";
import {
  encodeWhisperPayload,
  keepVisibleTargets,
  PACKET_FLAG_UNENCRYPTED,
  PACKET_TYPE_VOICE_WHISPER,
} from "./whisper.js";
import {
  ftDeleteText,
  ftInitDownloadText,
  ftInitUploadText,
  type FtTarget,
  type FtUploadTarget,
} from "../files/ft-init.js";

export interface TsSessionOptions {
  host: string;
  port: number;
  nickname: string;
  identity?: string;
  serverPassword?: string;
  defaultChannel?: string;
  defaultChannelPassword?: string;
  logger: Logger;
  /** Minimum identity security level to reach before connecting (TS3 default 8). */
  securityLevel?: number;
  /** Per-attempt handshake timeout. A lost UDP init packet trips this. */
  connectTimeoutMs?: number;
  /** How many handshake attempts before giving up. */
  connectRetries?: number;
  /** Allow targets that resolve to loopback/private ranges (development only). */
  allowPrivateTargets?: boolean;
  /** Injectable DNS lookup (tests); defaults to `dns.lookup` with every answer. */
  lookup?: LookupFn;
  /** Run `channelsubscribeall` once connected (default true; see ConnectRequest). */
  subscribeAll?: boolean;
  /**
   * Where to dial the server's file port (HUB_FT_HOST), when it is not the
   * address the voice connection uses. Unset: that same, vetted address.
   */
  fileTransferHost?: string;
}

export interface TsSessionHandlers {
  onMessage: (msg: ServerMessage) => void;
  /** `whisper`: the frame was whispered to us rather than said in the channel. */
  onVoice: (clientId: number, codec: number, data: Uint8Array, whisper: boolean) => void;
  onClosed: (reason: string) => void;
  /** Fired with the initial channel after the snapshot and on every own channel change. */
  onSelfChannel?: (channelId: string) => void;
}

const DEFAULT_SECURITY_LEVEL = 8;
const DEFAULT_CONNECT_TIMEOUT_MS = 8_000;
const DEFAULT_CONNECT_RETRIES = 4;
/**
 * How long our client id still counts as the hub's after the session ends: a
 * client that dropped rather than left stays on the server (as "connection
 * lost") for about 20 s, and banning that ghost would ban the hub's address.
 */
const HUB_CLIENT_GRACE_MS = 60_000;
/** How long a transfer init may wait for its slot and the server's answer. */
const FT_INIT_TIMEOUT_MS = TS_CMD_MAX_WAIT_MS + 10_000;
/** How long one icon/avatar download may take; past it the pace queue moves on. */
const ASSET_DOWNLOAD_TIMEOUT_MS = 30_000;
/** How many clients claiming one avatar hash are tried before it counts as nobody's. */
const AVATAR_HOLDERS_TRIED = 3;
/** How long a hash no file matched is remembered (a new avatar is announced right after its upload). */
const AVATAR_MISMATCH_TTL_MS = 60_000;

/** One channel-0 download: the file, no such file, or not asked for at all. */
type InternalDownload = { kind: "file"; data: Buffer } | { kind: "missing" } | { kind: "skipped" };

const MISSING: InternalDownload = { kind: "missing" };
const SKIPPED: InternalDownload = { kind: "skipped" };

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A server-side rejection of the connection handshake (never worth retrying). */
class HandshakeRejected extends Error {
  constructor(
    readonly id: string,
    serverMessage: string,
    readonly extraMessage?: string,
  ) {
    super(friendlyServerError(id, serverMessage, extraMessage));
    this.name = "HandshakeRejected";
  }
}

/** Both helpers return text codes the web client translates; see text-code.ts. */
function friendlyServerError(id: string, serverMessage: string, extraMessage?: string): string {
  // Not the user's ban: the server's anti-flood banned the hub's address, and
  // with it every web user (see server-guard.ts).
  if (isFloodBan(id, extraMessage)) return "hub.tsFloodBanned";
  switch (id) {
    case "521":
      return "hub.tsCloneLimit";
    case "3329":
      return "hub.tsBanned";
    case "781":
      return "hub.tsChannelPassword";
    case "515":
      return "hub.tsServerPassword";
    default:
      return encodeTextCode("hub.tsRejected", { reason: serverMessage, id });
  }
}

function friendlyConnectError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError") return "hub.connectTimeout";
    if (/ENOTFOUND|EAI_AGAIN/.test(err.message)) return "hub.connectDnsFailed";
    if (/ECONNREFUSED/.test(err.message)) return "hub.connectRefused";
    return err.message;
  }
  return String(err);
}

/**
 * Pins the library's idea of our own client id.
 *
 * @honeybbq/teamspeak-client detects its own enter-view by nickname: any client
 * whose nickname is ours plus optional digits is treated as "me" (to cope with
 * the server renaming duplicates to Name1). It keeps doing that after the
 * welcome sequence, so when someone named e.g. "Tom2" (or a second "Tom", which
 * the server renames) joins while we are "Tom", the library switches its client
 * id to theirs, every packet we send from then on carries the wrong id, and the
 * server drops us ~20 s later as "connection lost". The server told us our id
 * in `initserver`, so once connected we simply refuse to change it.
 */
export function lockClientId(client: Client, selfId: number, log: Logger): void {
  const handler = client.handler;
  const original = handler.setClientID.bind(handler);
  handler.setClientID = (id: number) => {
    if (id !== selfId) {
      log.debug({ selfId, attempted: id }, "ignored client id reassignment (nickname clash)");
      return;
    }
    original(id);
  };
  original(selfId);
  Object.defineProperty(client, "clid", {
    configurable: true,
    enumerable: true,
    get: () => selfId,
    set: (id: number) => {
      if (id !== selfId) log.debug({ selfId, attempted: id }, "ignored clid reassignment");
    },
  });
}

function stringifyArg(a: unknown): string {
  if (typeof a === "string") return a;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

/** Fields of server commands the protocol trace leaves out. */
const TRACE_SECRETS = new Set(["ftkey"]);

/** TeamSpeak's "flood ban" error id. */
const TS_FLOOD_ID = "3331";

export class TsSession {
  /** Set by setInputMuted: voice from the page is dropped while true. */
  private inputMuted = false;
  /** Where whispered frames go (see setWhisperTarget); null: nowhere, they are dropped. */
  private whisperTarget: WhisperTarget | null = null;
  /** Our own count of whisper packets, for the id field real clients fill in. */
  private whisperVid = 0;
  private client: Client | null = null;
  private identity: Identity | null = null;
  private untap: (() => void) | null = null;
  private readonly log: Logger;

  private readonly channels = new Map<string, TsChannel>();
  private readonly clients = new Map<number, TsClient>();
  private readonly serverGroups = new Map<string, TsGroup>();
  private readonly channelGroups = new Map<string, TsGroup>();
  private serverInfo: TsServerInfo | null = null;
  private selfId = 0;
  private snapshotSent = false;
  private closed = false;
  private connected = false;
  private pendingConnectReject: ((err: Error) => void) | null = null;
  /** The address the guard resolved; the only thing the driver ever dials. */
  private dialAddress: string | null = null;
  /** Icon/avatar byte cache and in-flight downloads, keyed by internal file path. */
  /** Serialises paced work (file transfers) so bursts never hit the server. */
  /** Set when the server reports flooding; downloads pause until then. */
  /**
   * `ts.cmd` work runs one command at a time: answers that arrive as
   * notifications carry nothing tying them to the command that asked, so two
   * list commands in flight at once could not tell their rows apart.
   */
  private cmdQueue: Promise<void> = Promise.resolve();
  /** The notification the running command's answer arrives as, and its rows so far. */
  private collector: { name: string; rows: Record<string, string>[] } | null = null;
  /** Our file transfer inits waiting for the server's notify (see ft-waiters.ts). */
  private readonly ftWaiters = new FtWaiters();
  /** `failed_permid` of the latest error line (the library drops that field). */
  private lastFailedPermId: number | null = null;
  private catalogLoad: Promise<PermCatalog> | null = null;
  /** The client id this session registered with the guard as the hub's own (0 = none). */
  private hubClientId = 0;
  /**
   * What this session sends on its own when others change channels (see
   * paced-requests.ts): new channels are subscribed in batches, descriptions
   * fetched one at a time, both paced hub-wide and skipped while flooded.
   */
  private readonly newChannelSubscribes = new PacedRequests({
    guard: () => this.guard,
    batch: true,
    send: (cids) =>
      this.exec(
        buildTsCommand(
          "channelsubscribe",
          {},
          cids.map((cid) => ({ cid })),
        ),
      ),
    onError: (err, cids) => this.log.debug({ err, cids }, "channelsubscribe (new channel) failed"),
  });
  private readonly descriptionFetches = new PacedRequests({
    guard: () => this.guard,
    batch: false,
    send: ([cid]) => this.exec(buildTsCommand("channelgetdescription", { cid: cid! })),
    onError: (err, cids) => this.log.debug({ err, cids }, "channelgetdescription failed"),
  });
  private readonly ownPerms = new OwnPermissions({
    catalog: () => this.permissionCatalog(),
    permget: (names) =>
      this.guard.paced(() =>
        this.runCommand({
          text: buildTsCommand(
            "permget",
            {},
            names.map((permsid) => ({ permsid })),
          ),
          collect: null,
        }),
      ),
    emit: (msg) => this.emit(msg),
    onError: (err) => this.log.warn({ err }, "own permissions incomplete"),
  });

  constructor(
    private readonly opts: TsSessionOptions,
    private readonly handlers: TsSessionHandlers,
  ) {
    this.log = opts.logger;
  }

  get selfClientId(): number {
    return this.selfId;
  }

  get endpoint(): { host: string; port: number } {
    return { host: this.opts.host, port: this.opts.port };
  }

  get selfUid(): string {
    return this.clients.get(this.selfId)?.uid ?? "";
  }

  get selfNickname(): string {
    return this.clients.get(this.selfId)?.nickname ?? this.opts.nickname;
  }

  get selfChannelId(): string | null {
    return this.clients.get(this.selfId)?.channelId ?? null;
  }

  getChannel(id: string): TsChannel | undefined {
    return this.channels.get(id);
  }

  getClient(id: number): TsClient | undefined {
    return this.clients.get(id);
  }

  /** Downloads an icon by its (unsigned) id from the server's internal storage. */
  async fetchIcon(iconId: number): Promise<Buffer | null> {
    const id = iconId >>> 0;
    if (id === 0) return null;
    const path = `/icon_${id}`;
    return this.cachedAsset(path, async () => {
      const got = await this.download(path, INTERNAL_ICON_MAX_BYTES);
      if (got.kind === "skipped") return null;
      // A miss is remembered too, so a missing icon is not asked for on every render.
      return { data: got.kind === "file" ? got.data : null };
    });
  }

  /**
   * Downloads the avatar whose `client_flag_avatar` is `hash`. The file is
   * named after its owner (see avatar.ts), so the hash is looked up among the
   * clients we can see: that also keeps the route from fetching the avatar of
   * anyone this session does not see. Cached per hash, so a new avatar is
   * fetched as soon as its owner announces it.
   *
   * The flag is free text to the server, so several clients may claim one
   * hash: each is tried (a few at most) and only the file whose MD5 is that
   * hash is served. When none is, the hash is remembered as nobody's for a
   * short while, so a rotating flag cannot make every session download again.
   */
  async fetchAvatar(hash: string): Promise<Buffer | null> {
    const key = hash.toLowerCase();
    if (!isAvatarHash(key)) return null;
    const paths = [...new Set([...this.clients.values()].filter((c) => c.avatar === key))]
      .map((c) => avatarPath(c.uid))
      .filter((path): path is string => path !== null)
      .slice(0, AVATAR_HOLDERS_TRIED);
    if (paths.length === 0) return null;
    return this.cachedAsset(`avatar#${key}`, async () => {
      let skipped = false;
      for (const path of paths) {
        const got = await this.download(path, INTERNAL_AVATAR_MAX_BYTES);
        if (got.kind === "file" && avatarMatches(got.data, key)) return { data: got.data };
        if (got.kind === "skipped") skipped = true;
      }
      // Nothing to remember while the hub was not allowed to ask.
      return skipped ? null : { data: null, ttlMs: AVATAR_MISMATCH_TTL_MS };
    });
  }

  /**
   * Forgets a cached channel-0 file (an icon uploaded or deleted through the
   * hub), for every session on this server: a miss is otherwise remembered
   * for minutes, a hit for hours. Avatars are cached by hash and need none.
   */
  forgetAsset(path: string): void {
    forgetCachedAsset(this.serverKey, path);
  }

  /**
   * The cache (and in-flight dedupe) around one channel-0 result: `load`
   * runs once per key however many sessions ask, and says what to remember
   * (null: nothing, because the hub was not allowed to ask).
   */
  private async cachedAsset(
    cacheKey: string,
    load: () => Promise<{ data: Buffer | null; ttlMs?: number } | null>,
  ): Promise<Buffer | null> {
    const cached = getCachedAsset(this.serverKey, cacheKey);
    if (cached !== undefined) return cached;
    const guard = this.guard;
    const inflight = guard.inflight.get(cacheKey);
    if (inflight) return inflight;
    if (!this.client || !this.connected) return null;

    const task = (async (): Promise<Buffer | null> => {
      try {
        const result = await load();
        if (result) setCachedAsset(this.serverKey, cacheKey, result.data, result.ttlMs);
        return result?.data ?? null;
      } finally {
        guard.inflight.delete(cacheKey);
      }
    })();
    guard.inflight.set(cacheKey, task);
    return task;
  }

  /**
   * Downloads one file from channel 0 (the server's internal file store).
   *
   * Downloads run one at a time with a short gap: every download costs a
   * `ftinitdownload` command, and a burst of them (a fresh browser rendering a
   * dozen icons) trips TeamSpeak's anti-flood protection, which silently stops
   * answering the offending client. They are optional work, so the hub refuses
   * them rather than let the queue grow without end.
   *
   * The bytes are held whole (they go into the hub-wide cache), so anything
   * past `maxBytes` — announced or sent — counts as not there.
   */
  private async download(path: string, maxBytes: number): Promise<InternalDownload> {
    try {
      return await this.guard.paced(
        async (): Promise<InternalDownload> => {
          const client = this.client;
          if (!client || !this.connected) return SKIPPED;
          // Not a miss: the file is there, we just may not ask now.
          if (this.guard.flooded) return SKIPPED;
          try {
            const info = await client.fileTransferInitDownload(0n, path, "");
            if (info.size > BigInt(maxBytes)) {
              this.log.debug({ path, size: String(info.size), maxBytes }, "channel-0 file too big");
              return MISSING;
            }
            const host = this.dialAddress ?? this.opts.host;
            const data = await collectCapped(
              (sink) => client.downloadFileData(host, info, sink),
              maxBytes,
              ASSET_DOWNLOAD_TIMEOUT_MS,
            );
            return { kind: "file", data };
          } catch (err) {
            this.log.debug({ err, path }, "file download failed");
            return MISSING;
          }
        },
        { optional: true },
      );
    } catch (err) {
      this.log.debug({ err, path }, "file download not started");
      return SKIPPED;
    }
  }

  /* ---------------------------- file transfers ---------------------------- */

  /** Where the server's file port is dialled (see TsSessionOptions.fileTransferHost). */
  get fileTransferHost(): string {
    return this.opts.fileTransferHost || this.dialAddress || this.opts.host;
  }

  /** Asks the server for a download; resolves with the key for its file port. */
  initFileDownload(target: FtTarget): Promise<FtStart> {
    return this.initFileTransfer((id) => ftInitDownloadText(id, target));
  }

  /** Asks the server to take an upload of `target.size` bytes. */
  initFileUpload(target: FtUploadTarget): Promise<FtStart> {
    return this.initFileTransfer((id) => ftInitUploadText(id, target));
  }

  /** Deletes one file; the file routes use it to clean up after a cancelled upload. */
  async deleteFile(target: FtTarget): Promise<void> {
    const text = ftDeleteText(target);
    const waited = await this.guard.tsCmdSlot();
    await this.runCommand({ text, collect: null }, TS_CMD_TIMEOUT_MS - waited);
  }

  /**
   * One transfer init. Every one is a command on the server from the hub's
   * single address, so it spends the hub-wide `ts.cmd` budget (and refuses
   * while the server is flooding, see runCommand), whoever asks. The answer
   * is a notify, matched by our transfer id (ft-waiters.ts).
   */
  private async initFileTransfer(build: (clientFtId: number) => string): Promise<FtStart> {
    const { id, promise } = this.ftWaiters.register(FT_INIT_TIMEOUT_MS);
    try {
      const text = build(id);
      const waited = await this.guard.tsCmdSlot();
      await this.runCommand({ text, collect: null }, TS_CMD_TIMEOUT_MS - waited);
    } catch (err) {
      this.ftWaiters.cancel(id, err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
    return promise;
  }

  /** A permission's value when the server told us (see own-perms.ts); undefined otherwise. */
  ownPermission(name: string): number | undefined {
    return this.ownPerms.lookup(name, getCachedCatalog(this.serverKey));
  }

  private get serverKey(): string {
    return `${this.opts.host.toLowerCase()}:${this.opts.port}`;
  }

  /** Traffic control shared with every other session on this server (see server-guard.ts). */
  get guard(): ServerGuard {
    return guardFor(this.serverKey);
  }

  /** Runs server-side file/command work one at a time with a minimum spacing. */
  private emitLog(level: LogLevel, scope: string, message: string): void {
    this.log[level]({ scope }, message);
    // Every line, including the verbose protocol trace, is streamed to the
    // browser; the log console decides what to show.
    this.emit({ type: "log", level, scope, message, at: Date.now() });
  }

  /** Forwards the library's own handshake logging to the browser at its real level. */
  private makeTsLogger(): TsLogger {
    const fwd =
      (level: LogLevel) =>
      (message: string, ...args: unknown[]) => {
        const suffix = args.length ? " " + args.map((a) => stringifyArg(a)).join(" ") : "";
        this.emitLog(level, "protocol", message + suffix);
      };
    return { debug: fwd("debug"), info: fwd("info"), warn: fwd("warn"), error: fwd("error") };
  }

  /** Connects (with retry), subscribes to all channels and emits `connected` + `snapshot`. */
  async connect(): Promise<void> {
    const identity = this.prepareIdentity();
    const level = this.opts.securityLevel ?? DEFAULT_SECURITY_LEVEL;
    if (identity.securityLevel() < level) {
      this.emitLog("info", "identity", `正在计算身份安全等级（目标 ${level}）…`);
      await identity.upgradeToLevel(level);
    }
    this.identity = identity;

    const addr = `${this.opts.host}:${this.opts.port}`;
    // Resolved once, before the driver gets to. Node's dgram fires the
    // `connect` success callback *and* an `error` event when a lookup fails,
    // leaving the socket disconnected; the driver's callback then calls
    // `send(buf, cb)`, which dgram reads as `send(buf, port, ...)` and throws
    // ERR_SOCKET_BAD_PORT synchronously inside its own callback. That escapes
    // every try/catch on the way in and takes the whole hub down, so a bad
    // hostname must never reach the driver — and the address that passed the
    // private-range guard is the one it dials (see dial-target.ts).
    const { address } = await resolveDialTarget(this.opts.host, {
      lookup: this.opts.lookup,
      allowPrivate: this.opts.allowPrivateTargets ?? false,
    });
    this.dialAddress = address;
    const attempts = Math.max(1, this.opts.connectRetries ?? DEFAULT_CONNECT_RETRIES);
    const perAttempt = this.opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;

    // Dialling a server that just banned the hub for flooding only prolongs
    // the ban, for everyone. Refuse locally until the cool-down has passed.
    const cooldown = this.guard.banCooldownMs;
    if (cooldown > 0) {
      const detail = encodeTextCode("hub.tsFloodCooldown", {
        seconds: String(Math.ceil(cooldown / 1000)),
      });
      this.emitLog("error", "connect", `连接失败：${detail}`);
      throw new Error(detail);
    }

    this.emit({ type: "connecting" });
    this.emitLog("info", "connect", `正在连接 ${addr}（已解析为 ${address}）…`);

    let lastErr: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (this.closed) return;
      try {
        // After a hub restart every open tab reconnects at once; start the
        // handshakes one at a time instead of as a burst from one address.
        await this.guard.connectSlot();
        if (this.closed) return;
        await this.attempt(identity, addr, address, perAttempt, attempt, attempts);
        return;
      } catch (err) {
        lastErr = err;
        this.teardownClient();
        if (err instanceof HandshakeRejected && isFloodBan(err.id, err.extraMessage)) {
          this.guard.noteFloodBan();
        }
        // Only a lost/dropped handshake (timeout) is worth retrying. A server
        // rejection (banned, clone limit, wrong password) will fail identically
        // on every retry and just wastes time / adds clones, so fail fast.
        const isTimeout = err instanceof Error && err.name === "TimeoutError";
        if (attempt < attempts && isTimeout) {
          this.emitLog("warn", "connect", `第 ${attempt} 次握手超时，正在重试…`);
          await delay(400);
          continue;
        }
        const detail = err instanceof HandshakeRejected ? err.message : friendlyConnectError(err);
        this.emitLog("error", "connect", `连接失败：${detail}`);
        throw err instanceof HandshakeRejected ? new Error(detail) : err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  /** A single connect attempt against a fresh client. Populates the model and emits on success. */
  private async attempt(
    identity: Identity,
    addr: string,
    dialAddress: string,
    timeoutMs: number,
    attempt: number,
    attempts: number,
  ): Promise<void> {
    // Each attempt starts from a clean model and a fresh client.
    this.channels.clear();
    this.clients.clear();
    this.serverGroups.clear();
    this.channelGroups.clear();
    this.serverInfo = null;
    this.selfId = 0;
    this.ownPerms.reset();
    this.whisperTarget = null;

    const client = new Client(identity, addr, this.opts.nickname, {
      logger: this.makeTsLogger(),
      // The driver would otherwise resolve the name again (SRV, TSDNS, A);
      // pin it to the address the guard already vetted.
      resolver: pinnedResolver(dialAddress, this.opts.port),
      serverPassword: this.opts.serverPassword,
      defaultChannel: this.opts.defaultChannel,
      defaultChannelPassword: this.opts.defaultChannelPassword,
    });
    this.client = client;

    client.on("voiceData", (v) => {
      // `whisper` comes from patches/@honeybbq+teamspeak-client: the driver
      // itself hands voice and whispers over alike.
      if (!this.closed) this.handlers.onVoice(v.clientId, v.codec, v.data, v.whisper === true);
    });
    client.on("kicked", (message) => {
      if (this.client === client)
        this.emit({ type: "error", code: "kicked", message, fatal: true });
    });
    client.on("disconnected", (err) => {
      // Ignore the disconnect of a client we tore down for a retry.
      if (this.client === client) this.finish(err ? err.message : "hub.byeDropped");
    });

    if (attempt > 1) this.emitLog("info", "connect", `第 ${attempt}/${attempts} 次尝试握手…`);
    // connect() synchronously rebuilds the packet handler (its #C reset), so the
    // raw tap must be installed AFTER connect() is invoked, or it binds a handler
    // that is immediately thrown away and never sees any server command.
    const connecting = client.connect();
    this.untap = tapRawCommands(client, (cmd) => this.onRaw(cmd));
    await connecting;

    // Race the handshake against a server rejection (error command during
    // connect), so a clone-limit/ban surfaces immediately instead of timing out.
    this.connected = false;
    const rejected = new Promise<never>((_, reject) => {
      this.pendingConnectReject = reject;
    });
    const waited = client.waitConnected(AbortSignal.timeout(timeoutMs));
    waited.catch(() => undefined); // the race loser must not become an unhandled rejection
    try {
      await Promise.race([waited, rejected]);
    } finally {
      this.pendingConnectReject = null;
    }
    this.connected = true;
    this.selfId = client.clientID();
    if (this.selfId > 0) {
      lockClientId(client, this.selfId, this.log);
      // Bans on this id would hit the hub's address (see commands.ts banRefusal).
      this.hubClientId = this.selfId;
      this.guard.addHubClient(this.selfId);
    }
    this.emitLog("info", "connect", `握手完成，本机客户端 ID ${this.selfId}`);

    if (this.opts.subscribeAll ?? true) {
      try {
        await client.execCommand("channelsubscribeall", 10_000);
      } catch (err) {
        this.emitLog("warn", "connect", "channelsubscribeall 失败，频道成员可能不全");
        this.log.warn({ err }, "channelsubscribeall failed");
      }
    }

    if (this.closed) return;
    // Joining subscribes silently (see subscriptions.ts); without this our
    // own channel would look unsubscribed whenever subscribe-all is off.
    const joined = this.channels.get(this.clients.get(this.selfId)?.channelId ?? "");
    if (joined) joined.subscribed = true;
    const server = this.serverInfo ?? serverInfoFromParams({}, "unknown");
    this.emit({
      type: "connected",
      selfClientId: this.selfId,
      identity: identity.toString(),
      uid: this.clients.get(this.selfId)?.uid ?? "",
      server,
    });
    this.emit({
      type: "snapshot",
      channels: [...this.channels.values()],
      clients: [...this.clients.values()],
      serverGroups: [...this.serverGroups.values()],
      channelGroups: [...this.channelGroups.values()],
    });
    this.snapshotSent = true;
    // Only now: naming the permissions costs a `permissionlist` round trip.
    this.ownPerms.start();
    void this.learnHubAddress();
    this.emitLog(
      "info",
      "connect",
      `已进入「${server.name || this.opts.host}」，${this.channels.size} 个频道 / ${this.clients.size} 人在线`,
    );
    const own = this.selfChannelId;
    if (own) this.handlers.onSelfChannel?.(own);
  }

  /**
   * Once per server (a session that finds it known skips this): asks the
   * server which address it sees for us, so an IP ban on the hub can be
   * refused (commands.ts banRefusal). Optional traffic, paced like the rest.
   */
  private async learnHubAddress(): Promise<void> {
    const guard = this.guard;
    const self = this.selfId;
    if (guard.hubAddress || self <= 0) return;
    try {
      const rows = await guard.paced(async () => {
        if (guard.hubAddress || guard.flooded || !this.connected) return [];
        return this.runCommand({
          text: buildTsCommand("getconnectioninfo", { clid: String(self) }),
          collect: "notifyconnectioninfo",
        });
      });
      const ip = connectionIpOf(rows, self);
      if (ip) guard.noteHubAddress(ip);
    } catch (err) {
      this.log.debug({ err }, "getconnectioninfo (own address) failed");
    }
  }

  /** Lets our client id stop counting as the hub's, once a ghost of it would be gone too. */
  private releaseHubClient(): void {
    const id = this.hubClientId;
    if (!id) return;
    this.hubClientId = 0;
    const guard = this.guard;
    setTimeout(() => guard.removeHubClient(id), HUB_CLIENT_GRACE_MS).unref();
  }

  /** Detaches the tap and drops the current client without emitting a disconnect. */
  private teardownClient(): void {
    this.releaseHubClient();
    this.newChannelSubscribes.clear();
    this.descriptionFetches.clear();
    this.ftWaiters.clear();
    this.untap?.();
    this.untap = null;
    const client = this.client;
    this.client = null;
    if (client) void client.disconnect().catch(() => undefined);
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    if (!client) {
      this.finish("hub.byeClosed");
      return;
    }
    try {
      await client.disconnect();
    } catch {
      /* ignore */
    }
    this.finish("hub.byeClosed");
  }

  /* ------------------------------ commands ------------------------------ */

  async moveTo(channelId: string, password?: string): Promise<void> {
    const params: Record<string, string> = { clid: String(this.selfId), cid: channelId };
    if (password) params["cpw"] = channelPasswordHash(password);
    await this.exec(buildTsCommand("clientmove", params));
  }

  async sendText(targetMode: 1 | 2 | 3, targetId: string, message: string): Promise<void> {
    // The library builds these two itself; the same characters are refused (see commands.ts).
    checkCommandText(message);
    await sendTextMessage(this.requireClient(), targetMode, BigInt(targetId || "0"), message);
  }

  async poke(clientId: number, message: string): Promise<void> {
    checkCommandText(message);
    await tsPoke(this.requireClient(), clientId, message);
  }

  async setInputMuted(muted: boolean): Promise<void> {
    // Stop forwarding before the server has even answered: the flag alone is
    // cosmetic, and the page may still have audio in flight.
    this.inputMuted = muted;
    try {
      await this.exec(buildTsCommand("clientupdate", { client_input_muted: muted ? "1" : "0" }));
    } catch (err) {
      // Unmuting failed: stay muted, which is the safe side. Muting failed:
      // keep dropping audio anyway, the user asked for silence.
      if (!muted) {
        this.inputMuted = true;
        // The page flipped its button before asking; the server flag never
        // changed, so no update would arrive to put it back. Say it ourselves,
        // or the user sees "unmuted" while nobody can hear them.
        this.emit({ type: "client.updated", clientId: this.selfId, patch: { inputMuted: true } });
      }
      throw err;
    }
  }

  async setOutputMuted(muted: boolean): Promise<void> {
    await this.exec(buildTsCommand("clientupdate", { client_output_muted: muted ? "1" : "0" }));
  }

  async setAway(away: boolean, message = ""): Promise<void> {
    await this.exec(
      buildTsCommand("clientupdate", {
        client_away: away ? "1" : "0",
        client_away_message: away ? message : "",
      }),
    );
  }

  async setNickname(nickname: string): Promise<void> {
    await this.exec(buildTsCommand("clientupdate", { client_nickname: nickname }));
  }

  /**
   * Asks for a channel's description; the answer arrives as a channel edit
   * (`channel.description`). Paced hub-wide and coalesced per channel, since
   * a page asks again whenever someone changes it (paced-requests.ts).
   */
  requestChannelDescription(channelId: string): Promise<void> {
    return this.descriptionFetches.request(channelId);
  }

  async fetchClientInfo(clientId: number): Promise<Record<string, string>> {
    const raw = await getClientInfo(this.requireClient(), clientId);
    // Another of our sessions, seen by someone allowed to see addresses: that is the hub's.
    const ip = raw["connection_client_ip"];
    if (ip && this.guard.isHubClient(clientId)) this.guard.noteHubAddress(ip);
    return raw;
  }

  /**
   * Runs one prepared `ts.cmd` (see commands.ts) and returns its rows: the
   * collected notification rows for list commands, the plain answer rows
   * otherwise. A TeamSpeak error comes back as a TsCommandFailure naming the
   * permission it checked, when the server said.
   */
  runCommand(
    prepared: PreparedCommand,
    timeoutMs = TS_CMD_TIMEOUT_MS,
  ): Promise<Record<string, string>[]> {
    const run = this.cmdQueue.then(async () => {
      // Every session shares this hub's address with the server: after one
      // flood warning, more commands would get all of them banned. Answer as
      // the server would until the backoff runs out.
      if (this.guard.flooded) {
        throw new TsCommandFailure(TS_FLOOD_ID, "flood protection (hub backoff)", null);
      }
      const client = this.client;
      if (!client) {
        throw new TsCommandRefused(TS_CMD_HUB_CODES.notConnected, "tsErr.notConnected");
      }
      const collector = prepared.collect ? { name: prepared.collect, rows: [] } : null;
      this.collector = collector;
      this.lastFailedPermId = null;
      try {
        const direct = repairDirectRows(
          await client.execCommandWithResponse(prepared.text, timeoutMs),
          prepared.firstField,
        );
        return [...(collector?.rows ?? []), ...direct];
      } catch (err) {
        if (err instanceof ServerError) {
          throw new TsCommandFailure(err.id, err.serverMessage, this.lastFailedPermId);
        }
        throw err;
      } finally {
        if (this.collector === collector) this.collector = null;
      }
    });
    this.cmdQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** This server's permission list, fetched once and shared hub-wide (see perms.ts). */
  permissionCatalog(): Promise<PermCatalog> {
    const cached = getCachedCatalog(this.serverKey);
    if (cached) return Promise.resolve(cached);
    // Guests usually may not list permissions; asking again on every connect
    // of every session only spends anti-flood points on a known refusal.
    if (this.guard.catalogRefused) {
      return Promise.reject(new Error("permission list refused recently"));
    }
    // Every caller during the fetch shares it; a failed fetch is forgotten so
    // the next caller may try again.
    const guard = this.guard;
    this.catalogLoad ??= guard
      .paced(() => this.runCommand({ text: "permissionlist", collect: "notifypermissionlist" }))
      .catch((err: unknown) => {
        if (err instanceof TsCommandFailure) guard.noteCatalogRefused();
        throw err;
      })
      .then((rows) => {
        const catalog = parsePermissionList(rows);
        if (catalog.entries.length === 0) throw new Error("empty permission list");
        setCachedCatalog(this.serverKey, catalog);
        return catalog;
      })
      .finally(() => {
        this.catalogLoad = null;
      });
    return this.catalogLoad;
  }

  sendVoice(data: Uint8Array, codec: number): void {
    // The mute button promises silence; TeamSpeak's input-muted flag alone
    // does not stop a client's packets. The empty end-of-talk frame still goes
    // through so others' talk indicators settle.
    if (this.inputMuted && data.length > 0) return;
    this.client?.sendVoice(data, codec);
  }

  /**
   * Sets who whispered frames go to, keeping only channels in our tree and
   * clients we can see (never ourselves). Returns what was kept; nothing kept,
   * or null, stops whispering.
   */
  setWhisperTarget(target: WhisperTarget | null): WhisperTarget {
    const kept = target
      ? keepVisibleTargets(target, {
          selfId: this.selfId,
          hasChannel: (id) => this.channels.has(id),
          hasClient: (id) => this.clients.has(id),
        })
      : { channels: [], clients: [] };
    const empty = kept.channels.length === 0 && kept.clients.length === 0;
    this.whisperTarget = empty ? null : kept;
    return kept;
  }

  /**
   * One whispered frame to the current target. The driver has no whisper
   * call, but its generic `handler.sendPacket` carries one as it is (checked
   * on a live server); mute applies exactly as it does to voice.
   */
  sendWhisper(data: Uint8Array, codec: number): void {
    const target = this.whisperTarget;
    const client = this.client;
    if (!target || !client || !this.connected) return;
    if (this.inputMuted && data.length > 0) return;
    this.whisperVid = (this.whisperVid + 1) & 0xffff;
    try {
      const payload = encodeWhisperPayload({ vid: this.whisperVid, codec, ...target, data });
      client.handler.sendPacket(PACKET_TYPE_VOICE_WHISPER, payload, PACKET_FLAG_UNENCRYPTED);
    } catch (err) {
      this.log.warn({ err }, "whisper send failed");
    }
  }

  /* ------------------------------ internals ------------------------------ */

  private prepareIdentity(): Identity {
    if (this.opts.identity) {
      try {
        return identityFromString(this.opts.identity);
      } catch (err) {
        this.log.warn({ err }, "stored identity invalid; generating a new one");
      }
    }
    return generateIdentity(this.opts.securityLevel ?? DEFAULT_SECURITY_LEVEL);
  }

  private requireClient(): Client {
    if (!this.client) throw new Error("not connected");
    return this.client;
  }

  private async exec(cmd: string): Promise<void> {
    await this.requireClient().execCommand(cmd, 10_000);
  }

  private emit(msg: ServerMessage): void {
    if (!this.closed) this.handlers.onMessage(msg);
  }

  private finish(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.untap?.();
    this.untap = null;
    this.ownPerms.reset();
    this.releaseHubClient();
    this.newChannelSubscribes.clear();
    this.descriptionFetches.clear();
    this.ftWaiters.clear();
    if (this.groupsEmitTimer) {
      clearTimeout(this.groupsEmitTimer);
      this.groupsEmitTimer = null;
    }
    this.handlers.onClosed(reason);
  }

  private onRaw(cmd: RawCommand): void {
    const p = cmd.params;
    // The tap runs before the library's own handler, so a command's notify
    // rows are all in by the time its `error` line settles the promise.
    if (this.collector && cmd.name === this.collector.name) {
      // The server tags the first row with our return_code; it means nothing to the page.
      const { return_code: _rc, ...row } = p;
      this.collector.rows.push(row);
    }
    // Transfer answers are ours alone; the library's own tracker ignores our ids.
    this.ftWaiters.onNotify(cmd.name, p);
    if (cmd.name === "error" && p["id"] !== "0") {
      const failed = Number(p["failed_permid"]);
      this.lastFailedPermId = Number.isInteger(failed) && failed > 0 ? failed : null;
    }
    if (cmd.name) {
      // Compact one-line trace of the protocol command, like a TS3 debug log.
      // A transfer key opens the file port for that transfer: not for logs.
      const keys = Object.entries(p)
        .slice(0, 6)
        .map(([k, v]) => (TRACE_SECRETS.has(k) ? `${k}=***` : v ? `${k}=${v}` : k))
        .join(" ");
      this.emitLog("debug", "recv", `${cmd.name} ${keys}`.trimEnd());
    }
    // A server `error` command arriving before we finish connecting means the
    // handshake was rejected (clone limit, ban, bad password...). Fail the
    // attempt fast instead of waiting for the timeout.
    if (cmd.name === "error" && !this.connected && this.pendingConnectReject) {
      const id = p["id"] ?? "0";
      if (id !== "0") {
        this.pendingConnectReject(
          new HandshakeRejected(id, p["msg"] ?? "connection refused", p["extra_msg"]),
        );
        this.pendingConnectReject = null;
        return;
      }
    }
    // 3331 = "flood ban": the server thinks we send commands too fast. Back off
    // optional traffic (icon downloads) and tell the user, since the server may
    // stop answering this client altogether if it continues.
    if (cmd.name === "error" && p["id"] === TS_FLOOD_ID) {
      // Every session shares the hub's address: quiet all of them, not just this one.
      this.guard.noteFlood();
      this.emitLog(
        "warn",
        "protocol",
        "服务器触发了防刷屏限制（flood），网关已暂停所有会话的图标下载等非必要请求 30 秒",
      );
    }
    switch (cmd.name) {
      case "notifyservergrouplist":
      case "notifychannelgrouplist": {
        // The server pushes the full list in the welcome sequence, on request
        // and after any group change; rows arrive one per batched segment and
        // a new list replaces the old one (see group-list.ts).
        const g = groupFromParams(p);
        if (!g) break;
        const target =
          cmd.name === "notifyservergrouplist" ? this.serverGroups : this.channelGroups;
        foldGroupRow(target, g, cmd.segment === 0);
        if (this.snapshotSent) this.scheduleGroupsEmit();
        break;
      }
      case "notifyclientneededpermissions": {
        this.ownPerms.add(Number(p["permid"]), Number(p["permvalue"]));
        break;
      }
      case "initserver": {
        const aclid = Number(p["aclid"] ?? p["clid"] ?? "0");
        if (aclid > 0) this.selfId = aclid;
        const flavor = detectFlavor(
          p["virtualserver_version"] ?? "",
          p["virtualserver_platform"] ?? "",
        );
        this.serverInfo = serverInfoFromParams(p, flavor);
        break;
      }
      case "channellist":
      case "notifychannelcreated": {
        const ch = channelFromParams(p);
        if (ch.id === "0") break;
        const existing = this.channels.get(ch.id);
        if (existing) ch.subscribed = existing.subscribed;
        // channellist rows already form consistent chains; a new channel pushes a neighbour down.
        const created = cmd.name === "notifychannelcreated" && !existing;
        const fixes = created ? relinkOnEnter(this.channels.values(), ch) : [];
        const subscribe = created && subscribeNewChannel(this.channels.values(), ch.parentId);
        this.channels.set(ch.id, ch);
        if (this.snapshotSent) this.emit({ type: "channel.added", channel: ch });
        this.applyOrderFixes(fixes);
        // Every session sees the new channel at once: paced and batched, see paced-requests.ts.
        if (subscribe) void this.newChannelSubscribes.request(ch.id);
        break;
      }
      case "notifychanneledited":
      case "notifychannelmoved": {
        const id = p["cid"];
        if (!id) break;
        const patch = channelPatchFromParams(p);
        if (patch.description !== undefined) {
          this.emit({ type: "channel.description", channelId: id, description: patch.description });
        }
        const before = this.channels.get(id);
        const fixes =
          before && (patch.parentId !== undefined || patch.order !== undefined)
            ? relinkOnMove(this.channels.values(), before, {
                id,
                parentId: patch.parentId ?? before.parentId,
                order: patch.order ?? before.order,
              })
            : [];
        this.patchChannel(id, patch);
        this.applyOrderFixes(fixes);
        break;
      }
      case "notifychanneldescriptionchanged": {
        // The text is not included. Fetching it here would be one command per
        // session per edit, all from the hub's address (a flood ban for
        // everyone when someone edits in a hurry); the page asks when it
        // actually shows the description, see requestChannelDescription.
        const id = p["cid"];
        if (!id) break;
        this.patchChannel(id, { description: undefined });
        if (this.snapshotSent) this.emit({ type: "channel.descriptionChanged", channelId: id });
        break;
      }
      case "notifychanneldeleted": {
        const id = p["cid"];
        const gone = id ? this.channels.get(id) : undefined;
        if (!id || !gone) break;
        for (const cid of this.collectSubtree(id)) {
          this.channels.delete(cid);
          if (this.snapshotSent) this.emit({ type: "channel.removed", channelId: cid });
        }
        this.applyOrderFixes(relinkOnLeave(this.channels.values(), gone));
        break;
      }
      case "notifychannelsubscribed": {
        const id = p["cid"];
        if (id) this.patchChannel(id, { subscribed: true });
        break;
      }
      case "notifychannelunsubscribed": {
        const id = p["cid"];
        if (id) this.onUnsubscribed(id);
        break;
      }
      case "notifycliententerview": {
        const c = clientFromParams(p, this.selfId);
        if (c.id === 0) break;
        this.clients.set(c.id, c);
        // A fresh connection enters with reasonid 0 from channel 0. A client
        // that was already online comes into view with reasonid 2 when we
        // subscribe to its channel (also from "channel 0"), or with a real
        // from-channel when it moves out of one we don't see. Only the first
        // may read as "joined the server".
        const joinedServer = p["reasonid"] === "0" && (p["cfid"] ?? "0") === "0";
        if (this.snapshotSent) this.emit({ type: "client.entered", client: c, joinedServer });
        break;
      }
      case "notifyclientleftview": {
        const id = Number(p["clid"] ?? "0");
        if (!id) break;
        this.clients.delete(id);
        // Banned ourselves: say so (and by whom), then end the session. The
        // library does not notice the server dropping a banned client, so
        // without this the session would linger ("already connected").
        const ban = id === this.selfId ? selfBanNotice(p) : null;
        if (ban) {
          this.emit({ type: "error", ...ban, fatal: true });
          void this.disconnect();
        }
        if (this.snapshotSent) {
          this.emit({
            type: "client.left",
            clientId: id,
            reasonId: Number(p["reasonid"] ?? "0"),
            reasonMsg: p["reasonmsg"] ?? "",
            ...(p["invokername"] ? { invokerName: p["invokername"] } : {}),
          });
        }
        break;
      }
      case "notifyclientmoved": {
        const id = Number(p["clid"] ?? "0");
        const ctid = p["ctid"];
        if (!id || !ctid) break;
        const c = this.clients.get(id);
        if (c) c.channelId = ctid;
        // Joining subscribes without a notify (see subscriptions.ts).
        if (id === this.selfId && this.channels.get(ctid)?.subscribed === false) {
          this.patchChannel(ctid, { subscribed: true });
        }
        if (id === this.selfId && this.snapshotSent) this.handlers.onSelfChannel?.(ctid);
        if (this.snapshotSent) {
          const invokerId = p["invokerid"] ? Number(p["invokerid"]) : undefined;
          this.emit({
            type: "client.moved",
            clientId: id,
            channelId: ctid,
            reasonId: Number(p["reasonid"] ?? "0"),
            ...(invokerId ? { invokerId, invokerName: p["invokername"] ?? "" } : {}),
            ...(p["reasonmsg"] ? { reasonMsg: p["reasonmsg"] } : {}),
          });
        }
        break;
      }
      case "notifyclientupdated": {
        const id = Number(p["clid"] ?? "0");
        if (!id) break;
        this.patchClient(id, clientPatchFromParams(p));
        break;
      }
      case "notifyclientchannelgroupchanged": {
        const id = Number(p["clid"] ?? "0");
        if (id && p["cgid"]) this.patchClient(id, { channelGroupId: p["cgid"] });
        // A channel group grants powers too (own-perms.ts).
        if (id && id === this.selfId) this.ownPerms.refreshPowers();
        break;
      }
      case "notifyservergroupclientadded":
      case "notifyservergroupclientdeleted": {
        const id = Number(p["clid"] ?? "0");
        const sgid = p["sgid"];
        const c = this.clients.get(id);
        if (!c || !sgid) break;
        const groups = new Set(c.serverGroups);
        if (cmd.name === "notifyservergroupclientadded") groups.add(sgid);
        else groups.delete(sgid);
        this.patchClient(id, { serverGroups: [...groups] });
        // Our own powers may have moved with it (own-perms.ts).
        if (id === this.selfId) this.ownPerms.refreshPowers();
        break;
      }
      case "notifytextmessage": {
        const targetMode = Number(p["targetmode"] ?? "0");
        if (targetMode !== 1 && targetMode !== 2 && targetMode !== 3) break;
        this.emit({
          type: "text",
          targetMode,
          targetId: p["target"] ?? "0",
          invokerId: Number(p["invokerid"] ?? "0"),
          invokerName: p["invokername"] ?? "",
          invokerUid: p["invokeruid"] ?? "",
          message: p["msg"] ?? "",
          at: Date.now(),
        });
        break;
      }
      case "notifyclientpoke": {
        this.emit({
          type: "poked",
          invokerId: Number(p["invokerid"] ?? "0"),
          invokerName: p["invokername"] ?? "",
          message: p["msg"] ?? "",
          at: Date.now(),
        });
        break;
      }
      case "notifyserveredited":
      case "notifyserverupdated": {
        const patch = serverPatchFromParams(p);
        if (this.serverInfo) Object.assign(this.serverInfo, patch);
        if (this.snapshotSent && Object.keys(patch).length > 0) {
          this.emit({ type: "server.updated", patch });
        }
        break;
      }
      default:
        break;
    }
  }

  private groupsEmitTimer: NodeJS.Timeout | null = null;

  /** Coalesces the many per-row group notifications into one `groups` message. */
  private scheduleGroupsEmit(): void {
    if (this.groupsEmitTimer) return;
    this.groupsEmitTimer = setTimeout(() => {
      this.groupsEmitTimer = null;
      this.emit({
        type: "groups",
        serverGroups: [...this.serverGroups.values()],
        channelGroups: [...this.channelGroups.values()],
      });
    }, 50);
  }

  private patchChannel(id: string, patch: Partial<TsChannel>): void {
    const ch = this.channels.get(id);
    if (!ch) return;
    const { flags, ...rest } = patch;
    Object.assign(ch, rest);
    if (flags) ch.flags = { ...ch.flags, ...flags };
    if (this.snapshotSent) this.emit({ type: "channel.updated", channelId: id, patch });
  }

  /** Neighbours whose place changed without a notify of their own (see channel-order.ts). */
  private applyOrderFixes(fixes: readonly OrderFix[]): void {
    for (const f of fixes) this.patchChannel(f.id, { order: f.order });
  }

  private patchClient(id: number, patch: Partial<TsClient>): void {
    const c = this.clients.get(id);
    if (!c) return;
    Object.assign(c, patch);
    if (this.snapshotSent && Object.keys(patch).length > 0) {
      this.emit({ type: "client.updated", clientId: id, patch });
    }
  }

  /**
   * The server stops reporting an unsubscribed channel's clients without
   * saying goodbye for them, so we do it: they leave the model, and the page,
   * as having left our view.
   */
  private onUnsubscribed(channelId: string): void {
    const hidden = clientsHiddenByUnsubscribe(
      this.clients.values(),
      channelId,
      this.selfId,
      this.selfChannelId,
    );
    for (const id of hidden) {
      this.clients.delete(id);
      if (this.snapshotSent) {
        this.emit({ type: "client.left", clientId: id, reasonId: REASON_LEFT_VIEW, reasonMsg: "" });
      }
    }
    this.patchChannel(channelId, { subscribed: false });
  }

  private collectSubtree(rootId: string): string[] {
    const out: string[] = [];
    const walk = (id: string) => {
      out.push(id);
      for (const ch of this.channels.values()) if (ch.parentId === id) walk(ch.id);
    };
    walk(rootId);
    return out;
  }
}
