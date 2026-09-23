/**
 * Validation for the album-cover proxy's `url` query parameter.
 *
 * Kept free of Fastify, undici and DNS so the rules can be tested on their
 * own. Everything here is a pure function over the raw query value.
 */

/** Why a cover URL was refused; the route turns any of these into a 400. */
export type CoverUrlRejection =
  | "missing" // no url query at all
  | "unparsable" // not a URL
  | "scheme" // not http(s): file:, ftp:, data: ...
  | "userinfo" // user:pass@host, which hides the real host from a reader
  | "host"; // empty hostname

export type CoverUrlCheck =
  | { readonly ok: true; readonly url: URL; readonly host: string }
  | { readonly ok: false; readonly reason: CoverUrlRejection };

const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:"]);

/** IPv6 hostnames arrive bracketed from `URL`; DNS and the guard want them bare. */
export function bareHost(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

/**
 * Accepts only an absolute http(s) URL with no credentials in it. The bot
 * hands out plain-http CDN links, so http stays allowed — the point of the
 * proxy is that the browser never speaks to that CDN itself.
 */
export function checkCoverUrl(raw: unknown): CoverUrlCheck {
  if (typeof raw !== "string" || raw.length === 0) return { ok: false, reason: "missing" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "unparsable" };
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) return { ok: false, reason: "scheme" };
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "userinfo" };
  const host = bareHost(url.hostname);
  if (host === "") return { ok: false, reason: "host" };
  return { ok: true, url, host };
}
