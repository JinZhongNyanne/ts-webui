/**
 * Whether a `ts3file://` link in chat points at the server this page is on.
 *
 * A link carries the address the sender's client knows (and sometimes the
 * virtual server's UID, which the page is never told), but nothing else
 * about it: channel id and path alone would resolve against *our* server, so
 * a link from another server would offer a download of whatever file happens
 * to sit at that path here. Such a card is shown without buttons instead.
 *
 * The page's own addresses are not certain either: a name can have several
 * spellings and an address may be an IP on one side and a name on the other,
 * which a browser cannot resolve. Where it is genuinely ambiguous the link
 * counts as ours (the download is then simply refused by the server if it is
 * not); only two addresses that can be compared, and differ, make it foreign.
 */
export interface ServerAddress {
  readonly host: string;
  /** Only compared when both sides say (the same host on two ports is two servers). */
  readonly port?: number;
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const clean = (host: string) => host.trim().toLowerCase().replace(/\.$/, "");
const isAddress = (host: string) => IPV4.test(host) || host.includes(":");

/** True unless `link` names an address of ours that we can tell apart from it. */
export function linkIsHere(
  link: { host: string; port?: number },
  known: readonly ServerAddress[],
): boolean {
  const host = clean(link.host);
  // Nothing to compare with, or an address that says nothing about the server.
  if (!known.length || !host || LOOPBACK.has(host)) return true;
  return known.some((mine) => {
    const ours = clean(mine.host);
    if (!ours || LOOPBACK.has(ours)) return true;
    // An IP against a name (or the other way round): not ours to decide.
    if (isAddress(host) !== isAddress(ours)) return true;
    if (host !== ours) return false;
    return mine.port === undefined || link.port === undefined || mine.port === link.port;
  });
}
