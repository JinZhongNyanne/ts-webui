/**
 * What a ban rule (`banadd`) may say, checked by the hub before it goes out
 * and by the web dialog while it is typed.
 *
 * Every web user reaches TeamSpeak from the hub's one address, so a careless
 * rule does not lock out one person but all of them at once. Checked on a live
 * TS3 3.13 server:
 *  - `name` is a regular expression matched against the *whole* nickname,
 *    case-sensitively (`qzprobe` banned "qzprobe", not "xqzprobey" or
 *    "QZPROBE"; `(a+)+$` banned "aaaa"), so `.*` bans everyone. A broken
 *    expression is refused with 1540.
 *  - `ip` is stored as given, whatever it is (`not-an-ip`, `10\.250\..*`).
 *    Ranges are not something the web tools need, so only a literal address
 *    goes out: a literal can only ever match itself.
 *
 * The messages are text codes (see text-code.ts) the web client translates.
 */

export type BanRuleProblem =
  "tsErr.banIpInvalid" | "tsErr.banNameInvalid" | "tsErr.banNameMatchesAll" | "tsErr.banNameUnsafe";

const IPV4_OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4 = new RegExp(`^${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}$`);
/** Hex groups and colons, optionally ending in a dotted quad; the URL parser does the rest. */
const IPV6_CHARS = /^[0-9A-Fa-f:.]+$/;

/** The address in one spelling (IPv6 lower-case and compressed, IPv4-mapped as IPv4), or null. */
export function canonicalIp(ip: string): string | null {
  if (IPV4.test(ip)) return ip;
  if (!ip.includes(":") || !IPV6_CHARS.test(ip)) return null;
  let host: string;
  try {
    host = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  } catch {
    return null;
  }
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (!mapped) return host;
  const [hi, lo] = [parseInt(mapped[1]!, 16), parseInt(mapped[2]!, 16)];
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
}

/** Whether two strings are the same (valid) address, however each is spelled. */
export function sameIp(a: string, b: string): boolean {
  const ca = canonicalIp(a);
  return ca !== null && ca === canonicalIp(b);
}

export function banIpProblem(ip: string): BanRuleProblem | null {
  return canonicalIp(ip) === null ? "tsErr.banIpInvalid" : null;
}

/**
 * Made-up nicknames no deliberate rule aims at. The server compares whole
 * nicknames, so a pattern that takes one of these (or the empty one) takes
 * practically anyone.
 */
const SAMPLE_NICKNAMES = ["q7-ZxK_w9", "Vt3 pL0 mQ", "测试用户Xy8", "ü.Hk2~r#"];

/** More unbounded repeats than this in one rule is a backtracking risk by itself. */
const MAX_UNBOUNDED = 4;

interface Scan {
  /** A repeated group that repeats something inside it: `(a+)+`, `(a*)*`, `((a+)b){2,}`. */
  nested: boolean;
  /** `*`, `+` and `{n,}` outside character classes. */
  unbounded: number;
}

/** Reads a quantifier at `i`: its length and whether it repeats (not just `?`); null if none. */
function quantifierAt(
  p: string,
  i: number,
): { len: number; repeats: boolean; open: boolean } | null {
  const c = p[i];
  let len = 0;
  let repeats = false;
  let open = false;
  if (c === "*" || c === "+") {
    len = 1;
    repeats = true;
    open = true;
  } else if (c === "?") {
    len = 1;
  } else if (c === "{") {
    const m = /^\{(\d+)(,(\d*))?\}/.exec(p.slice(i));
    if (!m) return null;
    len = m[0].length;
    const max = m[2] === undefined ? Number(m[1]) : m[3] === "" ? Infinity : Number(m[3]);
    repeats = max > 1;
    open = max === Infinity;
  } else {
    return null;
  }
  // A lazy or possessive marker belongs to the same quantifier.
  if (p[i + len] === "?" || p[i + len] === "+") len++;
  return { len, repeats, open };
}

/**
 * A structural scan (no matching): groups on a stack, each remembering whether
 * anything inside it is quantified; escapes and character classes skipped.
 */
function scan(p: string): Scan {
  const stack: boolean[] = [];
  let nested = false;
  let unbounded = 0;
  /** Whether the atom just closed was a group with a quantifier inside. */
  let lastGroupQuantified = false;
  for (let i = 0; i < p.length;) {
    const c = p[i]!;
    if (c === "\\") {
      i += 2;
      lastGroupQuantified = false;
    } else if (c === "[") {
      let j = i + 1;
      if (p[j] === "^") j++;
      while (j < p.length && p[j] !== "]") j += p[j] === "\\" ? 2 : 1;
      i = j + 1;
      lastGroupQuantified = false;
    } else if (c === "(") {
      stack.push(false);
      i += p[i + 1] === "?" ? 3 : 1;
      lastGroupQuantified = false;
    } else if (c === ")") {
      const inner = stack.pop() ?? false;
      // A quantified group makes its parent quantified too.
      if (inner && stack.length) stack[stack.length - 1] = true;
      lastGroupQuantified = inner;
      i++;
    } else {
      const q = quantifierAt(p, i);
      if (q) {
        if (q.open) unbounded++;
        if (q.repeats && lastGroupQuantified) nested = true;
        if (stack.length) stack[stack.length - 1] = true;
        lastGroupQuantified = false;
        i += q.len;
      } else {
        lastGroupQuantified = false;
        i++;
      }
    }
  }
  return { nested, unbounded };
}

export function banNameProblem(name: string): BanRuleProblem | null {
  let whole: RegExp;
  try {
    // On its own first: `x)|(.*` must not turn valid once wrapped.
    new RegExp(name);
    whole = new RegExp(`^(?:${name})$`);
  } catch {
    return "tsErr.banNameInvalid";
  }
  // Before any matching: the hub must not backtrack itself to a halt either.
  const { nested, unbounded } = scan(name);
  if (nested || unbounded > MAX_UNBOUNDED) return "tsErr.banNameUnsafe";
  if (whole.test("") || SAMPLE_NICKNAMES.some((n) => whole.test(n))) {
    return "tsErr.banNameMatchesAll";
  }
  return null;
}
