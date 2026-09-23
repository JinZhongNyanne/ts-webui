/**
 * Response headers every reply carries.
 *
 * Two of these matter more than the rest here: `nosniff`, because the hub
 * serves user-uploaded icons and sounds and a browser must never guess a type
 * for them, and `no-referrer`, because asset URLs carry the session id and a
 * Referer would hand it to any host the page links to.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

/**
 * The web UI loads everything from the hub itself. `wasm-unsafe-eval` is for
 * the Opus decoder used by browsers without WebCodecs; `blob:` covers the
 * audio worklets, camera/screen streams and object URLs for local previews.
 * `frame-src` lets the Apps window show the websites users pin; without it
 * the frames fall back to `default-src 'self'` and every one is blocked. The
 * page's own origin is refused when a site is added (a same-origin frame with
 * scripts could read the app's storage), and an https page cannot frame an
 * http one anyway (mixed content).
 *
 * `img-src` allows `https:` because two features show images from hosts the
 * server's owner or a chat author named: the server's host banner (and host
 * button image), and `[img]` in chat. Held to `'self'`, the production page
 * blocked every one of them even after the viewer clicked "load" — a broken
 * image, which the e2e rig never saw because the vite dev server sends no
 * CSP at all. The protection that matters is already on the page: neither
 * loads anything external until the viewer consents, per host (or has put
 * the host on the "always load" list), and both send no Referer. An image
 * cannot run script, so what the CSP would add over that consent is only a
 * second refusal of what the viewer asked for. Plain `http:` stays out: an
 * https page cannot load it anyway (mixed content). Nothing else is widened,
 * and API_CSP and WORKER_CSP are untouched.
 */
export const APP_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "frame-src https: http:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self' ws: wss: blob:",
].join("; ");

/** Nothing an API response returns should ever be loaded as a document. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

/** Where the built web UI serves its service worker from (`apps/web/public/sw.js`). */
export const SERVICE_WORKER_PATH = "/sw.js";

/**
 * A service worker runs under the CSP of its own script response, not the
 * page's. Left on `API_CSP` it would install and then do nothing at all: with
 * `default-src 'none'` its `fetch()` calls are blocked, so every request it
 * handles fails and the app appears offline while online. Hence its own
 * policy, still `'none'` by default and widened only to this origin —
 * `script-src` for the script itself (and any `importScripts`), `connect-src`
 * for the same-origin asset fetches it fills its cache from.
 */
export const WORKER_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** The Content-Security-Policy a response should carry. */
export function cspFor(path: string, contentType: string): string {
  if (path === SERVICE_WORKER_PATH) return WORKER_CSP;
  return contentType.includes("text/html") ? APP_CSP : API_CSP;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accept any fastify type-provider flavour
type AnyFastify = FastifyInstance<any, any, any, any, any>;

export function registerSecurityHeaders(app: AnyFastify, opts: { isProd: boolean }): void {
  app.addHook("onSend", (request: FastifyRequest, reply: FastifyReply, payload, done) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-frame-options", "DENY");
    reply.header("cross-origin-resource-policy", "same-origin");
    // Microphone, camera and screen share are the point of the app; nothing else is.
    reply.header(
      "permissions-policy",
      "microphone=(self), camera=(self), display-capture=(self), " +
        "geolocation=(), payment=(), usb=(), interest-cohort=()",
    );
    const type = String(reply.getHeader("content-type") ?? "");
    reply.header("content-security-policy", cspFor(pathOf(request.url), type));
    if (opts.isProd && isHttps(request)) {
      reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    }
    done(null, payload);
  });
}

/** The path alone: a query string never decides a policy. */
function pathOf(url: string): string {
  return url.split("?", 1)[0] ?? "";
}

function isHttps(request: FastifyRequest): boolean {
  return request.protocol === "https";
}
