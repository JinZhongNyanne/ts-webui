/**
 * Channel file transfer over HTTP (M3): the browser streams to and from the
 * hub, the hub streams to and from the TeamSpeak server's file port. Nothing
 * is held in memory beyond the streams' own buffers, and backpressure runs
 * end to end (a slow browser slows the file port and the other way round).
 *
 *   POST /api/files/download-ticket  x-session-id, JSON {cid, path, cpw?}
 *        Starts the download on the server and answers with a one-use link
 *        (tickets.ts explains why a link and not the asset token).
 *   GET  /api/files/download/:ticket
 *        The bytes, always as an attachment with `nosniff`, never as a page.
 *   POST /api/files/media-ticket, GET|HEAD /api/files/media/:ticket
 *        Range-capable links for video and audio (media-routes.ts), sharing
 *        the download slots below.
 *   PUT  /api/files/upload?cid=&path=&overwrite=1
 *        x-session-id, FT_PASSWORD_HEADER, application/octet-stream,
 *        Content-Length. The body goes to the file port as it arrives.
 *
 * Writes (the ticket POST, the PUT) go through index.ts's foreign-origin
 * check like every other `/api` write. Each session gets `maxTransfers` at
 * once and `limiter` inits per minute; the inits themselves also spend the
 * hub-wide TeamSpeak command budget (see TsSession.initFileTransfer).
 *
 * A download takes its slot when the link is handed out, not when the
 * browser comes for it: the page cannot see the browser's download, so it
 * must learn "busy" from the ticket POST (and wait), never from the GET,
 * which would leave the browser with an error to save. The slot comes back
 * when the stream ends or the link expires unused. Downloads hold at most
 * `maxTransfers - 1` of them, so a few long downloads never starve an upload
 * (an avatar save, a file sent in chat).
 */
import type { Socket } from "node:net";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyReply } from "fastify";
import { dialFileTransfer } from "@honeybbq/teamspeak-client";
import {
  encodeTextCode,
  FT_HUB_CODES,
  FT_PASSWORD_HEADER,
  FtDownloadRequestSchema,
  FtUploadQuerySchema,
  formatBytes,
  ftNameOf,
  avatarDeleteName,
  avatarFilePath,
  isIconFilePath,
  isInternalChannelId,
  isInternalUploadPath,
  type FtDownloadTicket,
  type FtLimits,
  type FtUploadResult,
} from "@jinz/protocol";
import type { Logger } from "../logger.js";
import { ConcurrencyLimiter, type RateLimiter } from "../security/limits.js";
import { sessionIdFromHeaders } from "../session/asset-registry.js";
import type { SessionRegistry } from "../session/registry.js";
import { TsCommandFailure } from "../gateway/commands.js";
import type { PermCatalog } from "../gateway/perms.js";
import { contentDisposition } from "./disposition.js";
import { FtRefused, ftErrorReply } from "./errors.js";
import { ExactLength } from "./exact-length.js";
import type { FtStart } from "./ft-waiters.js";
import type { FtDownloadTarget, FtTarget, FtUploadTarget } from "./ft-init.js";
import { iconBytesMatchPath, readWholeBody } from "./icon-body.js";
import { internalUploadLimit } from "./internal-limits.js";
import { registerMediaRoutes } from "./media-routes.js";
import { onGone } from "./on-gone.js";
import { contentLengthOf, decodeChannelPassword, uploadLimit } from "./limits.js";
import { DEFAULT_STALL, StallGuard, type StallLimits } from "./stall-guard.js";
import { DownloadTickets } from "./tickets.js";
import { TransferSlots } from "./transfer-slots.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accept any fastify type-provider flavour
type AnyFastify = FastifyInstance<any, any, any, any, any>;

const UPLOAD_TYPE = "application/octet-stream";
export const DOWNLOAD_PREFIX = "/api/files/download/";
/** How long the file port may take to close after the last byte of an upload. */
const UPLOAD_SETTLE_MS = 30_000;

/** What the routes need from a TsSession (an interface so tests can fake it). */
export interface FileTransferTarget {
  readonly fileTransferHost: string;
  /** Whose avatar this session may upload (see isInternalUploadPath). */
  readonly selfUid: string;
  initFileDownload(target: FtDownloadTarget): Promise<FtStart>;
  initFileUpload(target: FtUploadTarget): Promise<FtStart>;
  deleteFile(target: FtTarget): Promise<void>;
  /** Drops a channel-0 file from the hub-wide icon/avatar cache. */
  forgetAsset?(path: string): void;
  ownPermission(name: string): number | undefined;
  permissionCatalog(): Promise<PermCatalog>;
}

export interface FileRouteDeps {
  registry: Pick<SessionRegistry, "getConnected" | "onEnd">;
  limits: FtLimits;
  /** Transfer inits (links and uploads) per session, per user and per address per window. */
  limiter?: RateLimiter;
  /** Transfers the whole hub may run at once (HUB_FT_MAX_TRANSFERS). */
  maxHubTransfers?: number;
  /** When a transfer counts as stalled (HUB_FT_STALL_*); see stall-guard.ts. */
  stall?: StallLimits;
  tickets?: DownloadTickets;
  /**
   * The media links' own opens per session (HUB_FT_MEDIA_OPENS_PER_MIN), on
   * top of `limiter`, and for tests their clock (see media-routes.ts).
   */
  media?: { limiter?: RateLimiter; now?: () => number; ttlMs?: number };
  /** Opens a transfer on the file port; the client library's by default. */
  dial?: (host: string, port: number, key: string) => Promise<Socket>;
  logger?: Pick<Logger, "debug" | "warn">;
}

/** The connected session behind a request, and its TeamSpeak side. */
interface Caller {
  id: string;
  ts: FileTransferTarget;
}

export async function registerFileRoutes(app: AnyFastify, deps: FileRouteDeps): Promise<void> {
  const tickets = deps.tickets ?? new DownloadTickets();
  const dial = deps.dial ?? dialFileTransfer;
  const slots = new TransferSlots(deps.limits.maxTransfers, deps.maxHubTransfers ?? Infinity);
  const downloads = new ConcurrencyLimiter(downloadSlots(deps.limits.maxTransfers));
  /** Links handed out and not used yet, by ticket: each holds its session's slots. */
  const reserved = new Map<string, string>();
  const stall = deps.stall ?? DEFAULT_STALL;
  const log = deps.logger;

  function caller(headers: Record<string, string | string[] | undefined>): Caller {
    const session = deps.registry.getConnected(sessionIdFromHeaders(headers));
    const ts = session?.tsSession as FileTransferTarget | null | undefined;
    if (!session || !ts) throw new FtRefused(401, FT_HUB_CODES.notConnected, "tsErr.notConnected");
    return { id: session.id, ts };
  }

  /**
   * Spends one init from the session's budget. Called once the session is
   * known to have a slot: a "busy" the page is meant to wait out must not
   * also use up its inits per minute.
   */
  function spendInit(who: Caller, ip: string): void {
    if (!takeTransferBudget(who.id, who.ts.selfUid, ip)) {
      throw new FtRefused(429, FT_HUB_CODES.rateLimited, "ft.rateLimited");
    }
  }

  /**
   * Spends one transfer init of this session, this user and this address;
   * false when any of them has none left. Per session, but also per user and
   * per address: every init spends the hub-wide TeamSpeak command budget too,
   * which one person with a handful of tabs would otherwise have all of (see
   * server-guard.ts). Media opens spend it as well (media-routes.ts).
   */
  function takeTransferBudget(sessionId: string, selfUid: string, ip: string): boolean {
    const limiter = deps.limiter;
    if (!limiter) return true;
    return transferBudgetKeys(sessionId, selfUid, ip).every((key) => limiter.take(key));
  }

  const busy = () => new FtRefused(429, FT_HUB_CODES.busy, "ft.busy");

  /** Takes a download's slots for `sessionId`; false when it must wait. */
  function reserveDownload(sessionId: string): boolean {
    if (!downloads.acquire(sessionId)) return false;
    if (slots.acquire(sessionId)) return true;
    downloads.release(sessionId);
    return false;
  }

  function releaseDownload(sessionId: string): void {
    downloads.release(sessionId);
    slots.release(sessionId);
  }

  /** Gives the slots of an unused link back once it can no longer be used. */
  function expireLater(ticket: string, sessionId: string): void {
    const timer = setTimeout(() => {
      if (reserved.delete(ticket)) releaseDownload(sessionId);
    }, tickets.ttl);
    timer.unref?.();
  }

  async function fail(reply: FastifyReply, err: unknown, ts?: FileTransferTarget) {
    // Naming the missing permission costs a catalog lookup, which is cached.
    const catalog =
      err instanceof Error && err.name === "TsCommandFailure"
        ? await ts?.permissionCatalog().catch(() => undefined)
        : undefined;
    const { status, body } = ftErrorReply(err, catalog);
    if (status === 502) log?.warn({ err }, "file transfer failed");
    return reply.code(status).header("cache-control", "no-store").send(body);
  }

  app.post("/api/files/download-ticket", async (request, reply) => {
    let who: Caller | undefined;
    try {
      who = caller(request.headers);
      const body = FtDownloadRequestSchema.safeParse(request.body);
      if (!body.success) throw new FtRefused(400, FT_HUB_CODES.badRequest, "ft.badRequest");
      if (!reserveDownload(who.id)) throw busy();
      const { cid, path, cpw = "" } = body.data;
      let start: FtStart;
      try {
        spendInit(who, request.ip);
        start = await who.ts.initFileDownload({ cid, path, cpw });
      } catch (err) {
        releaseDownload(who.id);
        throw err;
      }
      const name = ftNameOf(path);
      const { ticket, expiresAt } = tickets.mint({
        sessionId: who.id,
        host: who.ts.fileTransferHost,
        name,
        start,
      });
      reserved.set(ticket, who.id);
      expireLater(ticket, who.id);
      const grant: FtDownloadTicket = {
        url: `${DOWNLOAD_PREFIX}${ticket}`,
        expiresAt,
        size: start.size,
        name,
      };
      return reply.header("cache-control", "no-store").send(grant);
    } catch (err) {
      return fail(reply, err, who?.ts);
    }
  });

  /**
   * A refused GET is the browser's download (or a preview's fetch): a short
   * plain-text answer without Content-Disposition, which the browser shows
   * as a failed download instead of saving an error body as the file.
   */
  function failDownload(reply: FastifyReply, err: unknown) {
    const { status, body } = ftErrorReply(err);
    if (status === 502) log?.warn({ err }, "file download failed");
    return reply
      .code(status)
      .header("content-type", "text/plain; charset=utf-8")
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "no-store")
      .send(`download failed: ${body.error}\n`);
  }

  // No automatic HEAD: a link preview must not use up the one-time link.
  app.get<{ Params: { ticket: string } }>(
    `${DOWNLOAD_PREFIX}:ticket`,
    { exposeHeadRoute: false },
    async (request, reply) => {
      const grant = tickets.take(request.params.ticket);
      // The link's slots are this request's now (or free again, when it is refused).
      const held = grant !== undefined && reserved.delete(request.params.ticket);
      const expired = new FtRefused(410, FT_HUB_CODES.expired, "ft.linkExpired");
      if (!grant || !held || !deps.registry.getConnected(grant.sessionId)) {
        if (held) releaseDownload(grant.sessionId);
        return failDownload(reply, expired);
      }
      // From here on the slot is this request's. A browser that goes away —
      // even while the file port is still being dialled, or before this
      // handler ran — gives it back at once (a listener attached after the
      // close would never hear it; see on-gone.ts). Both the close and a
      // failed dial may try to give it back, and only the first may: a second
      // release would free a slot the session's next link holds by then.
      let gone = false;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        releaseDownload(grant.sessionId);
      };
      onGone(request, reply, () => {
        gone = true;
        release();
      });
      // Already gone: the file port is not dialled for nobody.
      if (gone) return failDownload(reply, expired);
      let socket: Socket;
      try {
        socket = idleForever(await dial(grant.host, grant.start.port, grant.start.key));
      } catch (err) {
        release();
        return failDownload(reply, err);
      }
      if (gone) {
        // Nobody is left to read it; drop the transfer the dial just started.
        socket.destroy();
        return failDownload(reply, expired);
      }
      // Short or long reads fail the stream, and Fastify then cuts the
      // response instead of ending it as if the file were complete. A browser
      // that goes away destroys `body`, which pipeline passes on to the socket.
      const body = new ExactLength(grant.start.size);
      // A download nobody reads is backpressure all the way to the file port,
      // and would hold this slot and that transfer for good (see stall-guard.ts).
      pipeline(socket, new StallGuard(grant.start.size, stall), body).catch((err: unknown) =>
        log?.debug({ err, name: grant.name }, "download ended early"),
      );
      return reply
        .header("content-type", UPLOAD_TYPE)
        .header("content-length", String(grant.start.size))
        .header("content-disposition", contentDisposition(grant.name))
        .header("x-content-type-options", "nosniff")
        .header("cache-control", "no-store")
        .send(body);
    },
  );

  registerMediaRoutes(app, {
    registry: deps.registry,
    caller,
    reserve: reserveDownload,
    release: releaseDownload,
    spendTransfer: takeTransferBudget,
    fail,
    dial,
    stall,
    ...deps.media,
    ...(log ? { logger: log } : {}),
  });

  // Uploads get their own parser scope: the soundboard (and anyone else) may
  // buffer octet-stream bodies app-wide, which a file of 100 MB must not be.
  await app.register(async (scope) => {
    if (scope.hasContentTypeParser(UPLOAD_TYPE)) scope.removeContentTypeParser(UPLOAD_TYPE);
    // Leave the body unread: the handler pipes `request.raw` itself.
    scope.addContentTypeParser(UPLOAD_TYPE, (_request, _payload, done) => done(null));

    scope.put("/api/files/upload", async (request, reply) => {
      let who: Caller | undefined;
      try {
        who = caller(request.headers);
        const query = FtUploadQuerySchema.safeParse(request.query);
        const cpw = decodeChannelPassword(request.headers[FT_PASSWORD_HEADER]);
        if (!query.success || cpw === null) {
          throw new FtRefused(400, FT_HUB_CODES.badRequest, "ft.badRequest");
        }
        // Channel 0 is the server's own store, where TeamSpeak lets anyone
        // overwrite anyone's avatar: only our avatar and icon files go there.
        const internal = isInternalChannelId(query.data.cid);
        if (internal && !isInternalUploadPath(query.data.path, who.ts.selfUid)) {
          throw new FtRefused(403, FT_HUB_CODES.badRequest, "ft.forbidden");
        }
        // An icon is named by its bytes, so an existing one is never replaced:
        // same name, same picture, unless someone means to swap it under everyone.
        if (internal && query.data.overwrite && isIconFilePath(query.data.path)) {
          throw new FtRefused(403, FT_HUB_CODES.badRequest, "ft.forbidden");
        }
        const size = contentLengthOf(request.headers);
        if (size === null) {
          throw new FtRefused(411, FT_HUB_CODES.lengthRequired, "ft.lengthRequired");
        }
        // Channel 0's files are held whole by the hub (icons on their way up,
        // everything in the asset cache), so they are capped far tighter.
        const max = Math.min(
          uploadLimit(
            deps.limits.maxUploadBytes,
            who.ts.ownPermission("i_ft_quota_mb_upload_per_client"),
          ),
          internal
            ? internalUploadLimit(
                query.data.path,
                who.ts.ownPermission("i_client_max_avatar_filesize"),
              )
            : Infinity,
        );
        if (!String(request.headers["content-type"] ?? "").startsWith(UPLOAD_TYPE)) {
          // Another parser in this scope has already read (and used up) the body.
          throw new FtRefused(415, FT_HUB_CODES.badRequest, "ft.badRequest");
        }
        if (size > max) {
          const message = encodeTextCode("ft.tooLarge", { max: formatBytes(max) });
          throw new FtRefused(413, FT_HUB_CODES.tooLarge, message);
        }
        if (slots.count(who.id) >= deps.limits.maxTransfers) throw busy();
        spendInit(who, request.ip);
        const target = { ...query.data, cpw, size };
        // An icon's name is its bytes' CRC-32, and nothing overwrites an
        // existing name: an icon is read whole first, so nobody can squat the
        // name a picture they do not have would take (see icon-body.ts).
        const source = isIconFilePath(target.path)
          ? await readIcon(target.path, request.raw, size)
          : request.raw;
        const stored = await runUpload(who, target, source);
        // A new icon may have been asked for (and remembered missing) already.
        if (internal) who.ts.forgetAsset?.(target.path);
        const result: FtUploadResult = { path: target.path, size: stored };
        return reply.code(201).send(result);
      } catch (err) {
        // The browser may still be sending. A browser whose connection is
        // closed mid-upload reports a network error, not our answer, so the
        // rest of a body TeamSpeak itself refused is read and dropped to let
        // our answer through. A refusal of the hub's own (rate limited, busy,
        // too large) is cut off instead: reading it out is what the caller
        // was refused in the first place.
        if (err instanceof TsCommandFailure) request.raw.resume();
        else reply.header("connection", "close");
        return fail(reply, err, who?.ts);
      }
    });
  });

  /** Reads an icon whole and checks its name against its bytes (see icon-body.ts). */
  async function readIcon(
    path: string,
    source: NodeJS.ReadableStream,
    size: number,
  ): Promise<NodeJS.ReadableStream> {
    let bytes: Buffer;
    try {
      bytes = await readWholeBody(source, size, stall);
    } catch (err) {
      log?.debug({ err, path }, "icon body not read");
      throw new FtRefused(400, FT_HUB_CODES.aborted, "ft.aborted");
    }
    if (!iconBytesMatchPath(path, bytes)) {
      throw new FtRefused(400, FT_HUB_CODES.badRequest, "ft.badRequest");
    }
    return Readable.from([bytes]);
  }

  /** Starts the upload on the server and streams `source` into it; returns the bytes sent. */
  async function runUpload(
    who: Caller,
    target: FtUploadTarget,
    source: NodeJS.ReadableStream,
  ): Promise<number> {
    if (!slots.acquire(who.id)) throw new FtRefused(429, FT_HUB_CODES.busy, "ft.busy");
    const counter = new ExactLength(target.size);
    const dropPartial = () => {
      // TeamSpeak writes an upload straight into its target (seen live: a
      // cut-off overwrite leaves the old file truncated), so a broken upload
      // leaves a broken file. Only once our bytes went in is it ours to drop:
      // before that the name may still hold someone's file.
      if (counter.received === 0) return;
      void who.ts
        .deleteFile({
          cid: target.cid,
          path: deletePathOf(target, who.ts.selfUid),
          cpw: target.cpw,
        })
        .catch((err: unknown) => log?.debug({ err }, "partial upload not removed"));
    };
    try {
      const start = await who.ts.initFileUpload(target);
      let socket: Socket;
      try {
        socket = idleForever(await dial(who.ts.fileTransferHost, start.port, start.key));
      } catch (err) {
        dropPartial();
        throw err;
      }
      try {
        socket.resume(); // the server sends nothing back; let its FIN through
        await pipeline(source, new StallGuard(target.size, stall), counter, socket);
        await settled(socket);
        return target.size;
      } catch (err) {
        // The browser went away or sent the wrong number of bytes.
        log?.debug({ err, received: counter.received }, "upload cut off");
        dropPartial();
        throw new FtRefused(400, FT_HUB_CODES.aborted, "ft.aborted");
      }
    } finally {
      slots.release(who.id);
    }
  }
}

/**
 * How many of a session's `maxTransfers` slots downloads may hold: all but
 * one, so an upload always finds one (a single slot is shared).
 */
export function downloadSlots(maxTransfers: number): number {
  return maxTransfers > 1 ? maxTransfers - 1 : maxTransfers;
}

/**
 * The client library dials with a 10 s idle timeout that destroys the socket.
 * Backpressure (a paused browser download, a stalled upload) is idle time
 * here, not a dead connection, so it must not end the transfer.
 */
function idleForever(socket: Socket): Socket {
  socket.setTimeout(0);
  return socket;
}

/**
 * The buckets one transfer init spends: this session, this user (the
 * TeamSpeak identity behind it) and this address. A user with several tabs
 * is one user, and several users behind one address share that address's
 * share of the hub-wide TeamSpeak command budget.
 */
function transferBudgetKeys(sessionId: string, uid: string, ip: string): string[] {
  return [`s:${sessionId}`, ...(uid ? [`u:${uid}`] : []), `ip:${ip}`];
}

/**
 * The name `ftdeletefile` takes for an uploaded file: its path, except for our
 * own avatar, which the server only deletes by its base64 UID (the a–p name
 * it was uploaded under answers 1540; see ts-internal-files.ts).
 */
function deletePathOf(target: FtTarget, selfUid: string): string {
  const avatar = isInternalChannelId(target.cid) && target.path === avatarFilePath(selfUid);
  return avatar ? (avatarDeleteName(selfUid) ?? target.path) : target.path;
}

/** Resolves once the server has closed the file-port connection (it has all the bytes). */
function settled(socket: Socket): Promise<void> {
  if (socket.destroyed) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("file port did not close after the upload"));
    }, UPLOAD_SETTLE_MS);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
