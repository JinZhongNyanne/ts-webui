/**
 * The `Range` header of a media request, reduced to what TeamSpeak can do.
 *
 * `ftinitdownload` takes a start (`seekpos`) and nothing else: the server
 * then sends everything from there to the end. So every range is answered as
 * open-ended, `bytes=a-b` as `a-`, which RFC 9110 allows (a server may send
 * more than was asked for as long as `Content-Range` says what it sent), and
 * which is what a `<video>` asks for anyway. A suffix range (`bytes=-n`) is
 * the last `n` bytes, so it too is a start.
 *
 * Anything that is not one plain range — several ranges, another unit, a
 * malformed header — is ignored and the whole file served, as the RFC allows:
 * the hub never tries to assemble a multipart answer out of several transfers.
 *
 * An empty file has no byte a range could start at, so every range of one
 * would be 416 — including the `bytes=0-` a player opens with, which left a
 * zero-byte clip failing instead of being empty. Its range is ignored and it
 * is served whole: 200 and nothing.
 */

export type RangeRequest =
  /** No usable range: 200, the whole file. */
  | { readonly kind: "whole" }
  /** 206, from `start` to the last byte. */
  | { readonly kind: "from"; readonly start: number }
  /** 416: the range starts at or past the end of the file. */
  | { readonly kind: "unsatisfiable" };

const WHOLE: RangeRequest = { kind: "whole" };
const UNSATISFIABLE: RangeRequest = { kind: "unsatisfiable" };

/** Digits only, and few enough that the number is exact (see FT_MAX_FILE_SIZE). */
const FROM = /^bytes=(\d{1,15})-(\d{0,15})$/;
const SUFFIX = /^bytes=-(\d{1,15})$/;

export function parseRange(header: string | string[] | undefined, size: number): RangeRequest {
  if (typeof header !== "string" || size === 0) return WHOLE;
  const from = FROM.exec(header);
  if (from) {
    const start = Number(from[1]);
    const end = from[2] ? Number(from[2]) : undefined;
    // A range that ends before it starts is not a range at all.
    if (end !== undefined && end < start) return WHOLE;
    return start < size ? { kind: "from", start } : UNSATISFIABLE;
  }
  const suffix = SUFFIX.exec(header);
  if (suffix) {
    const length = Number(suffix[1]);
    if (length === 0 || size === 0) return UNSATISFIABLE;
    return { kind: "from", start: Math.max(0, size - length) };
  }
  return WHOLE;
}

/** `Content-Range` of a 206 that runs from `start` to the end of a `size`-byte file. */
export function contentRange(start: number, size: number): string {
  return `bytes ${start}-${size - 1}/${size}`;
}

/** `Content-Range` of a 416: only the file's length. */
export function unsatisfiedRange(size: number): string {
  return `bytes */${size}`;
}

/**
 * How many bytes a transfer started at `start` will send, from the size its
 * `notifystartdownload` announced; null when that fits neither reading.
 *
 * The announced size is taken either way it could be meant — the whole file
 * (what the link was minted with) or what is left of it from `start` — so the
 * arithmetic does not rest on one server version's habit. Anything else means
 * the file changed under the link since it was minted, and a `Content-Range`
 * made of two different files would only confuse the player.
 */
export function bytesFrom(announced: number, size: number, start: number): number | null {
  // An empty file, read from its start, is nothing to send (see parseRange).
  if (size === 0) return announced === 0 && start === 0 ? 0 : null;
  if (start >= size) return null;
  if (announced === size) return size - start;
  return announced === size - start ? announced : null;
}
