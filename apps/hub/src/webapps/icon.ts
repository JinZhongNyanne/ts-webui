/**
 * Finding a website's icon for the Apps window.
 *
 * The page cannot load it itself: the app's CSP allows images from its own
 * origin only. So the hub reads the site's HTML for `<link rel=icon>` (and
 * the apple-touch-icon, which is usually the sharpest), falls back to
 * `/favicon.ico`, and keeps the first one that really is an image. Every
 * request goes through the outbound guard, so a private address yields no
 * icon rather than a probe into the hub's network.
 */
import {
  fetchPublicFollowing,
  type AddressResolver,
  type OutboundOptions,
} from "../security/outbound.js";

export const ICON_MAX_BYTES = 256 * 1024;
const PAGE_MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 5_000;
/** Icons tried after the page's own links, at most. */
const MAX_CANDIDATES = 4;

export const ICON_TYPES: readonly string[] = [
  "image/png",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/svg+xml",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

export interface SiteIcon {
  readonly contentType: string;
  readonly body: Buffer;
}

interface IconLink {
  readonly href: string;
  /** Higher first: apple-touch-icon, then the largest declared size. */
  readonly rank: number;
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * The icon URLs a page declares, best first, resolved against `base`. Only
 * the `<head>` is looked at; a regex is enough for `<link>` tags, which have
 * no content, and a broken page just yields fewer candidates.
 */
export function findIconLinks(html: string, base: URL): string[] {
  const end = html.search(/<\/head>/i);
  const head = end >= 0 ? html.slice(0, end) : html;
  const links: IconLink[] = [];
  for (const [tag] of head.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase().split(/\s+/);
    const isTouch =
      rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed");
    if (!isTouch && !rel.includes("icon")) continue;
    const href = attr(tag, "href");
    if (!href) continue;
    let url: URL;
    try {
      url = new URL(decodeEntities(href), base);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "data:") continue;
    const sizes = (attr(tag, "sizes") ?? "").toLowerCase();
    const size =
      sizes === "any"
        ? 512
        : Math.max(0, ...[...sizes.matchAll(/(\d+)x\d+/g)].map((m) => Number(m[1])));
    links.push({ href: url.toString(), rank: (isTouch ? 10_000 : 0) + size });
  }
  return [...links].sort((a, b) => b.rank - a.rank).map((l) => l.href);
}

/** An inline `data:image/...;base64,` icon, decoded; null for anything else. */
export function decodeDataIcon(href: string): SiteIcon | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(href);
  if (!match) return null;
  const contentType = match[1]!.toLowerCase();
  if (!ICON_TYPES.includes(contentType)) return null;
  const body = Buffer.from(match[2]!, "base64");
  return body.byteLength > 0 && body.byteLength <= ICON_MAX_BYTES ? { contentType, body } : null;
}

/**
 * The type to serve an icon as, or null when the bytes are no icon at all.
 * favicon.ico is often served as application/octet-stream, so the ICO magic
 * number counts too.
 */
export function iconType(contentType: string, body: Buffer): string | null {
  const declared = contentType.split(";")[0]!.trim().toLowerCase();
  if (ICON_TYPES.includes(declared)) return declared;
  if (body.length >= 4 && body[0] === 0 && body[1] === 0 && body[2] === 1 && body[3] === 0) {
    return "image/x-icon";
  }
  if (
    body.length >= 8 &&
    body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return "image/png";
  }
  return null;
}

export interface IconDeps {
  readonly resolve?: AddressResolver;
}

/** The site's icon, or null when it has none the hub may fetch. */
export async function fetchSiteIcon(site: URL, deps: IconDeps = {}): Promise<SiteIcon | null> {
  const opts = (accept: string, maxBytes: number, truncate = false): OutboundOptions => ({
    accept,
    maxBytes,
    timeoutMs: TIMEOUT_MS,
    resolve: deps.resolve,
    truncate,
  });

  // Only the head matters, so a long page is read up to the cap, not refused.
  const page = await fetchPublicFollowing(site, opts("text/html", PAGE_MAX_BYTES, true));
  const pageUrl = page.ok ? (page.finalUrl ?? site) : site;
  const links =
    page.ok && /text\/html|xhtml/i.test(page.response.contentType)
      ? findIconLinks(page.response.body.toString("utf8"), pageUrl)
      : [];
  const fallback = new URL("/favicon.ico", pageUrl).toString();

  for (const href of new Set([...links.slice(0, MAX_CANDIDATES), fallback])) {
    if (href.startsWith("data:")) {
      const inline = decodeDataIcon(href);
      if (inline) return inline;
      continue;
    }
    const result = await fetchPublicFollowing(new URL(href), opts("image/*", ICON_MAX_BYTES));
    if (!result.ok || result.response.status !== 200) continue;
    const type = iconType(result.response.contentType, result.response.body);
    if (type && result.response.body.byteLength > 0) {
      return { contentType: type, body: result.response.body };
    }
  }
  return null;
}
