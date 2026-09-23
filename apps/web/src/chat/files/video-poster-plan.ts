/**
 * The decisions behind a chat video poster (video-poster.ts), kept free of the
 * DOM so they can be tested without a `<video>` element.
 *
 * ## Why the poster lets go of its stream
 *
 * A streamed clip's poster and its player share one media link, and the hub
 * lets a link run one stream at a time: a new request on it cuts the one still
 * running (hub `files/media-routes.ts`). A poster left holding its request
 * would therefore be cut the moment the player asked for its first range, and
 * a media loader that retries the cut load cuts the player in turn — each cut
 * spending one of the session's media opens a minute, until the page is
 * refused with a 429. So the poster reads only as far as its first frame,
 * copies that frame into a still, and then drops its source altogether. From
 * then on it is a picture, and only the player ever holds a stream.
 *
 * ## The steps
 *
 * `loading` until the metadata arrives; then the first frame is captured at
 * once if it came with it, or waited for (`awaitingFrame`) for at most
 * POSTER_FRAME_WAIT_MS — `preload="metadata"` promises the metadata, not a
 * decoded frame. Whatever happens, the poster ends `settled` exactly once, and
 * settling is the moment its stream is released.
 */

/**
 * The still's largest size: twice the poster's box in chat (`.bb-file-video`
 * in chat/bbcode.css, 260×200), so it stays sharp on a high-density screen
 * without keeping a 4K frame's pixels around for a thumbnail.
 */
export const POSTER_STILL_MAX_WIDTH = 520;
export const POSTER_STILL_MAX_HEIGHT = 400;
/** A JPEG: a photographic frame at a fraction of a PNG's size. */
export const POSTER_STILL_TYPE = "image/jpeg";
export const POSTER_STILL_QUALITY = 0.85;
/**
 * How long a poster whose metadata is here waits for its first frame before
 * giving up on a still. Chromium decodes it straight after the metadata; a
 * browser that does not should not keep the stream, or the player, waiting.
 */
export const POSTER_FRAME_WAIT_MS = 5_000;

export type PosterPhase = "loading" | "awaitingFrame" | "settled";

export type PosterEvent =
  /** `loadedmetadata`; `hasFrame` when a frame is already decoded (readyState ≥ HAVE_CURRENT_DATA). */
  | { readonly kind: "metadata"; readonly hasFrame: boolean }
  /** `loadeddata`: the first frame is decoded. */
  | { readonly kind: "frame" }
  /** POSTER_FRAME_WAIT_MS passed after the metadata without a frame. */
  | { readonly kind: "frameTimeout" }
  /** `error`: the browser will not load this file. */
  | { readonly kind: "error" };

export type PosterAction =
  /** Nothing to do. */
  | "none"
  /** Start the POSTER_FRAME_WAIT_MS timer. */
  | "waitForFrame"
  /** Copy the frame into a still, release the stream; the poster is good. */
  | "capture"
  /** Release the stream and take the poster away, but let the player open. */
  | "drop"
  /** Release the stream and take the poster away: the file will not play here. */
  | "fail";

export interface PosterStep {
  readonly phase: PosterPhase;
  readonly action: PosterAction;
}

const settle = (action: PosterAction): PosterStep => ({ phase: "settled", action });

/** What the poster does on `event` in `phase`. */
export function posterStep(phase: PosterPhase, event: PosterEvent): PosterStep {
  if (phase === "settled") return { phase, action: "none" };
  switch (event.kind) {
    case "metadata":
      if (phase !== "loading") return { phase, action: "none" };
      return event.hasFrame
        ? settle("capture")
        : { phase: "awaitingFrame", action: "waitForFrame" };
    case "frame":
      return settle("capture");
    case "frameTimeout":
      return phase === "awaitingFrame" ? settle("drop") : { phase, action: "none" };
    case "error":
      return settle("fail");
  }
}

/**
 * The still's size for a frame of `width`×`height`: the frame's own, scaled
 * down (never up) to fit POSTER_STILL_MAX_WIDTH×POSTER_STILL_MAX_HEIGHT with
 * its shape kept. Null for a frame without a real size, which has nothing to
 * copy.
 */
export function posterStillSize(
  width: number,
  height: number,
): { width: number; height: number } | null {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) {
    return null;
  }
  const scale = Math.min(1, POSTER_STILL_MAX_WIDTH / width, POSTER_STILL_MAX_HEIGHT / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
