/**
 * Channel video and audio streamed to a `<video>` or `<audio>` (see
 * media-tickets.ts for what a media link is and is not).
 *
 *   POST /api/files/media-ticket   x-session-id, JSON {cid, path, cpw?}
 *        Refused unless the name is video or audio. Starts the file on the
 *        server once (which is how the hub learns the size, and how a wrong
 *        password or a missing permission reaches the page as a proper
 *        refusal) and answers with a link.
 *   GET|HEAD /api/files/media/:ticket
 *        The bytes, inline as the name's type, with `nosniff` and without
 *        `Content-Disposition`. `Range: bytes=a-` answers 206 from `a` to the
 *        end (range.ts); HEAD answers from what the link already knows and
 *        never touches the server.
 *
 * ## What one request costs
 *
 * Each GET is one `ftinitdownload seekpos=a` — TeamSpeak can start part-way
 * in, but not stop early, hence open-ended ranges — through the TsSession's
 * paced command queue, so it spends the hub-wide `ts.cmd` budget every page on
 * the server shares (server-guard.ts). So every open — the POST and each GET
 * that starts a transfer — is charged twice: to the transfer budget downloads
 * and uploads spend (HUB_FT_RATE_PER_MIN per session, per user and per
 * address), and to the session's own media bucket (HUB_FT_MEDIA_OPENS_PER_MIN,
 * a token bucket, so a burst of seeks is fine and scrubbing for a minute is
 * not). The media bucket alone was per session, so ten sessions from one
 * address had ten times the opens, and the operator's HUB_FT_RATE_PER_MIN
 * could not lower that. The transfer the POST started is
 * kept for a few seconds and used by the first request from byte 0 — which is
 * a player's first request — so opening a clip costs one init, not two.
 *
 * ## One slot per player
 *
 * A player reads one place at a time: when it seeks, it drops the request it
 * had and makes a new one. So a link holds at most one running stream, and
 * therefore one of the session's transfer slots: a new request on a link cuts
 * the one still running and takes its slot over, rather than asking for
 * another. A link with nothing running holds no slot at all. The stream is fed
 * through the same StallGuard as a download, so a paused player that stops
 * reading gives its slot, its socket and the server's transfer back within a
 * stall window, and simply asks again (one more open) when it plays on.
 *
 * ## When a link stops working
 *
 * Expiry, a replacing link, the per-session cap, or the session's TeamSpeak
 * connection going (or becoming another one): each revokes the link, which
 * cuts its running stream. The last is heard the moment it happens (the
 * registry's onEnd, fired as the session lets go of the connection), and is
 * also checked on every request and swept every MEDIA_SWEEP_MS as a backstop.
 */
import type { Socket } from "node:net";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  FT_HUB_CODES,
  FT_MEDIA_OPENS_PER_MIN,
  FT_TICKET_TTL_MS,
  FtDownloadRequestSchema,
  ftMediaMimeOf,
  ftNameOf,
  type FtMediaTicket,
} from "@jinz/protocol";
import type { Logger } from "../logger.js";
import { RateLimiter } from "../security/limits.js";
import type { Session } from "../session/Session.js";
import type { SessionEnd } from "../session/registry.js";
import { FtRefused, ftErrorReply } from "./errors.js";
import { ExactLength } from "./exact-length.js";
import type { FtStart } from "./ft-waiters.js";
import type { FtDownloadTarget } from "./ft-init.js";
import { MediaTickets, NotMediaError, type MediaGrant } from "./media-tickets.js";
import { onGone } from "./on-gone.js";
import { bytesFrom, contentRange, parseRange, unsatisfiedRange } from "./range.js";
import { StallGuard, type StallLimits } from "./stall-guard.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accept any fastify type-provider flavour
type AnyFastify = FastifyInstance<any, any, any, any, any>;

export const MEDIA_TICKET_ROUTE = "/api/files/media-ticket";
export const MEDIA_PREFIX = "/api/files/media/";
/** How often links whose session has gone are looked for and revoked. */
export const MEDIA_SWEEP_MS = 15_000;
/**
 * `Sec-Fetch-Site` values a media request is refused for. The page plays its
 * own links (same-origin); another site embedding a leaked one would be
 * blocked by `Cross-Origin-Resource-Policy` anyway, but only after the hub had
 * spent a transfer on it, so it is refused before anything is asked.
 */
const FOREIGN_SITES: ReadonlySet<string> = new Set(["cross-site", "same-site"]);

/** What the media routes need from a TsSession. */
export interface MediaTransferTarget {
  readonly fileTransferHost: string;
  /** The TeamSpeak identity behind the session, one of the transfer budget's keys. */
  readonly selfUid: string;
  initFileDownload(target: FtDownloadTarget): Promise<FtStart>;
}

/** The connected session behind a request (resolved by routes.ts). */
export interface MediaCaller {
  id: string;
  ts: MediaTransferTarget;
}

export interface MediaRouteDeps {
  registry: {
    getConnected(id: string | undefined): Session | undefined;
    /** Says when a session, or one of its TeamSpeak connections, ends (see revokeEnded). */
    onEnd(listener: (end: SessionEnd) => void): () => void;
  };
  caller(headers: FastifyRequest["headers"]): MediaCaller;
  /** Takes one of the session's download slots; false when it has none free. */
  reserve(sessionId: string): boolean;
  release(sessionId: string): void;
  /**
   * Spends one transfer init from the budget downloads spend (per session,
   * per user, per address); false when any of them has none left.
   */
  spendTransfer(sessionId: string, selfUid: string, ip: string): boolean;
  /** Answers a refused POST as JSON (routes.ts's `fail`). */
  fail(reply: FastifyReply, err: unknown, ts?: MediaTransferTarget): Promise<unknown>;
  dial(host: string, port: number, key: string): Promise<Socket>;
  stall: StallLimits;
  /** Opens per session, on top of `spendTransfer`; FT_MEDIA_OPENS_PER_MIN a minute by default. */
  limiter?: RateLimiter;
  /** For tests: the links' clock and lifetime. */
  now?: () => number;
  ttlMs?: number;
  logger?: Pick<Logger, "debug" | "warn">;
}

/** A request streaming a link's bytes; at most one per link. */
interface Stream {
  cancelled: boolean;
  body?: ExactLength;
  socket?: Socket;
}

/** What claiming a link's stream came to: the POST's transfer to use, or a refusal. */
type Claim = { readonly kept: FtStart | undefined } | { readonly refused: FtRefused };

/** A transfer the POST started, for the link's first request from byte 0. */
interface Primed {
  readonly start: FtStart;
  readonly until: number;
}

export function registerMediaRoutes(app: AnyFastify, deps: MediaRouteDeps): void {
  const now = deps.now ?? Date.now;
  const limiter =
    deps.limiter ?? new RateLimiter({ limit: FT_MEDIA_OPENS_PER_MIN, windowMs: 60_000 });
  const live = new Map<string, Stream>();
  const primed = new Map<string, Primed>();
  const log = deps.logger;
  const tickets = new MediaTickets(onRevoke, now, deps.ttlMs);

  function cut(stream: Stream): void {
    stream.cancelled = true;
    stream.body?.destroy();
    stream.socket?.destroy();
  }

  /** A link is gone: its primed transfer is dropped and its stream cut (which frees the slot). */
  function onRevoke(ticket: string): void {
    primed.delete(ticket);
    const stream = live.get(ticket);
    if (stream) cut(stream);
  }

  /** Whether the link's session is still connected through the connection it was minted on. */
  function holds(grant: MediaGrant): boolean {
    return deps.registry.getConnected(grant.sessionId)?.tsSession === grant.owner;
  }

  const sweeper = setInterval(() => {
    tickets.sweep();
    tickets.revokeUnless(holds);
    const at = now();
    for (const [ticket, p] of primed) if (p.until <= at) primed.delete(ticket);
  }, MEDIA_SWEEP_MS);
  sweeper.unref?.();

  /**
   * Revokes the links of a session that ended, or of the connection that
   * closed — only that one: a link minted on the session's next connection
   * lives on. Revoking cuts a running stream, so a kicked, banned or
   * disconnected user stops receiving bytes now rather than at the next
   * request or sweep.
   */
  function revokeEnded({ sessionId, connection }: SessionEnd): void {
    if (connection === null) tickets.revokeSession(sessionId);
    else tickets.revokeUnless((g) => g.sessionId !== sessionId || g.owner !== connection);
  }
  const stopHearing = deps.registry.onEnd(revokeEnded);

  app.addHook("onClose", async () => {
    stopHearing();
    clearInterval(sweeper);
    tickets.revokeUnless(() => false);
  });

  /**
   * Spends one open from the session's media bucket and one init from the
   * transfer budget; false when either has none left. The media bucket is
   * asked first: it is the one a scrubbing player runs out of, and a seek it
   * refuses must not also use up the user's downloads.
   */
  function takeOpen(sessionId: string, ts: MediaTransferTarget, ip: string): boolean {
    return limiter.take(`media:${sessionId}`) && deps.spendTransfer(sessionId, ts.selfUid, ip);
  }

  /** Spends one open (takeOpen); throws a 429 when there is none left. */
  function spendOpen(sessionId: string, ts: MediaTransferTarget, ip: string): void {
    if (!takeOpen(sessionId, ts, ip)) throw rateLimited();
  }

  app.post(MEDIA_TICKET_ROUTE, async (request, reply) => {
    let who: MediaCaller | undefined;
    try {
      who = deps.caller(request.headers);
      const body = FtDownloadRequestSchema.safeParse(request.body);
      if (!body.success) throw new FtRefused(400, FT_HUB_CODES.badRequest, "ft.badRequest");
      const { cid, path, cpw = "" } = body.data;
      // Refused before the server is asked anything: the name alone decides.
      if (!ftMediaMimeOf(ftNameOf(path))) throw notMedia();
      spendOpen(who.id, who.ts, request.ip);
      const start = await who.ts.initFileDownload({ cid, path, cpw, seekpos: 0 });
      const { ticket, expiresAt, grant } = tickets.mint({
        sessionId: who.id,
        owner: who.ts,
        host: who.ts.fileTransferHost,
        cid,
        path,
        cpw,
        size: start.size,
      });
      primed.set(ticket, { start, until: now() + FT_TICKET_TTL_MS });
      const answer: FtMediaTicket = {
        url: `${MEDIA_PREFIX}${ticket}`,
        expiresAt,
        size: grant.size,
        name: grant.name,
        type: grant.type,
      };
      return reply.header("cache-control", "no-store").send(answer);
    } catch (err) {
      return deps.fail(reply, err instanceof NotMediaError ? notMedia() : err, who?.ts);
    }
  });

  /** A refused GET is the player's: plain text, never something to render or save. */
  function failMedia(reply: FastifyReply, err: unknown, extra: Record<string, string> = {}) {
    const { status, body } = ftErrorReply(err);
    if (status === 502) log?.warn({ err }, "media stream failed");
    return reply
      .code(status)
      .headers(extra)
      .header("content-type", "text/plain; charset=utf-8")
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "no-store")
      .send(`media failed: ${body.error}\n`);
  }

  /**
   * The POST's own transfer when this request can use it (from byte 0, while
   * the server still holds it); it is used at most once either way.
   */
  function takePrimed(ticket: string, from: number): FtStart | undefined {
    const kept = primed.get(ticket);
    primed.delete(ticket);
    return kept && from === 0 && kept.until > now() ? kept.start : undefined;
  }

  /** A new transfer of the link's file from `from`, on the connection it was minted on. */
  function startAt(grant: MediaGrant, from: number): Promise<FtStart> {
    const ts = ownerOf(grant);
    return ts.initFileDownload({ cid: grant.cid, path: grant.path, cpw: grant.cpw, seekpos: from });
  }

  /**
   * Makes `stream` the link's one running stream, or says why not. It takes
   * over the slot of the stream it replaces, or a free slot of the session's;
   * and unless it can use the POST's transfer it spends one of the session's
   * opens. Nothing is spent and nothing running is cut unless both succeed:
   * a refused seek leaves the player playing where it was.
   */
  function claim(
    ticket: string,
    grant: MediaGrant,
    stream: Stream,
    from: number,
    ip: string,
  ): Claim {
    const previous = live.get(ticket);
    if (!previous && !deps.reserve(grant.sessionId)) {
      return { refused: new FtRefused(429, FT_HUB_CODES.busy, "ft.busy") };
    }
    const kept = takePrimed(ticket, from);
    if (!kept && !takeOpen(grant.sessionId, ownerOf(grant), ip)) {
      if (!previous) deps.release(grant.sessionId);
      return { refused: rateLimited() };
    }
    live.set(ticket, stream);
    if (previous) cut(previous);
    return { kept };
  }

  /**
   * Gives the slot back, unless another request of the link has taken it
   * over. Safe to call more than once (the close, a failed start and the
   * stream settling may all call it): only the first finds the stream live.
   */
  function finish(ticket: string, grant: MediaGrant, stream: Stream): void {
    if (live.get(ticket) !== stream) return;
    live.delete(ticket);
    deps.release(grant.sessionId);
  }

  app.route<{ Params: { ticket: string } }>({
    method: ["GET", "HEAD"],
    url: `${MEDIA_PREFIX}:ticket`,
    // HEAD is answered here, from what the link knows; an automatic one would
    // run the GET and start a transfer to throw away.
    exposeHeadRoute: false,
    handler: async (request, reply) => {
      const { ticket } = request.params;
      const grant = tickets.get(ticket);
      if (!grant) return failMedia(reply, expired());
      if (!holds(grant)) {
        tickets.revoke(ticket);
        return failMedia(reply, expired());
      }
      const site = request.headers["sec-fetch-site"];
      if (typeof site === "string" && FOREIGN_SITES.has(site)) {
        return failMedia(reply, new FtRefused(403, FT_HUB_CODES.badRequest, "ft.forbidden"));
      }
      const range = parseRange(request.headers.range, grant.size);
      if (range.kind === "unsatisfiable") {
        return failMedia(reply, new FtRefused(416, FT_HUB_CODES.badRequest, "ft.badRequest"), {
          "content-range": unsatisfiedRange(grant.size),
        });
      }
      const from = range.kind === "from" ? range.start : 0;
      const partial = range.kind === "from";
      // HEAD, and an empty file (parseRange serves it whole): the link already
      // knows the whole answer, so no transfer is started, no slot taken and
      // no open spent. The POST's own transfer of an empty file is not used.
      if (request.method === "HEAD" || grant.size === 0) {
        if (grant.size === 0) primed.delete(ticket);
        return head(reply, grant, from, partial).send();
      }
      // A player already gone (it can close during the hooks before this
      // handler) must not spend an open, nor cut the stream the link has
      // running.
      if (request.raw.destroyed || reply.raw.destroyed) return failMedia(reply, expired());
      const stream: Stream = { cancelled: false };
      const claimed = claim(ticket, grant, stream, from, request.ip);
      if ("refused" in claimed) return failMedia(reply, claimed.refused);
      // From here on the slot is this request's. A player that goes away —
      // even while its transfer is still starting, or before this handler
      // ran — gives it back at once, and whatever of the transfer has started
      // is dropped (on-gone.ts).
      onGone(request, reply, () => {
        cut(stream);
        finish(ticket, grant, stream);
      });
      let length: number;
      let announced: number;
      try {
        const start = claimed.kept ?? (await startAt(grant, from));
        announced = start.size;
        if (stream.cancelled) throw expired();
        const bytes = bytesFrom(start.size, grant.size, from);
        // The file changed since the link was minted; a new link will say its size.
        if (bytes === null) throw expired();
        length = bytes;
        stream.socket = idleForever(await deps.dial(grant.host, start.port, start.key));
        if (stream.cancelled) {
          stream.socket.destroy();
          throw expired();
        }
      } catch (err) {
        finish(ticket, grant, stream);
        return failMedia(reply, err);
      }
      const body = new ExactLength(length);
      stream.body = body;
      log?.debug(
        { name: grant.name, seekpos: from, bytes: length, announced },
        "media range opened",
      );
      // The slot also comes back when the stream settles, whichever way:
      // finish() gives it back once, and only while this stream holds it.
      pipeline(stream.socket, new StallGuard(length, deps.stall), body)
        .catch((err: unknown) => log?.debug({ err, name: grant.name }, "media stream ended early"))
        .finally(() => finish(ticket, grant, stream));
      return head(reply, grant, from, partial).send(body);
    },
  });
}

/** The headers of a media answer from `from` to the end; the status says whether it is a range. */
function head(reply: FastifyReply, grant: MediaGrant, from: number, partial: boolean) {
  const answer = reply
    .code(partial ? 206 : 200)
    .header("content-type", grant.type)
    .header("content-length", String(grant.size - from))
    .header("accept-ranges", "bytes")
    .header("x-content-type-options", "nosniff")
    .header("cache-control", "no-store");
  return partial ? answer.header("content-range", contentRange(from, grant.size)) : answer;
}

/** The connection a link was minted on, which the POST handed in as a MediaTransferTarget. */
function ownerOf(grant: MediaGrant): MediaTransferTarget {
  return grant.owner as MediaTransferTarget;
}

const rateLimited = () => new FtRefused(429, FT_HUB_CODES.rateLimited, "ft.rateLimited");
const expired = () => new FtRefused(410, FT_HUB_CODES.expired, "ft.linkExpired");
const notMedia = () => new FtRefused(415, FT_HUB_CODES.notMedia, "media.notMedia");

/** See routes.ts: backpressure is idle time, not a dead connection. */
function idleForever(socket: Socket): Socket {
  socket.setTimeout(0);
  return socket;
}
