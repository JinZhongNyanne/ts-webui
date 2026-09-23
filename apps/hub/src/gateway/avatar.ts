/**
 * Where a client's avatar lives in the server's internal file store.
 *
 * TeamSpeak names the file after the owner's UID, not after the hash in
 * `client_flag_avatar`: `/avatar_` plus the UID's bytes written as hex with
 * the digits 0–f shifted to the letters a–p (so the name is safe on every
 * file system). The hash only tells clients which version is current, which
 * makes it the right cache key and the wrong file name.
 */
import { createHash } from "node:crypto";

const MD5_HEX = /^[0-9a-f]{32}$/;

/** Whether `client_flag_avatar` is a hash the hub can check: an MD5 in hex. */
export function isAvatarHash(hash: string): boolean {
  return MD5_HEX.test(hash.toLowerCase());
}

/**
 * Whether `file` is the avatar version `hash` names, so it may be served and
 * cached under it. Native clients (and ours) put the file's MD5 there, and
 * nothing else is served: the flag is free text to the server, so anyone
 * could point theirs at someone else's hash and have their picture shown
 * under it. Bytes that do not match are nobody's avatar — between an upload
 * and the flag change they are the *next* version, whose own hash will fetch
 * them again.
 */
export function avatarMatches(file: Buffer, hash: string): boolean {
  const key = hash.toLowerCase();
  return MD5_HEX.test(key) && createHash("md5").update(file).digest("hex") === key;
}

/** The UID (base64 of a SHA-1) as TeamSpeak's a–p "hex". Empty for an empty UID. */
export function uidToAvatarName(uid: string): string {
  const bytes = Buffer.from(uid, "base64");
  let out = "";
  for (const b of bytes) out += String.fromCharCode(97 + (b >> 4), 97 + (b & 0x0f));
  return out;
}

/** The internal file path of `uid`'s avatar, or null when the UID decodes to nothing. */
export function avatarPath(uid: string): string | null {
  const name = uidToAvatarName(uid);
  return name ? `/avatar_${name}` : null;
}
