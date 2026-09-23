/**
 * Whether the server's host banner (and host button image) may load.
 *
 * Loading an external image tells its host the viewer's IP address, and the
 * banner's address is whatever the server's owner typed in — so, as with an
 * `[img]` in chat (ts/bbcode.ts), it only loads after a click unless the
 * viewer already trusts it:
 *  - its host is on the chat's "always load" list (the same allowlist `[img]`
 *    uses, stores/chatSettings.ts), or
 *  - the viewer chose "always load" for this banner host on this server.
 *
 * The second is remembered per server *and* host, so a server that later
 * points its banner at another host asks again. Pure, so it is testable;
 * useBannerConsent.ts persists the list.
 */
import { safeHttpUrl } from "../../ts/bbcode";

export type BannerDecision =
  | { readonly kind: "none" }
  | { readonly kind: "show"; readonly url: string }
  | { readonly kind: "ask"; readonly url: string; readonly host: string };

export interface BannerContext {
  /** Which server this is (chat/history.ts's historyServerKey). */
  readonly serverKey: string;
  readonly consents: ReadonlySet<string>;
  /** The chat's image allowlist. */
  readonly hostAllowed: (host: string) => boolean;
}

/** Cap on remembered consents; the oldest go first. */
export const MAX_BANNER_CONSENTS = 100;
/** A server key plus a host is well under this; anything longer is not ours. */
const MAX_CONSENT_LENGTH = 512;

export function consentKey(serverKey: string, host: string): string {
  return `${serverKey} ${host.toLowerCase()}`;
}

export function bannerDecision(rawUrl: string, ctx: BannerContext): BannerDecision {
  const url = safeHttpUrl(rawUrl);
  if (!url) return { kind: "none" };
  const host = new URL(url).host;
  if (ctx.hostAllowed(host) || ctx.consents.has(consentKey(ctx.serverKey, host))) {
    return { kind: "show", url };
  }
  return { kind: "ask", url, host };
}

export function withConsent(list: readonly string[], key: string): string[] {
  if (list.includes(key)) return [...list];
  return [...list, key].slice(-MAX_BANNER_CONSENTS);
}

/** localStorage is the user's to edit; only a list of short strings comes back from it. */
export function normalizeConsents(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const keys = raw.filter(
    (k): k is string => typeof k === "string" && k.length > 0 && k.length <= MAX_CONSENT_LENGTH,
  );
  return [...new Set(keys)].slice(-MAX_BANNER_CONSENTS);
}
