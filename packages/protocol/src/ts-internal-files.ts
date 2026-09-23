/**
 * Avatars and icons (M3): the files in channel 0, TeamSpeak's internal store,
 * and how native clients name them. Checked on a live TS3 3.13 server:
 *
 *  - An avatar is uploaded to (and downloaded from) `/avatar_` plus the
 *    owner's UID bytes in a–p "hex" (0–f shifted to letters). `ftdeletefile`
 *    wants `/avatar_<base64 UID>` instead and converts it itself (the a–p
 *    name answers 1540 "convert error"); deleting needs
 *    b_client_avatar_delete_other even for one's own avatar. Uploading is
 *    only limited by i_client_max_avatar_filesize (0 = none, too big = 2565
 *    at init), and the server does not check whose name it is.
 *  - `client_flag_avatar` is free text to the server; native clients put the
 *    file's MD5 in lowercase hex there, and so does the hub's parser.
 *  - An icon is `/icon_<id>`, listed under `/icons` (b_icon_manage to list,
 *    upload or delete; i_max_icon_filesize, 8192 bytes for Server Admin).
 *    Native clients use the CRC-32 of the bytes as the id, unsigned in the
 *    name; the server takes any id. Permissions (i_icon_id) store it as an
 *    int32, so ids above 2^31 travel negative there.
 *  - Ids below 1000 are the client's built-in group icons, not files.
 */

/** Where channel 0 lists its icons. */
export const ICON_DIR = "/icons";

/** Ids below this are built into every client. */
export const BUILTIN_ICON_LIMIT = 1000;

/** A `client_flag_avatar` we send: an MD5 in lowercase hex, or "" for none. */
export const AVATAR_MD5 = /^(?:[0-9a-f]{32})?$/;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_TEXT = /^[A-Za-z0-9+/]+={0,2}$/;

/** Standard base64 to bytes; null for anything else (no Buffer/atob: shared code). */
function base64Bytes(text: string): Uint8Array | null {
  if (!B64_TEXT.test(text)) return null;
  const clean = text.replace(/=+$/, "");
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of clean) {
    acc = (acc << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** The UID (base64 of a SHA-1) as TeamSpeak's a–p "hex"; "" when it is not base64. */
export function uidToAvatarName(uid: string): string {
  const bytes = base64Bytes(uid);
  if (!bytes) return "";
  let out = "";
  for (const b of bytes) out += String.fromCharCode(97 + (b >> 4), 97 + (b & 0x0f));
  return out;
}

/** Where `uid`'s avatar is uploaded and downloaded; null for a UID that is not base64. */
export function avatarFilePath(uid: string): string | null {
  const name = uidToAvatarName(uid);
  return name ? `/avatar_${name}` : null;
}

/** The name `ftdeletefile` takes for `uid`'s avatar (see the file comment). */
export function avatarDeleteName(uid: string): string | null {
  return B64_TEXT.test(uid) ? `/avatar_${uid}` : null;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3, as zlib), unsigned. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The id a native client gives an icon file: the CRC-32 of its bytes. */
export function iconIdOf(bytes: Uint8Array): number {
  return crc32(bytes);
}

/** The icon's file in channel 0; the id may be signed (as permissions carry it). */
export function iconFilePath(iconId: number): string {
  return `/icon_${iconId >>> 0}`;
}

/** An icon id as the int32 an `i_icon_id` permission value is. */
export function iconPermValue(iconId: number): number {
  return iconId | 0;
}

export function isBuiltinIconId(iconId: number): boolean {
  const id = iconId >>> 0;
  return id > 0 && id < BUILTIN_ICON_LIMIT;
}

const ICON_NAME = /^icon_(\d{1,10})$/;

/** The id in an `/icons` listing entry's name (`icon_<id>`); null for other files. */
export function iconIdFromFileName(name: string): number | null {
  const m = ICON_NAME.exec(name);
  if (!m) return null;
  const id = Number(m[1]);
  return id > 0 && id <= 0xffffffff ? id : null;
}

/**
 * What the hub lets a page upload to channel 0: the caller's own avatar, and
 * icon files (their id is not checked against the bytes: it cannot be before
 * they have gone to the server, and the server does not either).
 */
export function isInternalUploadPath(path: string, selfUid: string): boolean {
  const own = avatarFilePath(selfUid);
  return (own !== null && path === own) || isIconFilePath(path);
}

/**
 * An uploaded icon's file, in the one spelling the server and the hub's
 * cache use: `/icon_05000` would be another file than `/icon_5000`.
 */
export function isIconFilePath(path: string): boolean {
  const icon = path.startsWith("/") ? iconIdFromFileName(path.slice(1)) : null;
  return icon !== null && !isBuiltinIconId(icon) && path === iconFilePath(icon);
}

/** Channel 0, the internal store, whatever the spelling (a second guard behind DECIMAL_ID). */
export function isInternalChannelId(cid: string): boolean {
  return /^0+$/.test(cid);
}
