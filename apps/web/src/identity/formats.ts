/**
 * The identity string formats we read and write.
 *
 * - **hub** (`@honeybbq/teamspeak-client`): `base64(32-byte private scalar):counter`.
 *   This is what the hub accepts on `connect` and sends back in `connected`.
 * - **TeamSpeak 3** (`identity=` in an exported `.ini`): `counter` `V`
 *   `base64(obfuscate(base64(tomcrypt DER private key)))`. The obfuscation
 *   XORs the first 100 bytes with a fixed key, then XORs the first 20 bytes
 *   with sha1 of the bytes from 20 up to the first NUL. Reference: TS3AudioBot
 *   `TsCrypt.DeobfuscateAndImportTsIdentity`, tsclientlib `from_ts_obfuscated`,
 *   landave/TSIdentityTool.
 * - **tomcrypt** (TS3AudioBot and friends): the bare `base64(DER)` key, with no
 *   counter; imported at counter 0.
 *
 * The tomcrypt DER flag byte says what the key holds: 0x80 = x, y and the
 * private scalar (what TeamSpeak writes), 0xC0 = the private scalar only
 * (TS3AudioBot's short form).
 */
import { sha1 } from "@noble/hashes/legacy.js";
import {
  TAG_BIT_STRING,
  TAG_INTEGER,
  TAG_SEQUENCE,
  concatBytes,
  encodeInteger,
  encodeNode,
  integerToFixed,
  readSequence,
} from "./der";
import {
  KEY_SIZE,
  base64ToBytes,
  bytesToBase64,
  isValidScalar,
  keyDerParts,
  publicPoint,
} from "./keys";

export interface IdentityKey {
  /** Private scalar, exactly 32 bytes. */
  d: Uint8Array;
  /** Security level counter (TeamSpeak calls it the key offset). */
  offset: bigint;
}

export type IdentityErrorCode =
  "empty" | "unrecognized" | "badBase64" | "badKey" | "noPrivateKey" | "keyMismatch" | "badCounter";

/** Parse failure with a code the UI turns into a translated message. */
export class IdentityError extends Error {
  constructor(readonly code: IdentityErrorCode) {
    super(`identity: ${code}`);
    this.name = "IdentityError";
  }
}

const MAX_OFFSET = (1n << 64n) - 1n;
const OBFUSCATION_KEY = new TextEncoder().encode(
  "b9dfaa7bee6ac57ac7b65f1094a1c155e747327bc2fe5d51c512023fe54a280201004e90ad1daaae1075d53b7d571c30e063b5a62a4a017bb394833aa0983e6e",
);
const OBFUSCATED_PREFIX = 20;
const OBFUSCATED_SPAN = 100;
const FLAG_FULL = 0x80;
const FLAG_SHORT = 0xc0;

function parseOffset(text: string): bigint {
  if (!/^\d{1,20}$/.test(text)) throw new IdentityError("badCounter");
  const n = BigInt(text);
  if (n > MAX_OFFSET) throw new IdentityError("badCounter");
  return n;
}

function decode(b64: string): Uint8Array {
  try {
    return base64ToBytes(b64);
  } catch {
    throw new IdentityError("badBase64");
  }
}

function checkScalar(d: Uint8Array): Uint8Array {
  if (!isValidScalar(d)) throw new IdentityError("badKey");
  return d;
}

/* ---------------------------- hub format ---------------------------- */

export function parseHubIdentity(text: string): IdentityKey {
  const cut = text.lastIndexOf(":");
  if (cut < 0) throw new IdentityError("unrecognized");
  const offset = parseOffset(text.slice(cut + 1));
  const raw = decode(text.slice(0, cut));
  if (raw.length === 0 || raw.length > KEY_SIZE) throw new IdentityError("badKey");
  const d = new Uint8Array(KEY_SIZE);
  d.set(raw, KEY_SIZE - raw.length);
  return { d: checkScalar(d), offset };
}

export function formatHubIdentity(key: IdentityKey): string {
  return `${bytesToBase64(key.d)}:${key.offset.toString(10)}`;
}

/* --------------------------- tomcrypt DER --------------------------- */

export function exportTomcrypt(d: Uint8Array): string {
  const der = encodeNode(
    TAG_SEQUENCE,
    concatBytes(
      encodeNode(TAG_BIT_STRING, Uint8Array.of(7, FLAG_FULL)),
      ...keyDerParts(publicPoint(d)),
      encodeInteger(d),
    ),
  );
  return bytesToBase64(der);
}

export function importTomcrypt(der: Uint8Array): Uint8Array {
  let nodes;
  try {
    nodes = readSequence(der);
  } catch {
    throw new IdentityError("badKey");
  }
  const [bits, ...ints] = nodes;
  if (!bits || bits.tag !== TAG_BIT_STRING || bits.value.length !== 2) {
    throw new IdentityError("badKey");
  }
  if (ints.some((n) => n.tag !== TAG_INTEGER)) throw new IdentityError("badKey");
  const flag = bits.value[1]!;
  const fixed = (i: number): Uint8Array => {
    const node = ints[i];
    if (!node) throw new IdentityError("noPrivateKey");
    try {
      return integerToFixed(node.value, KEY_SIZE);
    } catch {
      throw new IdentityError("badKey");
    }
  };
  if (flag === FLAG_SHORT) return checkScalar(fixed(1));
  if (flag !== FLAG_FULL) throw new IdentityError("noPrivateKey");
  const d = checkScalar(fixed(3));
  // A key whose stored public half disagrees with its private half would get a
  // different UID on the server than the one we show; refuse it outright.
  const point = publicPoint(d);
  const x = fixed(1);
  const y = fixed(2);
  const same = x.every((b, i) => b === point[1 + i]) && y.every((b, i) => b === point[33 + i]);
  if (!same) throw new IdentityError("keyMismatch");
  return d;
}

/* ------------------------ TeamSpeak 3 obfuscated -------------------- */

function hashTail(data: Uint8Array): Uint8Array {
  const tail = data.subarray(OBFUSCATED_PREFIX);
  const nul = tail.indexOf(0);
  return sha1(nul < 0 ? tail : tail.subarray(0, nul));
}

export function obfuscate(plain: string): string {
  const data = new TextEncoder().encode(plain);
  for (let i = 0; i < Math.min(OBFUSCATED_SPAN, data.length); i++) data[i]! ^= OBFUSCATION_KEY[i]!;
  const hash = hashTail(data);
  for (let i = 0; i < OBFUSCATED_PREFIX; i++) data[i]! ^= hash[i]!;
  return bytesToBase64(data);
}

export function deobfuscate(b64: string): string {
  const data = decode(b64).slice();
  if (data.length < OBFUSCATED_PREFIX) throw new IdentityError("badKey");
  const hash = hashTail(data);
  for (let i = 0; i < OBFUSCATED_PREFIX; i++) data[i]! ^= hash[i]!;
  for (let i = 0; i < Math.min(OBFUSCATED_SPAN, data.length); i++) data[i]! ^= OBFUSCATION_KEY[i]!;
  let end = data.length;
  while (end > 0 && data[end - 1] === 0) end--;
  let out = "";
  for (let i = 0; i < end; i++) out += String.fromCharCode(data[i]!);
  return out;
}

const TS3_PATTERN = /^(\d+)V([A-Za-z0-9+/]+={0,2})$/;

export function isTs3Identity(text: string): boolean {
  return TS3_PATTERN.test(text);
}

export function parseTs3Identity(text: string): IdentityKey {
  const m = TS3_PATTERN.exec(text);
  if (!m) throw new IdentityError("unrecognized");
  const offset = parseOffset(m[1]!);
  const d = importTomcrypt(decode(deobfuscate(m[2]!)));
  return { d, offset };
}

export function formatTs3Identity(key: IdentityKey): string {
  return `${key.offset.toString(10)}V${obfuscate(exportTomcrypt(key.d))}`;
}

/* ------------------------------ any ------------------------------ */

/**
 * One identity string in whichever format it came: TeamSpeak `NV…`, the hub's
 * `scalar:counter`, or a bare tomcrypt key. Surrounding quotes are forgiven
 * because people copy the `identity="…"` value straight out of an `.ini`.
 */
export function parseIdentityString(input: string): IdentityKey {
  const text = input
    .trim()
    .replace(/^"(.*)"$/s, "$1")
    .trim();
  if (!text) throw new IdentityError("empty");
  if (isTs3Identity(text)) return parseTs3Identity(text);
  if (text.includes(":")) return parseHubIdentity(text);
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return { d: importTomcrypt(decode(text)), offset: 0n };
  throw new IdentityError("unrecognized");
}
