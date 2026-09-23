/**
 * TeamSpeak identity math that the browser can do on its own: deriving the
 * public key from the private scalar, the UID and the security level. Doing it
 * here (instead of asking the hub) means identities can be imported, inspected
 * and generated before any server connection exists.
 *
 * TeamSpeak definitions (libtomcrypt, NIST P-256):
 * - public key string = base64(DER SEQUENCE { BIT STRING 0b0 (7 unused bits), INTEGER 32, INTEGER x, INTEGER y })
 * - UID               = base64(sha1(public key string))
 * - security level    = number of leading zero *bits* of sha1(public key string || decimal counter),
 *                       counted from the least significant bit of each byte.
 */
import { p256 } from "@noble/curves/nist.js";
import { sha1 } from "@noble/hashes/legacy.js";
import {
  TAG_BIT_STRING,
  TAG_SEQUENCE,
  concatBytes,
  encodeInteger,
  encodeNode,
  encodeSmallInteger,
} from "./der";

export const KEY_SIZE = 32;
const encoder = new TextEncoder();

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** Strict: throws on anything that is not canonical-ish standard base64. */
export function base64ToBytes(b64: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 === 1) {
    throw new Error("invalid base64");
  }
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function isValidScalar(d: Uint8Array): boolean {
  return d.length === KEY_SIZE && p256.utils.isValidSecretKey(d);
}

export function randomScalar(): Uint8Array {
  return p256.utils.randomSecretKey();
}

/** Uncompressed point [0x04 || x || y] for a private scalar. */
export function publicPoint(d: Uint8Array): Uint8Array {
  return p256.getPublicKey(d, false);
}

/** The DER body shared by the public and the private export (flag byte aside). */
export function keyDerParts(point: Uint8Array): Uint8Array[] {
  return [
    encodeSmallInteger(KEY_SIZE),
    encodeInteger(point.subarray(1, 1 + KEY_SIZE)),
    encodeInteger(point.subarray(1 + KEY_SIZE)),
  ];
}

/** TeamSpeak's public key string (what the server sees and hashes into the UID). */
export function publicKeyBase64(d: Uint8Array): string {
  const der = encodeNode(
    TAG_SEQUENCE,
    concatBytes(encodeNode(TAG_BIT_STRING, Uint8Array.of(7, 0)), ...keyDerParts(publicPoint(d))),
  );
  return bytesToBase64(der);
}

export function uidFromPublicKey(publicKey: string): string {
  return bytesToBase64(sha1(encoder.encode(publicKey)));
}

/** Zero bits before the first set bit, LSB first within each byte (TeamSpeak's order). */
export function zeroBits(hash: Uint8Array): number {
  let n = 0;
  for (const byte of hash) {
    if (byte === 0) {
      n += 8;
      continue;
    }
    for (let bit = 0; bit < 8; bit++) {
      if (byte & (1 << bit)) return n;
      n++;
    }
  }
  return n;
}

export function securityLevel(publicKey: string, offset: bigint): number {
  return zeroBits(sha1(encoder.encode(publicKey + offset.toString(10))));
}
