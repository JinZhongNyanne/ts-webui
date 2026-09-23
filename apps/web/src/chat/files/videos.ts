/**
 * Where a video shared in chat plays from: a media link the hub streams, or,
 * from a hub without them, the bytes fetched whole and kept as a `blob:` URL.
 * Either is what the card's Play button gets and what the poster and the
 * player overlay then play.
 *
 * ## Streaming, when the hub offers it
 *
 * A `<video>` that streams seeks with HTTP range requests, and a download link
 * cannot answer one: it is single-use, lives for seconds, ignores `Range` and
 * is served as an attachment (hub `files/routes.ts`, `files/tickets.ts`). So
 * the hub has a second kind of link for exactly this (`files/media-routes.ts`):
 * many uses for ten minutes, one file of one session, video and audio only,
 * `Range: bytes=a-` answered 206 by starting the TeamSpeak transfer at `a`
 * (`ftinitdownload seekpos=a`). Every seek is a transfer init that spends a
 * share of the hub-wide TeamSpeak command budget, so the hub gives each
 * session its own small budget of them and one transfer slot per open player.
 *
 * The page asks for such a link when `hello` says the hub serves them
 * (`FtLimits.mediaStreaming`) and keeps it per file, so the poster and the
 * player share one link — the hub lets a link run one stream at a time, which
 * is all one player needs — until it is within a minute of expiring. Nothing
 * is fetched up front and no size cap applies: the player reads what it plays.
 *
 * ## The whole file, when it does not
 *
 * An older hub only has download links, so the clip is fetched whole, once,
 * capped at `VIDEO_MAX_BYTES`, through the same transfers store as everything
 * else (it waits in the same line, and the hub counts it like any other
 * download). The cap is checked against the *server's* size before a single
 * byte moves — the transfers store compares the ticket's size to `maxBytes` —
 * so a card that understates its size cannot trick anyone into waiting on half
 * a gigabyte, and the card says so instead.
 *
 * ## Its own cache, away from the pictures
 *
 * The same `preview-cache.ts` as the pictures, but a second instance of it: one
 * video is worth over a hundred stickers, and putting it in the shared budget
 * would have watching a clip revoke the object URLs of every picture currently
 * on screen — which does not just evict them, it breaks the `<img>` tags that
 * are still showing them. This cache holds a couple of videos and nothing else
 * competes for it.
 */
import { ftNameOf, type FtMediaTicket } from "@jinz/protocol";
import { watch } from "vue";
import { useTsStore } from "../../stores/ts";
import { useTransfersStore } from "../../stores/transfers";
import { VIDEO_MAX_BYTES, type CardFile } from "./card";
import { createPreviewCache } from "./preview-cache";
import { previewKey } from "./previews";
import { videoMimeOf } from "./naming";
import { planVideo } from "./video-source";

/** Room for two videos at the cap, so going back to the previous clip is free. */
export const VIDEO_CACHE_BYTES = 2 * VIDEO_MAX_BYTES;

const videos = createPreviewCache(VIDEO_CACHE_BYTES);
/** The last media link the hub gave for each clip (see video-source.ts for how long it serves). */
const links = new Map<string, FtMediaTicket>();
/** Fetches under way, so two clicks on one video never become two downloads. */
const inFlight = new Map<string, Promise<string>>();
let watchingSession = false;

/**
 * The same channel and path mean another file on another server (and a
 * replaced file after a reconnect), so nothing survives a new session. Its own
 * watcher, because this cache is its own (previews.ts keeps the pictures').
 */
function forgetVideosOnReconnect(): void {
  if (watchingSession) return;
  watchingSession = true;
  const ts = useTsStore();
  watch(
    () => `${ts.sessionId}:${ts.connState}`,
    () => {
      videos.clear();
      // A link belongs to the session and connection it was minted on.
      links.clear();
    },
  );
}

/** The video's `blob:` URL when it is already here, without fetching anything. */
export function cachedVideo(file: CardFile): string | undefined {
  return videos.get(previewKey(file.cid, file.path));
}

/**
 * The media link the page last got for the clip, if it still has one — what
 * a click on its poster checks before reusing it (video-source.ts).
 */
export function keptVideoLink(file: CardFile): FtMediaTicket | undefined {
  return links.get(previewKey(file.cid, file.path));
}

/**
 * The address to play the video from: its `blob:` URL when the bytes are here,
 * else a media link to stream it from, else (an older hub) the whole file,
 * fetched now. Rejects with a translated message.
 */
export function fetchVideo(file: CardFile, cpw: string | undefined): Promise<string> {
  forgetVideosOnReconnect();
  const key = previewKey(file.cid, file.path);
  const transfers = useTransfersStore();
  const plan = planVideo({
    streaming: transfers.mediaStreaming,
    blobUrl: cachedVideo(file),
    link: links.get(key),
    now: Date.now(),
  });
  if (plan.kind === "blob" || plan.kind === "link") return Promise.resolve(plan.url);
  const running = inFlight.get(key);
  if (running) return running;
  const getting = (plan.kind === "stream" ? streamVideo(file, cpw) : fetchWhole(file, cpw))
    // A failure is nobody's to keep: the next click may try again.
    .finally(() => inFlight.delete(key));
  inFlight.set(key, getting);
  return getting;
}

/** A new media link for the clip, kept for the next click; the whole file if the hub has none. */
async function streamVideo(file: CardFile, cpw: string | undefined): Promise<string> {
  const link = await useTransfersStore().mediaLink(file.cid, file.path, cpw);
  if (!link) return fetchWhole(file, cpw);
  links.set(previewKey(file.cid, file.path), link);
  return link.url;
}

/** The clip's bytes, fetched whole (up to VIDEO_MAX_BYTES) and kept as a `blob:` URL. */
async function fetchWhole(file: CardFile, cpw: string | undefined): Promise<string> {
  const bytes = await useTransfersStore().fetchFile(file.cid, file.path, {
    ...(cpw === undefined ? {} : { cpw }),
    maxBytes: VIDEO_MAX_BYTES,
  });
  return keepVideo(file, bytes);
}

/**
 * Keeps `bytes` as this file's video and answers its `blob:` URL. The type has
 * to be the right one: a blob labelled `application/octet-stream` is a file a
 * `<video>` refuses to play, however good the bytes inside it are.
 */
export function keepVideo(file: CardFile, bytes: Blob): string {
  forgetVideosOnReconnect();
  const type = videoMimeOf(ftNameOf(file.path));
  if (!type) throw new Error("not a video this browser plays");
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  videos.put(previewKey(file.cid, file.path), url, bytes.size);
  return url;
}
