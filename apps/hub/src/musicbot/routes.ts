import type { FastifyInstance } from "fastify";
import type { SessionRegistry } from "../session/registry.js";
import type { Logger } from "../logger.js";
import type { RateLimiter } from "../security/limits.js";
import type { ProxyResult } from "./BotBridge.js";
import type { PooledBridge } from "./BridgePool.js";
import { LOCKED_MODE, modeRefusal, radioTransition, succeeded } from "./radio.js";
import { creditFor } from "./credit.js";
import { addedSongs } from "./requesters.js";
import type { MusicSong } from "@jinz/protocol";

/**
 * Only these bot API routes are reachable through the hub. Management
 * endpoints (users, audit, bot CRUD, platform logins) are deliberately absent.
 */
const ALLOW: Array<[method: string, pattern: RegExp]> = [
  ["GET", /^\/bot$/],
  ["GET", /^\/bot\/[^/]+$/],
  // The caller's own rights, so the browser can hide controls the bot would
  // only ever refuse. This one /session route only: login/logout stay barred.
  ["GET", /^\/session\/me$/],
  // Browse surfaces: search, the discover feeds and the bot account's own
  // playlists. `recommend/songs` and `user/playlists` need a non-guest bot
  // session; the browser hides those sections when the bot answers 403.
  [
    "GET",
    /^\/music\/(search|search\/all|providers|recommend\/(playlists|songs)|user\/playlists|bilibili\/popular)$/,
  ],
  // Playlists the bot account starred. Read-only: adding or removing a
  // favourite would edit shared state on behalf of every browser user.
  ["GET", /^\/favorites$/],
  ["GET", /^\/music\/(song|lyrics|album)\/[^/]+$/],
  ["GET", /^\/music\/playlist\/[^/]+(\/detail)?$/],
  ["GET", /^\/player\/[^/]+\/(queue|elapsed|history)$/],
  [
    "POST",
    /^\/player\/[^/]+\/(play|add|play-song|add-song|add-by-id|play-next-song|play-now-song|pause|resume|next|prev|stop|seek|volume|mode|play-at|clear|fm|playlist|play-playlist|play-album)$/,
  ],
  ["DELETE", /^\/player\/[^/]+\/queue\/\d+$/],
];

export function isAllowed(method: string, subPath: string): boolean {
  return ALLOW.some(([m, re]) => m === method && re.test(subPath));
}

/**
 * Turns the wildcard match into a path safe to append to the bot's base URL,
 * or null when it is not one.
 *
 * Two things happen here. Relative segments are refused: `fetch()` normalizes
 * `..` the way a browser does, so `/player/../fm` would pass the allow list as
 * `/player/<id>/fm` and reach the bot as `/fm`. And every segment is re-encoded,
 * because Fastify hands us the *decoded* wildcard — a song id containing `%` or
 * a space would otherwise go back out as a malformed URL.
 */
export function safeSubPath(wildcard: string): string | null {
  const segments = wildcard.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
  return `/${segments.map(encodeURIComponent).join("/")}`;
}

export interface MusicRouteDeps {
  registry: SessionRegistry;
  logger: Logger;
  /** Per-session call budget; the bot is a small server behind us. */
  limiter?: RateLimiter;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accept any logger/type-provider flavour
type AnyFastify = FastifyInstance<any, any, any, any, any>;

export function registerMusicRoutes(app: AnyFastify, deps: MusicRouteDeps): void {
  app.all<{ Params: { "*": string } }>("/api/music-bot/*", async (request, reply) => {
    const sessionId = request.headers["x-session-id"];
    const session = deps.registry.getConnected(
      typeof sessionId === "string" ? sessionId : undefined,
    );
    if (!session) {
      return reply.code(401).send({ error: "connect to the TeamSpeak server first" });
    }
    if (deps.limiter && !deps.limiter.take(session.id)) {
      return reply.code(429).send({ error: "too many requests" });
    }
    // Each session picked its bot at connect time; without one (bad or
    // blocked target, or the guard still running) there is nothing to proxy to.
    const bridge = session.music;
    if (!bridge) {
      return reply.code(503).send({ error: "hub.musicUnreachable" });
    }
    const wildcard = request.params["*"] ?? "";
    const subPath = safeSubPath(wildcard);
    // The allow list matches the readable form; the bot gets the encoded one.
    if (!subPath || !isAllowed(request.method, `/${wildcard}`)) {
      return reply.code(403).send({ error: "route not allowed" });
    }
    const q = request.url.indexOf("?");
    const query = q >= 0 ? request.url.slice(q) : "";
    const body =
      request.method === "GET" || request.method === "DELETE" ? undefined : (request.body ?? {});
    const path = `/${wildcard}`;
    const locked = modeRefusal(request.method, path, body, (id) => bridge.radioOf(id));
    if (locked) return reply.code(409).send({ error: locked });
    const requester = session.tsSession?.selfNickname ?? "";
    const credit = creditFor(request.method, path, body);
    // Fetched before the call, not read from the cache: the bot announces no
    // single-song add, so the cache can miss songs someone else just queued,
    // which would then look like this call's and be credited to this user.
    let queueBefore: MusicSong[] = [];
    if (credit?.kind === "diff") {
      try {
        queueBefore = await bridge.refreshQueue(credit.botId);
      } catch (err) {
        deps.logger.debug({ err, path }, "queue fetch before a call failed");
        queueBefore = bridge.queueOf(credit.botId);
      }
    }
    try {
      const result = await bridge.request(request.method, `/api${subPath}${query}`, body);
      if (credit && requester && succeeded(result)) {
        try {
          if (credit.kind === "songs") bridge.credit(credit.botId, credit.songs, requester);
          else {
            const after = await bridge.refreshQueue(credit.botId);
            bridge.credit(credit.botId, addedSongs(queueBefore, after), requester, true);
          }
        } catch (err) {
          // The songs are queued either way; only the name shown next to them is lost.
          deps.logger.warn({ err, path }, "could not credit the requester");
        }
      }
      await applyRadio(bridge, request.method, path, body, result, requester, deps.logger);
      const answer =
        request.method === "GET" && result.status === 200
          ? bridge.relabel(path, result.body)
          : result.body;
      return reply.code(result.status).send(answer ?? {});
    } catch (err) {
      deps.logger.warn({ err, subPath }, "music bot proxy failed");
      return reply.code(502).send({ error: "music bot unreachable" });
    }
  });
}

/**
 * Records FM or a recommendation starting (or the queue being replaced) and,
 * on a start, puts the bot in sequential mode: it starts FM in shuffle.
 */
async function applyRadio(
  bridge: PooledBridge,
  method: string,
  path: string,
  body: unknown,
  result: ProxyResult,
  requester: string,
  logger: Logger,
): Promise<void> {
  const change = radioTransition(method, path, body, result);
  if (!change) return;
  if (change.radio) {
    const botPath = `/api/player/${encodeURIComponent(change.botId)}/mode`;
    try {
      const set = await bridge.request("POST", botPath, { mode: LOCKED_MODE });
      if (set.status >= 300) logger.warn({ status: set.status }, "could not lock play mode");
    } catch (err) {
      logger.warn({ err }, "could not lock play mode");
    }
  }
  bridge.setRadio(change.botId, change.radio, requester);
}
