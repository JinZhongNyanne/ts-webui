/**
 * Stickers: small pictures people keep on the hub and drop into chat.
 *
 * Two scopes. `shared` is the hub's, like the soundboard: everyone connected
 * sees it and may add to it. `personal` belongs to one TeamSpeak identity and
 * follows it to any device, like the profile assets. Inside each scope people
 * make their own packs; a sticker with no pack sits in the implicit
 * "ungrouped" one. Packs never nest.
 *
 * A picture is stored once per hub, under the SHA-256 of its bytes, and a
 * sticker entry points at that hash — so the same picture in both scopes, or
 * twice in one pack, costs one file. The hash also names the file uploaded
 * into a channel when a sticker is sent, which is what lets the second send
 * reuse the first one's upload.
 *
 * The hub enforces every rule here; the page checks the same ones first so
 * the user gets an answer without a round trip.
 */

export type StickerScope = "shared" | "personal";

export type StickerImageType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

/** A user-made group inside one scope. Packs do not nest. */
export interface StickerPack {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
}

export interface Sticker {
  readonly id: string;
  readonly name: string;
  /** The pack it sits in, or null for "ungrouped". */
  readonly packId: string | null;
  /** SHA-256 of the picture, in hex: the file it shares with every other entry on it. */
  readonly hash: string;
  /** What the picture really is, from its first bytes. */
  readonly contentType: StickerImageType;
  readonly bytes: number;
  /** Nickname of whoever added this entry. */
  readonly addedBy: string;
  readonly addedAt: number;
}

/** One scope's contents, as the hub hands them out and pushes them. */
export interface StickerSet {
  readonly scope: StickerScope;
  readonly packs: readonly StickerPack[];
  readonly stickers: readonly Sticker[];
}

export const MAX_SHARED_STICKERS = 500;
export const MAX_PERSONAL_STICKERS = 200;
export const MAX_STICKER_PACKS = 50;
export const MAX_STICKER_BYTES = 512 * 1024;
export const MAX_STICKER_NAME_LENGTH = 32;
/**
 * The largest picture worth keeping as a sticker, in either direction. Only
 * the page can measure it (the hub does not decode images), so this is a
 * courtesy check on top of the byte cap, which is the real limit.
 */
export const MAX_STICKER_PIXELS = 1024;

/** File extensions to store (and name) each type with. */
export const STICKER_EXTENSIONS: Readonly<Record<StickerImageType, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** How many entries a scope may hold. */
export function maxStickersIn(scope: StickerScope): number {
  return scope === "shared" ? MAX_SHARED_STICKERS : MAX_PERSONAL_STICKERS;
}

export function isStickerScope(value: unknown): value is StickerScope {
  return value === "shared" || value === "personal";
}

export function isStickerImageType(value: unknown): value is StickerImageType {
  return typeof value === "string" && Object.hasOwn(STICKER_EXTENSIONS, value);
}

/** Control, format and zero-width characters: invisible in a tile, confusing in a name. */
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;

/** A sticker or pack name as stored: trimmed, single-spaced, 1–32 characters; else null. */
export function normalizeStickerName(input: string): string | null {
  if (typeof input !== "string") return null;
  const name = input.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  const length = [...name].length;
  return length >= 1 && length <= MAX_STICKER_NAME_LENGTH ? name : null;
}

/** The name a dropped file suggests: its base name without the extension. */
export function stickerNameFromFile(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const stem = base.replace(/\.[^.]*$/, "");
  const cut = [...stem].slice(0, MAX_STICKER_NAME_LENGTH).join("");
  return normalizeStickerName(cut) ?? "sticker";
}

const HASH_RE = /^[0-9a-f]{64}$/;

/** Whether `value` is a SHA-256 in lower-case hex, as the store names blobs. */
export function isStickerHash(value: unknown): value is string {
  return typeof value === "string" && HASH_RE.test(value);
}

/** How much of the hash names the file sent into a channel. */
export const STICKER_FILE_HASH_CHARS = 12;

/**
 * The name a sticker's picture gets in a channel's file store. It is derived
 * from the hash alone, so the same picture from any user, pack or scope lands
 * on the same name — and a channel that already has it needs no second
 * upload. Empty when the hash is not one of ours.
 */
export function stickerFileName(hash: string, contentType: StickerImageType): string {
  if (!isStickerHash(hash) || !isStickerImageType(contentType)) return "";
  return `sticker_${hash.slice(0, STICKER_FILE_HASH_CHARS)}.${STICKER_EXTENSIONS[contentType]}`;
}

function ascii(data: Uint8Array, at: number, text: string): boolean {
  if (data.length < at + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (data[at + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function bytesAt(data: Uint8Array, at: number, expected: readonly number[]): boolean {
  if (data.length < at + expected.length) return false;
  return expected.every((b, i) => data[at + i] === b);
}

/**
 * What a picture really is, judged from its first bytes, or null when it is
 * none of the supported kinds. The browser's claimed type is never used: it
 * comes from the file name, and a sticker is served back to browsers.
 *
 * SVG is deliberately absent: it is a document that can carry scripts.
 */
export function sniffStickerType(data: Uint8Array): StickerImageType | null {
  if (bytesAt(data, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (bytesAt(data, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(data, 0, "GIF87a") || ascii(data, 0, "GIF89a")) return "image/gif";
  if (ascii(data, 0, "RIFF") && ascii(data, 8, "WEBP")) return "image/webp";
  return null;
}
