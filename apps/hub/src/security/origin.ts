/**
 * Origin checks for the websocket handshake and for state-changing HTTP calls.
 *
 * The hub has no cookie session — every authenticated call carries the session
 * id the browser was handed over its own websocket — so a foreign page cannot
 * silently act as a user. The origin check is the second lock: it stops a page
 * that has somehow learned a session id (a leaked URL, a shared screen) from
 * using it from the browser it leaked into.
 */

/** Lowercases and strips a trailing slash so `https://x/` and `https://x` match. */
export function normalizeOrigin(origin: string): string {
  return origin.trim().toLowerCase().replace(/\/+$/, "");
}

/** Any localhost/127.0.0.1/::1 origin, whatever port the dev server picked. */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export interface OriginPolicy {
  /** Origins the operator configured (already normalized). */
  allowed: string[];
  /** Outside production any loopback origin is fine: `npm run dev` picks its own port. */
  allowLoopback: boolean;
}

/**
 * Decides on the `Origin` header. A missing header is accepted: non-browser
 * clients omit it, and a browser never omits it for a cross-origin request, so
 * nothing is gained by refusing.
 */
export function isOriginAllowed(origin: string | undefined, policy: OriginPolicy): boolean {
  if (!origin) return true;
  const value = normalizeOrigin(origin);
  if (!value || value === "null") return false;
  if (policy.allowed.includes(value)) return true;
  return policy.allowLoopback && isLoopbackOrigin(value);
}
