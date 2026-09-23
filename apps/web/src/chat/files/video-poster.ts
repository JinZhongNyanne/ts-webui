/**
 * A file card's video poster: the clip's first frame with a play badge over the
 * middle of it, put under the card once the bytes are here (card-actions.ts).
 *
 * ## A still, not a second player
 *
 * The first frame is read by a `<video preload="metadata">` on the clip's own
 * address — a `blob:` URL of bytes this page holds, or a media link the hub
 * streams from (videos.ts). But a media link runs one stream at a time, and
 * the player that opens next plays the very same link, so a poster that went
 * on holding its request would be cut by the player's first range and could
 * cut the player back (video-poster-plan.ts has the whole story). So once the
 * first frame is decoded it is copied into a still, set as the element's
 * `poster`, and the source is removed: the element blanks its video and shows
 * the still, and no request of the poster's is left open. The promise below
 * settles only after that, so the player the card opens next never has a
 * poster to race.
 *
 * The still is a `data:` URL, not an object URL, on purpose. A poster has no
 * moment at which it is torn down — the chat log is `v-html`, and a message
 * re-rendered or scrolled out of the log simply drops its elements — so an
 * object URL made for it could never be revoked and would leak its pixels for
 * the life of the page. A `data:` URL is only a string on the element and goes
 * with it; the canvas it was drawn on is emptied at once. It is small (at most
 * POSTER_STILL_MAX_WIDTH×POSTER_STILL_MAX_HEIGHT, as a JPEG), and the hub's
 * `img-src` allows `data:`.
 *
 * The address itself is kept on the element as POSTER_URL_ATTR, for a click on
 * the poster to open the player on (chat/richClick.ts).
 *
 * ## It cannot make a sound and cannot start itself
 *
 * `muted`, no `autoplay`, no `controls`, `playsinline`: the poster is a still
 * picture as far as the user is concerned, and there is no state it can get
 * into where it emits audio or starts moving. Sound and motion belong to the
 * player the poster opens (`components/viewer/VideoViewer.vue`).
 *
 * ## The card keeps everything it had
 *
 * Unlike a picture, which replaces its card entirely (`sticker.ts`), a video
 * poster is added *below* a card that stays exactly as it was: the name, the
 * size, Download and Play are all still there. That is deliberate — the Play
 * button is the keyboard's and a screen reader's way into the player, whereas
 * the poster is a mouse-and-finger shortcut to the same thing, and the card's
 * parts are what the e2e suite selects on.
 */
import {
  POSTER_FRAME_WAIT_MS,
  POSTER_STILL_QUALITY,
  POSTER_STILL_TYPE,
  posterStep,
  posterStillSize,
  type PosterEvent,
  type PosterPhase,
} from "./video-poster-plan";

/** Where the poster keeps its address, once `src` has let go of it. */
export const POSTER_URL_ATTR = "data-video-url";

/**
 * Copies `video`'s current frame into its `poster` as a still. False when there
 * is no frame to copy or the browser would not hand the pixels over.
 */
function keepStill(video: HTMLVideoElement): boolean {
  const size = posterStillSize(video.videoWidth, video.videoHeight);
  if (!size) return false;
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  try {
    const context = canvas.getContext("2d");
    if (!context) return false;
    context.drawImage(video, 0, 0, size.width, size.height);
    video.poster = canvas.toDataURL(POSTER_STILL_TYPE, POSTER_STILL_QUALITY);
    return true;
  } catch (err) {
    // A frame from another origin taints the canvas. Our addresses never are
    // one, but a poster without a still is still no reason to break the card.
    console.warn("video poster: the first frame could not be kept", err);
    return false;
  } finally {
    // The pixels now live in the still; the canvas's own copy goes at once.
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * Lets go of the poster's source, which ends any request it still has open on
 * the address. The element keeps showing its `poster`, if it has one.
 */
function releaseSource(video: HTMLVideoElement): void {
  video.onloadedmetadata = null;
  video.onloadeddata = null;
  video.onerror = null;
  video.removeAttribute("src");
  video.load();
}

/**
 * Shows `url` as `card`'s video poster. Resolves true once the poster has
 * settled with its source released — with its first frame on screen, or
 * without a poster when no frame came in time — and false when the browser
 * turned out not to play this file after all (the card is left as it was, with
 * its Download button).
 */
export function showVideoPoster(card: HTMLElement, name: string, url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const existing = card.querySelector(".bb-file-preview");
    if (existing) {
      // Already posted. A click on the poster reopens the player on its
      // address, so it takes the newest one: a media link expires, and the
      // one it was posted with may since have been replaced. Only the address
      // is updated — loading it would take the link's one stream away from
      // the player about to open on it.
      existing.querySelector("video")?.setAttribute(POSTER_URL_ATTR, url);
      resolve(true);
      return;
    }
    const box = document.createElement("span");
    box.className = "bb-file-preview bb-video-box";
    const video = document.createElement("video");
    video.className = "bb-video bb-file-video";
    // The name is worth having on hover, but not a line of its own under the
    // card's own name.
    video.title = name;
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.controls = false;
    video.setAttribute(POSTER_URL_ATTR, url);
    const badge = document.createElement("span");
    badge.className = "bb-video-play";
    badge.setAttribute("aria-hidden", "true");
    badge.textContent = "▶";

    let phase: PosterPhase = "loading";
    let frameTimer: number | null = null;
    const on = (event: PosterEvent): void => {
      const step = posterStep(phase, event);
      phase = step.phase;
      if (step.action === "none") return;
      if (step.action === "waitForFrame") {
        frameTimer = window.setTimeout(() => on({ kind: "frameTimeout" }), POSTER_FRAME_WAIT_MS);
        return;
      }
      if (frameTimer !== null) window.clearTimeout(frameTimer);
      const kept = step.action === "capture" && keepStill(video);
      releaseSource(video);
      // An empty box would only be something to click that opens nothing.
      if (!kept) box.remove();
      resolve(step.action !== "fail");
    };
    video.onloadedmetadata = () =>
      on({ kind: "metadata", hasFrame: video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA });
    video.onloadeddata = () => on({ kind: "frame" });
    video.onerror = () => on({ kind: "error" });
    video.src = url;
    box.append(video, badge);
    card.append(box);
  });
}
