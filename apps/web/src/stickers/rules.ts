/**
 * What the sticker picker checks before it asks the hub, and the small bits
 * of list keeping around it: which pack a sticker shows under, what a search
 * matches, and which stickers were used last.
 *
 * The hub enforces the same rules (packages/protocol/src/stickers.ts); doing
 * them here as well means the user is told about a file that is too big, or
 * not a picture at all, without waiting for a round trip — and the byte cap
 * is checked before the page reads the file.
 *
 * Pure, so it can be tested on plain node.
 */
import {
  MAX_STICKER_BYTES,
  MAX_STICKER_PIXELS,
  maxStickersIn,
  sniffStickerType,
  type Sticker,
  type StickerPack,
  type StickerScope,
} from "@jinz/protocol";

/** Why a file cannot become a sticker; each has an i18n key of its own. */
export type StickerUploadError =
  "empty" | "tooBig" | "type" | "tooLarge" | "full" | "name" | "pack" | "failed";

/** Bytes enough to recognise any supported format. */
export const SNIFF_BYTES = 64;

/** How many stickers the picker remembers as "recently used". */
export const MAX_RECENT_STICKERS = 24;

/**
 * Whether a picked file can be a sticker at all, from its size, its first
 * bytes and how full the scope already is. Null when it may be uploaded.
 */
export function checkStickerFile(
  size: number,
  head: Uint8Array,
  scope: StickerScope,
  have: number,
): StickerUploadError | null {
  if (size === 0) return "empty";
  if (size > MAX_STICKER_BYTES) return "tooBig";
  if (!sniffStickerType(head)) return "type";
  if (have >= maxStickersIn(scope)) return "full";
  return null;
}

/** Whether a decoded picture is within the pixel cap; only the page can tell. */
export function checkStickerPixels(width: number, height: number): StickerUploadError | null {
  const biggest = Math.max(width, height);
  return biggest > MAX_STICKER_PIXELS ? "tooLarge" : null;
}

export interface StickerGroup {
  /** The pack, or null for the implicit "ungrouped" one. */
  readonly pack: StickerPack | null;
  readonly stickers: readonly Sticker[];
}

/**
 * One scope's stickers under their packs, packs first in their own order and
 * "ungrouped" last. An empty pack is kept: it is somewhere to drop things.
 */
export function groupStickers(
  packs: readonly StickerPack[],
  stickers: readonly Sticker[],
): StickerGroup[] {
  const groups = packs.map((pack) => ({
    pack,
    stickers: stickers.filter((s) => s.packId === pack.id),
  }));
  const loose = stickers.filter((s) => s.packId === null || !packs.some((p) => p.id === s.packId));
  return loose.length > 0 ? [...groups, { pack: null, stickers: loose }] : groups;
}

/** Whether a sticker's name matches what was typed (case and accents folded loosely). */
export function matchesSticker(sticker: Sticker, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  return q === "" || sticker.name.toLocaleLowerCase().includes(q);
}

/**
 * `id` at the front of the recently-used list, without a second copy of it,
 * cut to MAX_RECENT_STICKERS. A new list; the old one is left alone.
 */
export function pushRecent(
  recent: readonly string[],
  id: string,
  max = MAX_RECENT_STICKERS,
): string[] {
  return [id, ...recent.filter((x) => x !== id)].slice(0, max);
}

/** The recently-used list with everything that is no longer a sticker dropped. */
export function pruneRecent(recent: readonly string[], stickers: readonly Sticker[]): string[] {
  const known = new Set(stickers.map((s) => s.id));
  return recent.filter((id) => known.has(id));
}

/** The stickers of `recent`, in that order; ids nothing answers to are skipped. */
export function recentStickers(recent: readonly string[], stickers: readonly Sticker[]): Sticker[] {
  const byId = new Map(stickers.map((s) => [s.id, s]));
  return recent.flatMap((id) => {
    const sticker = byId.get(id);
    return sticker ? [sticker] : [];
  });
}
