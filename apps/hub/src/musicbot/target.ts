/**
 * Where a session's music bot lives.
 *
 * The browser names the bot at connect time (`host`, `host:port` or a full
 * URL); the hub turns that into a base URL and, like the TeamSpeak connect,
 * refuses to dial into private ranges unless the operator allows it or the
 * host is the TeamSpeak server the session just connected to.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { MUSIC_BOT_DEFAULT_PORT } from "@jinz/protocol";
import { isPrivateAddress } from "../security/net.js";

/** Emitted as the `music.unavailable` reason when the target cannot be used. */
export const MUSIC_BAD_TARGET = "hub.musicBadTarget";
export const MUSIC_BLOCKED_TARGET = "hub.musicBlockedTarget";
export const MUSIC_UNREACHABLE = "hub.musicUnreachable";
/** The bot answered, but its HTTPS certificate could not be trusted. */
export const MUSIC_TLS_ERROR = "hub.musicTlsError";

export type LookupFn = (host: string) => Promise<Array<{ address: string }>>;

export interface TargetGuardOptions {
  /** The TeamSpeak host this session connected to; it already passed the TS guard. */
  tsHost: string;
  /** Operator allows loopback/private targets (HUB_ALLOW_PRIVATE_TS_SERVERS). */
  allowPrivate: boolean;
  /**
   * The operator's own MUSICBOT_URL, normalized. Naming it in the config is
   * consent to dial it wherever it lives, private ranges included.
   */
  trustedUrl?: string | null;
  /** Injectable for tests. */
  lookup?: LookupFn;
}

/** What the guard vetted: the address the bridge must dial instead of re-resolving. */
export interface MusicBotTarget {
  /** IP literal to pin the connection to; null when the host was already a literal. */
  address: string | null;
}

/** Upper bound on distinct bots the hub will bridge at once. */
export const MAX_POOLED_BRIDGES = 32;

/** `[::1]` for an IPv6 literal, the host unchanged otherwise. */
function bracketHost(host: string): string {
  return isIP(host) === 6 ? `[${host}]` : host;
}

/** Path without trailing slashes; empty for the root. */
function trimPath(pathname: string): string {
  return pathname.replace(/\/+$/, "");
}

/**
 * Normalizes a non-empty bot address to `http(s)://host[:port][/prefix]`.
 * Returns null for anything that is not a plain host, host:port or http(s) URL.
 */
export function normalizeMusicBotUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;
  if (/^https?:\/\//i.test(raw)) return normalizeFullUrl(raw);
  // Bare host or host:port. Anything with a scheme, userinfo or a path is out.
  if (raw.includes("://") || raw.includes("@") || raw.includes("/")) return null;
  const candidate = isIP(raw) === 6 ? `[${raw}]` : raw;
  const parsed = tryUrl(`http://${candidate}`);
  if (!parsed || !parsed.hostname || parsed.pathname !== "/") return null;
  const port = parsed.port || String(MUSIC_BOT_DEFAULT_PORT);
  return `http://${parsed.hostname}:${port}`;
}

function normalizeFullUrl(raw: string): string | null {
  const parsed = tryUrl(raw);
  if (!parsed || !parsed.hostname || parsed.username || parsed.password) return null;
  return `${parsed.origin}${trimPath(parsed.pathname)}`;
}

function tryUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * Resolves the bot base URL for a session: the requested address when given,
 * otherwise the TeamSpeak host on the bot's default port.
 */
export function resolveMusicBotUrl(input: string | undefined, tsHost: string): string | null {
  const raw = input?.trim() ?? "";
  if (!raw) return `http://${bracketHost(tsHost)}:${MUSIC_BOT_DEFAULT_PORT}`;
  return normalizeMusicBotUrl(raw);
}

/** Hostname of a normalized bot URL, lower-cased and without IPv6 brackets. */
export function musicBotHost(url: string): string {
  const parsed = tryUrl(url);
  return (parsed?.hostname ?? "").replace(/^\[|\]$/g, "").toLowerCase();
}

function sameHost(a: string, b: string): boolean {
  return a.replace(/^\[|\]$/g, "").toLowerCase() === b.replace(/^\[|\]$/g, "").toLowerCase();
}

/** Port of a normalized bot URL, with the scheme default filled in. */
export function musicBotPort(url: string): number {
  const parsed = tryUrl(url);
  if (!parsed) return 0;
  if (parsed.port) return Number(parsed.port);
  return parsed.protocol === "https:" ? 443 : 80;
}

const defaultLookup: LookupFn = (host) => dnsLookup(host, { all: true });

function codedError(code: string, cause?: unknown): Error {
  const e = new Error(code);
  e.name = "MusicTargetError";
  if (cause !== undefined) e.cause = cause;
  return e;
}

/**
 * Vets a bot URL and returns the address to dial.
 *
 * Throws `hub.musicBadTarget` when `url` is null, `hub.musicUnreachable` when
 * its host does not resolve and `hub.musicBlockedTarget` when it resolves to a
 * private address the hub may not dial. The host is resolved exactly once; the
 * bridge dials the returned address so a name that answers differently on a
 * second lookup (DNS rebinding) cannot walk past this check.
 *
 * Exemptions from the private-range rule: the operator allows private targets,
 * the URL is the operator's own MUSICBOT_URL, or the host is the TeamSpeak
 * server the session just connected to and the port is the bot's default
 * (the TS host was vetted as a voice target, not as an arbitrary HTTP one).
 */
export async function assertMusicBotTarget(
  url: string | null,
  opts: TargetGuardOptions,
): Promise<MusicBotTarget> {
  if (!url) throw codedError(MUSIC_BAD_TARGET);
  const host = musicBotHost(url);
  if (!host) throw codedError(MUSIC_BAD_TARGET);
  const exempt =
    opts.allowPrivate ||
    (opts.trustedUrl != null && url === opts.trustedUrl) ||
    (sameHost(host, opts.tsHost) && musicBotPort(url) === MUSIC_BOT_DEFAULT_PORT);
  if (isIP(host)) {
    if (!exempt && isPrivateAddress(host)) throw codedError(MUSIC_BLOCKED_TARGET);
    return { address: null };
  }
  const lookup = opts.lookup ?? defaultLookup;
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host);
  } catch (err) {
    throw codedError(MUSIC_UNREACHABLE, err);
  }
  // Prefer IPv4: most bots listen on it, and a name like localhost answers ::1 first.
  const first = addresses.find((a) => isIP(a.address) === 4)?.address ?? addresses[0]?.address;
  if (!first) throw codedError(MUSIC_UNREACHABLE);
  if (!exempt && addresses.some((a) => isPrivateAddress(a.address))) {
    throw codedError(MUSIC_BLOCKED_TARGET);
  }
  return { address: first };
}
