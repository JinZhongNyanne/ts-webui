/**
 * Serves the built web UI, with cache rules that survive a redeploy.
 *
 * The page used to come back blank after an update until a hard reload. The
 * HTML was cacheable (`public, max-age=0`), and Chrome shows a restored tab or
 * a back/forward visit from cache without asking the server at all; only
 * `no-store` stops that. The stale page then asks for the previous build's
 * hashed scripts, which no longer exist, and the SPA fallback answered those
 * with index.html. A browser will not run HTML as a module script, so nothing
 * ran at all. So:
 *
 *  - HTML is `no-store`: every visit gets the page of the running build.
 *  - `/assets/*` names carry a content hash, so they are cached for good.
 *  - Other files (the audio worklets, the manifest and the icons in
 *    `public/`) keep their names across builds and are revalidated each time.
 *    That matters most for `/sw.js`: a service worker pinned by an immutable
 *    header could not be replaced, so a bad one would outlive a redeploy.
 *  - A missing file is a real 404, never index.html; only extension-less
 *    paths (client-side routes) fall back to the page.
 */
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

export const HTML_CACHE = "no-store";
export const HASHED_ASSET_CACHE = "public, max-age=31536000, immutable";
export const REVALIDATE_CACHE = "no-cache";

/** `/x/y.js`, `/favicon.ico`: a request for a file, not a page. */
const FILE_LIKE = /\/[^/]*\.[a-z0-9]+$/i;

function pathOf(url: string): string {
  return url.split("?", 1)[0] ?? "";
}

function isApiPath(path: string): boolean {
  return path === "/api" || path.startsWith("/api/") || path === "/ws" || path.startsWith("/ws/");
}

/** The Cache-Control a web UI response should carry; null leaves it alone. */
export function webUiCacheControl(
  path: string,
  status: number,
  contentType: string,
): string | null {
  if (isApiPath(path)) return null;
  if (contentType.includes("text/html") || status >= 400) return HTML_CACHE;
  if (path.startsWith("/assets/")) return HASHED_ASSET_CACHE;
  return REVALIDATE_CACHE;
}

export async function registerWebUi(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accept any logger/type-provider flavour
  app: FastifyInstance<any, any, any, any, any>,
  root: string,
): Promise<void> {
  await app.register(fastifyStatic, { root, wildcard: false, cacheControl: false });

  app.addHook("onSend", async (request, reply, payload) => {
    const cache = webUiCacheControl(
      pathOf(request.url),
      reply.statusCode,
      String(reply.getHeader("content-type") ?? ""),
    );
    if (cache) reply.header("cache-control", cache);
    return payload;
  });

  app.setNotFoundHandler((request, reply) => {
    const path = pathOf(request.raw.url ?? "");
    if (isApiPath(path)) {
      void reply.code(404).send({ error: "not found" });
      return;
    }
    // A stale page asking for a previous build's script must see it fail,
    // not receive HTML it would refuse to run (the boot guard then reloads).
    if (path.startsWith("/assets/") || FILE_LIKE.test(path)) {
      void reply.code(404).type("text/plain; charset=utf-8").send("not found");
      return;
    }
    void reply.sendFile("index.html");
  });
}
