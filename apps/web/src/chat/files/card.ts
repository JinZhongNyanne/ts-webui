/**
 * What a rendered file card (bbcode.ts, `.bb-file`) says, read back from its
 * data attributes. They came out of our own renderer, but the DOM is not the
 * place to start trusting them: everything is checked again.
 */
import { normalizeFtFilePath } from "@jinz/protocol";

/** Images larger than this are not previewed (they are loaded into memory whole). */
export const PREVIEW_MAX_BYTES = 10 * 1024 * 1024;
/**
 * Videos larger than this are not fetched whole to be played in the page
 * (chat/files/videos.ts).
 *
 * A hub that hands out media links streams a video instead, a range at a time,
 * and then no cap applies: nothing is held but what the player buffers. Only a
 * hub without them (see video-source.ts) leaves the page fetching the clip
 * whole before it plays, and for that the cap is what someone will happily
 * wait for on a home connection and what a browser tab can hold in memory
 * without complaint: a few dozen seconds of phone video. Anything bigger keeps
 * its Download button and says why, so nobody is left watching a progress bar
 * for half a gigabyte.
 */
export const VIDEO_MAX_BYTES = 32 * 1024 * 1024;

export interface CardFile {
  cid: string;
  path: string;
  /** Bytes, when the link said. */
  size?: number;
}

export function readCard(data: {
  ftCid?: string;
  ftPath?: string;
  ftSize?: string;
}): CardFile | null {
  const cid = data.ftCid ?? "";
  const path = normalizeFtFilePath(data.ftPath ?? "");
  // Channel 0 is the server's own store (avatars and icons, see
  // ts-internal-files.ts), not a channel anyone shares files in.
  if (!/^[1-9]\d{0,19}$/.test(cid) || !path || path !== data.ftPath) return null;
  const size = /^\d{1,15}$/.test(data.ftSize ?? "") ? Number(data.ftSize) : undefined;
  return size === undefined ? { cid, path } : { cid, path, size };
}

/** Whether an image of `size` bytes (undefined: unknown until loaded) may be previewed. */
export function canPreview(size: number | undefined): boolean {
  return size === undefined || size <= PREVIEW_MAX_BYTES;
}

/**
 * Whether a video of `size` bytes may be played in the page: any size when it
 * is `streamed`, up to VIDEO_MAX_BYTES when it must be fetched whole. An
 * unknown size is allowed through, as for a picture: the transfer itself
 * carries the limit and stops before the bytes pass it.
 */
export function canPlayVideo(size: number | undefined, streamed = false): boolean {
  return streamed || size === undefined || size <= VIDEO_MAX_BYTES;
}
