/**
 * Fetching a URL someone else chose (an album cover, a website's icon).
 *
 * Taken literally that is an SSRF hole: the hub would fetch whatever the
 * host can reach — loopback, the docker network, a cloud metadata service. So
 * the host is resolved once, every answer refused if any of them is private,
 * and the socket pinned to the address that was vetted, so a name that
 * answers differently on a second lookup cannot slip past. Redirects are not
 * followed by fetch; `fetchPublicFollowing` re-checks every hop itself. Bodies
 * are read up to a cap, so a slow endless response cannot fill the heap.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { Agent, type Dispatcher } from "undici";
import { isPrivateAddress } from "./net.js";

/** Resolves a hostname to every address it currently answers with. */
export type AddressResolver = (host: string) => Promise<readonly string[]>;

export const systemResolver: AddressResolver = async (host) => {
  const answers = await dnsLookup(host, { all: true });
  return answers.map((a) => a.address);
};

/** A `lookup` that always answers with the one address that was vetted. */
export function pinnedLookup(address: string): LookupFunction {
  const family = isIP(address);
  return (_hostname, options, callback) => {
    const cb = callback as (...args: unknown[]) => void;
    if (typeof options === "object" && options !== null && "all" in options && options.all) {
      cb(null, [{ address, family }]);
    } else {
      cb(null, address, family);
    }
  };
}

/** IPv6 hostnames arrive bracketed from `URL`; DNS and the guard want them bare. */
export function bareHost(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

export interface OutboundOptions {
  readonly accept: string;
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly resolve?: AddressResolver;
  /** Keep the first `maxBytes` of a longer body instead of failing (an HTML head). */
  readonly truncate?: boolean;
}

export interface OutboundResponse {
  readonly status: number;
  readonly contentType: string;
  /** Empty unless the status is 2xx. */
  readonly body: Buffer;
  /** The absolute redirect target of a 3xx, if it named one. */
  readonly location: string | null;
}

/** Why nothing was fetched: the host is unusable, or the transfer failed. */
export type OutboundFailure = "host" | "private" | "failed" | "tooLarge";

export type OutboundResult =
  | { readonly ok: true; readonly response: OutboundResponse }
  | { readonly ok: false; readonly reason: OutboundFailure };

/** Reads at most `maxBytes`; a longer body is cut there with `truncate`, else null. */
export async function readCapped(
  response: Response,
  maxBytes: number,
  truncate = false,
): Promise<Buffer | null> {
  const stream = response.body;
  if (!stream) {
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.byteLength <= maxBytes) return buf;
    return truncate ? buf.subarray(0, maxBytes) : null;
  }
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value as Uint8Array);
      total += chunk.byteLength;
      if (total > maxBytes) {
        if (!truncate) return null;
        chunks.push(chunk.subarray(0, chunk.byteLength - (total - maxBytes)));
        break;
      }
      chunks.push(chunk);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks);
}

/** One request to a public http(s) address, redirects returned rather than followed. */
export async function fetchPublic(url: URL, opts: OutboundOptions): Promise<OutboundResult> {
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "host" };
  if (url.username || url.password) return { ok: false, reason: "host" };
  const host = bareHost(url.hostname);
  if (!host) return { ok: false, reason: "host" };

  let addresses: readonly string[];
  try {
    addresses = await (opts.resolve ?? systemResolver)(host);
  } catch {
    return { ok: false, reason: "host" };
  }
  const target = addresses[0];
  if (!target) return { ok: false, reason: "host" };
  if (addresses.some((a) => isPrivateAddress(a))) return { ok: false, reason: "private" };

  const agent: Dispatcher = new Agent({ connect: { lookup: pinnedLookup(target) } });
  try {
    const response = await fetch(url.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs),
      headers: { accept: opts.accept },
      // undici's own Dispatcher type and the one Node ships for global
      // fetch are structurally different declarations of the same thing.
      dispatcher: agent,
    } as unknown as RequestInit);
    const contentType = (response.headers.get("content-type") ?? "").trim();
    const rawLocation = response.headers.get("location");
    let location: string | null = null;
    if (response.status >= 300 && response.status < 400 && rawLocation) {
      try {
        location = new URL(rawLocation, url).toString();
      } catch {
        location = null;
      }
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return {
        ok: true,
        response: { status: response.status, contentType, body: Buffer.alloc(0), location },
      };
    }
    const declared = Number(response.headers.get("content-length") ?? "");
    if (!opts.truncate && Number.isFinite(declared) && declared > opts.maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, reason: "tooLarge" };
    }
    const body = await readCapped(response, opts.maxBytes, opts.truncate);
    if (!body) return { ok: false, reason: "tooLarge" };
    return { ok: true, response: { status: response.status, contentType, body, location: null } };
  } catch {
    return { ok: false, reason: "failed" };
  } finally {
    await agent.close().catch(() => undefined);
  }
}

/** Like `fetchPublic`, following up to `maxRedirects` redirects, each hop vetted anew. */
export async function fetchPublicFollowing(
  url: URL,
  opts: OutboundOptions,
  maxRedirects = 3,
): Promise<OutboundResult & { finalUrl?: URL }> {
  let current = url;
  for (let hop = 0; ; hop++) {
    const result = await fetchPublic(current, opts);
    if (!result.ok) return result;
    const { location } = result.response;
    if (!location || hop >= maxRedirects) return { ...result, finalUrl: current };
    current = new URL(location);
  }
}
