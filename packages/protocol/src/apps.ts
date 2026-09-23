/**
 * The websites shown in the Apps window, shared by everyone on a hub, and the
 * rules for adding one. The hub enforces them; the page checks the same rules
 * first so the user gets an answer without a round trip.
 */

export interface SharedApp {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  /** Revision of the site icon the hub fetched; null when it found none. */
  readonly iconRev: number | null;
  /** Nickname of whoever added it. */
  readonly addedBy: string;
  readonly addedAt: number;
}

export const MAX_APPS = 30;
export const MAX_APP_NAME_LENGTH = 40;
const MAX_URL_LENGTH = 2048;

export type AppUrlError = "invalid" | "sameOrigin";

/**
 * Turns what the user typed into an embeddable URL. A bare host gets
 * `https://`; anything but http(s), or with credentials in it, is refused.
 * So are the app's own origins: a framed page from there, with scripts
 * allowed, could reach the app's storage (identities, passwords) through its
 * parent.
 */
export function normalizeAppUrl(
  input: string,
  ownOrigins: readonly string[],
): { url: string } | { error: AppUrlError } {
  const raw = input.trim();
  if (!raw || raw.length > MAX_URL_LENGTH) return { error: "invalid" };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: "invalid" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { error: "invalid" };
  if (!url.hostname || url.username || url.password) return { error: "invalid" };
  if (ownOrigins.includes(url.origin)) return { error: "sameOrigin" };
  return { url: url.href };
}

/** The name shown for a site: what the user typed, else the host. */
export function appName(name: string, url: string): string {
  const trimmed = name.trim().slice(0, MAX_APP_NAME_LENGTH);
  if (trimmed) return trimmed;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
