/**
 * Album cover proxy.
 *
 * The music bot reports cover art as an absolute URL on a third-party CDN,
 * usually over plain http. The page can load neither: the app's CSP allows
 * images from `'self'` only, and an https deployment blocks http images as
 * mixed content. So the hub fetches the picture itself and serves the bytes
 * from its own origin, the way it already does for TeamSpeak icons.
 *
 * Fetching a browser-supplied URL is an SSRF hole if taken literally, so the
 * URL is checked (http/https, no credentials), its host resolved once, every
 * answer refused if any of them is private, and the socket pinned to the
 * address that was vetted — a name that answers differently on the second
 * lookup cannot slip past the guard.
 */
import type { FastifyInstance } from "fastify";
import type { AssetRegistry } from "../session/asset-registry.js";
import type { Logger } from "../logger.js";
import type { RateLimiter } from "../security/limits.js";
import { fetchPublic, type AddressResolver } from "../security/outbound.js";
import { checkCoverUrl } from "./cover-url.js";
import { CoverCache } from "./cover-cache.js";

export type { AddressResolver } from "../security/outbound.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accept any fastify type-provider flavour
type AnyFastify = FastifyInstance<any, any, any, any, any>;

export const COVER_ROUTE = "/api/music-bot-cover/:token";
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 5_000;

export interface CoverRouteDeps {
  registry: AssetRegistry;
  logger: Logger;
  /** Per-session budget; a queue of rows must not become a burst at the CDN. */
  limiter?: RateLimiter;
  /** Swapped in tests; production resolves through the system resolver. */
  resolve?: AddressResolver;
  cache?: CoverCache;
}

interface Fetched {
  readonly contentType: string;
  readonly body: Buffer;
}

export function registerCoverRoutes(app: AnyFastify, deps: CoverRouteDeps): void {
  const cache = deps.cache ?? new CoverCache();

  app.get<{ Params: { token: string }; Querystring: { url?: string } }>(
    COVER_ROUTE,
    async (request, reply) => {
      // Like the icon routes: an `<img>` cannot send a header, so the URL
      // carries the short-lived asset token, and an unknown one looks exactly
      // like a missing picture.
      const session = deps.registry.getConnectedByAssetToken(request.params.token);
      if (!session) return reply.code(404).send();
      if (deps.limiter && !deps.limiter.take(session.id)) {
        return reply.code(429).send({ error: "too many requests" });
      }

      const checked = checkCoverUrl(request.query.url);
      if (!checked.ok) return reply.code(400).send({ error: `bad cover url: ${checked.reason}` });
      const { url, host } = checked;

      const hit = cache.get(url.toString());
      if (hit) return send(reply, hit);

      const result = await fetchPublic(url, {
        accept: "image/*",
        maxBytes: MAX_BYTES,
        timeoutMs: TIMEOUT_MS,
        resolve: deps.resolve,
      });
      if (!result.ok && (result.reason === "host" || result.reason === "private")) {
        deps.logger.warn({ host, reason: result.reason }, "cover host refused");
        const what = result.reason === "private" ? "private host" : "host";
        return reply.code(400).send({ error: `bad cover url: ${what}` });
      }
      const response = result.ok ? result.response : null;
      if (
        !response ||
        response.status < 200 ||
        response.status >= 300 ||
        !/^image\//i.test(response.contentType) ||
        response.body.byteLength === 0
      ) {
        if (!result.ok) deps.logger.warn({ host, reason: result.reason }, "cover fetch failed");
        return reply.code(502).send({ error: "cover unavailable" });
      }
      const cover = { contentType: response.contentType, body: response.body };
      cache.set(url.toString(), cover);
      return send(reply, cover);
    },
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fastify reply flavour
function send(reply: any, cover: Fetched): unknown {
  return reply
    .header("content-type", cover.contentType)
    .header("x-content-type-options", "nosniff")
    .header("cache-control", "private, max-age=3600")
    .send(cover.body);
}
