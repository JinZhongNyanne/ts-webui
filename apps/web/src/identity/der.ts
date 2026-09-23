/**
 * Just enough ASN.1 DER for TeamSpeak keys: a SEQUENCE of a BIT STRING and
 * INTEGERs, which is what libtomcrypt's `ecc_export` writes and TeamSpeak
 * hashes into a UID. Anything else is rejected rather than half-understood.
 */

export const TAG_INTEGER = 0x02;
export const TAG_BIT_STRING = 0x03;
export const TAG_SEQUENCE = 0x30;

export interface DerNode {
  tag: number;
  value: Uint8Array;
}

function encodeLength(len: number): Uint8Array {
  if (len < 0x80) return Uint8Array.of(len);
  if (len < 0x100) return Uint8Array.of(0x81, len);
  return Uint8Array.of(0x82, (len >> 8) & 0xff, len & 0xff);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function encodeNode(tag: number, value: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.of(tag), encodeLength(value.length), value);
}

/**
 * Minimal two's-complement big-endian INTEGER body: leading zeros stripped, one
 * put back when the top bit is set. Byte-for-byte what TeamSpeak produces, which
 * matters because the UID is a hash of this encoding.
 */
export function integerBody(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  const trimmed = bytes.subarray(start);
  if (trimmed.length === 0) return Uint8Array.of(0);
  return trimmed[0]! & 0x80 ? concatBytes(Uint8Array.of(0), trimmed) : trimmed.slice();
}

export function encodeInteger(bytes: Uint8Array): Uint8Array {
  return encodeNode(TAG_INTEGER, integerBody(bytes));
}

export function encodeSmallInteger(n: number): Uint8Array {
  const bytes: number[] = [];
  let v = n;
  do {
    bytes.unshift(v & 0xff);
    v >>= 8;
  } while (v > 0);
  return encodeInteger(Uint8Array.from(bytes));
}

/** Reads one node at `offset`; throws on truncated or long-form lengths we never produce. */
export function readNode(data: Uint8Array, offset = 0): { node: DerNode; next: number } {
  const tag = data[offset];
  if (tag === undefined) throw new Error("DER: unexpected end of data");
  let at = offset + 1;
  const first = data[at++];
  if (first === undefined) throw new Error("DER: unexpected end of data");
  let len: number;
  if (first < 0x80) len = first;
  else if (first === 0x81) len = data[at++] ?? -1;
  else if (first === 0x82) {
    len = ((data[at] ?? 0) << 8) | (data[at + 1] ?? 0);
    at += 2;
  } else throw new Error("DER: unsupported length encoding");
  if (len < 0 || at + len > data.length) throw new Error("DER: length past end of data");
  return { node: { tag, value: data.subarray(at, at + len) }, next: at + len };
}

/** Parses a top-level SEQUENCE into its direct children. */
export function readSequence(data: Uint8Array): DerNode[] {
  const { node, next } = readNode(data);
  if (node.tag !== TAG_SEQUENCE) throw new Error("DER: expected a SEQUENCE");
  if (next !== data.length) throw new Error("DER: trailing data after the SEQUENCE");
  const children: DerNode[] = [];
  let at = 0;
  while (at < node.value.length) {
    const r = readNode(node.value, at);
    children.push(r.node);
    at = r.next;
  }
  return children;
}

/** An INTEGER body as an unsigned, left-padded fixed-width big-endian number. */
export function integerToFixed(body: Uint8Array, width: number): Uint8Array {
  let start = 0;
  while (start < body.length - 1 && body[start] === 0) start++;
  const trimmed = body.subarray(start);
  if (trimmed.length > width) throw new Error("DER: integer too large");
  const out = new Uint8Array(width);
  out.set(trimmed, width - trimmed.length);
  return out;
}
