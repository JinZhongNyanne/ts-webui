/**
 * Resolves the TeamSpeak host exactly once and pins the answer.
 *
 * The outbound guard used to resolve the name, refuse private answers, and
 * then hand the *hostname* to the driver, which resolved it again on its own
 * (myTeamSpeak, `_ts3._udp` SRV, TSDNS, plain A record). A name that answers
 * differently between those lookups (DNS rebinding) or an SRV record pointing
 * elsewhere bypassed the guard. Now the guard's own answer is the address the
 * driver dials, through a resolver that never touches DNS.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { AddrResolver, ResolvedAddr } from "@honeybbq/teamspeak-client";
import { isPrivateAddress } from "../security/net.js";

export type LookupFn = (host: string) => Promise<Array<{ address: string }>>;

export interface DialTargetOptions {
  /** Injectable for tests; defaults to `dns.lookup` with every answer. */
  lookup?: LookupFn;
  /** Allow loopback/private answers (development or an operator-listed server). */
  allowPrivate: boolean;
}

export interface DialTarget {
  /** The IPv4 address the driver will dial. */
  address: string;
}

/** The `source` the pinned resolver reports, visible in the driver's debug log. */
export const PINNED_SOURCE = "hub-pinned";

const defaultLookup: LookupFn = (host) => dnsLookup(host, { all: true });

function codedError(code: string, name: string, cause?: unknown): Error {
  const err = new Error(code);
  err.name = name;
  if (cause !== undefined) err.cause = cause;
  return err;
}

/** Text codes the web client translates; see text-code.ts. */
export const dnsFailed = (cause?: unknown): Error =>
  codedError("hub.connectDnsFailed", "DnsLookupFailed", cause);
export const targetBlocked = (): Error => codedError("hub.connectBlockedTarget", "TargetBlocked");

/**
 * One lookup, every answer guarded, first IPv4 picked.
 *
 * All answers are checked, not just the chosen one, so a name that mixes a
 * public and a private address cannot be used to smuggle the private one past
 * the guard. The driver only opens a `udp4` socket, so a name with no IPv4
 * answer is reported as unresolvable rather than surfacing an opaque dgram
 * error later.
 */
export async function resolveDialTarget(
  host: string,
  opts: DialTargetOptions,
): Promise<DialTarget> {
  const lookup = opts.lookup ?? defaultLookup;
  let answers: Array<{ address: string }>;
  try {
    answers = await lookup(host);
  } catch (err) {
    throw dnsFailed(err);
  }
  // The browser picks this address, so a public hub would otherwise dial
  // whatever its host can reach — its own loopback, the docker network, a
  // cloud metadata service — and report back what answered.
  if (!opts.allowPrivate && answers.some((a) => isPrivateAddress(a.address))) {
    throw targetBlocked();
  }
  const v4 = answers.find((a) => isIP(a.address) === 4);
  if (!v4) throw dnsFailed(new Error(`no IPv4 address for ${host}`));
  return { address: v4.address };
}

/** `[::1]` for an IPv6 literal, the address unchanged otherwise. */
function bracketAddress(address: string): string {
  return isIP(address) === 6 ? `[${address}]` : address;
}

/**
 * A driver resolver that answers with the guard's address whatever it is
 * asked. `expiry` is the epoch so the driver never treats it as cacheable
 * beyond this connection.
 */
export function pinnedResolver(address: string, port: number): AddrResolver {
  const pinned: ResolvedAddr = {
    addr: `${bracketAddress(address)}:${port}`,
    source: PINNED_SOURCE,
    expiry: new Date(0),
  };
  return {
    resolve: async () => [pinned],
  };
}
