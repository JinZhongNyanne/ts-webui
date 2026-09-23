/**
 * Why a picture could not become a sticker, in words. Shared by the picker
 * and by "add to stickers" on a chat picture, so both say the same thing.
 */
import { MAX_STICKER_BYTES, MAX_STICKER_PIXELS, formatBytes } from "@jinz/protocol";
import { t, type MessageKey } from "../i18n";
import type { StickerUploadError } from "./rules";

const UPLOAD_ERRORS: Record<StickerUploadError, MessageKey> = {
  empty: "stickers.errEmpty",
  tooBig: "stickers.errTooBig",
  type: "stickers.errType",
  tooLarge: "stickers.errTooLarge",
  full: "stickers.errFull",
  name: "stickers.errName",
  pack: "stickers.errPack",
  failed: "stickers.errFailed",
};

/** The limits the messages mention. */
export const STICKER_LIMITS = {
  max: formatBytes(MAX_STICKER_BYTES),
  pixels: String(MAX_STICKER_PIXELS),
} as const;

export function stickerErrorText(error: StickerUploadError): string {
  return t(UPLOAD_ERRORS[error], STICKER_LIMITS);
}
