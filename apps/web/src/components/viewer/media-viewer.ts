/**
 * The media viewer's slot: one thing is on screen at a time, opened from
 * anywhere (today a click in chat, `chat/richClick.ts`) and rendered by
 * `MediaViewerHost.vue`, which App.vue mounts beside the other dialog hosts. A
 * slot rather than a component prop, for the same reason as
 * `icons/icon-dialogs.ts`: the chat log is `v-html`, so the click that opens
 * the viewer reaches it through a module, not through a Vue listener.
 *
 * ## One slot, two kinds, one layer
 *
 * A picture and a video want completely different chrome — zoom, pan and
 * pinching on one side, a transport bar on the other — so they are two
 * components. What they must *not* be is two overlays: two modules each
 * teleporting their own backdrop to `<body>` would mean two z-indexes to keep
 * in step, two entries pushed onto the app's modal stack, and the genuine
 * possibility of a video playing behind a picture with Escape closing whichever
 * of them registered its key handler last. So there is one slot holding a
 * discriminated union, one host, one place in the z-index scale (80), and
 * opening either kind replaces whatever was open.
 *
 * ## The address is borrowed, never owned
 *
 * The viewer is handed an address the page already has: a `blob:` URL from
 * `chat/files/preview-cache.ts` (pictures) or `chat/files/videos.ts` (videos),
 * the hub's own media link for a streamed video (also videos.ts), or an
 * external `https:` one the user has already allowed for that host. So it
 * never fetches anything the message did not ask for, and it never revokes
 * anything: the caches own their object URLs and are the only things allowed to
 * revoke them (the same picture may well be on screen in three messages at
 * once). Should a cache evict the URL while the viewer is open, the element
 * simply fails to load and says so — far better than the viewer freeing a URL
 * other cards still use.
 */
import { shallowRef } from "vue";

/** Where a thing is and what to call it; an empty name shows no title. */
export interface ViewedMediaSource {
  /** The address the page already holds — `blob:`, a hub media link, or `https:`. */
  readonly url: string;
  /** What to call it; empty when it has no name (a bare `[img]`). */
  readonly name: string;
}

export type ViewedMedia = ViewedMediaSource & { readonly kind: "picture" | "video" };

export const viewedMedia = shallowRef<ViewedMedia | null>(null);

/** Shows `source`, replacing whatever was open. An empty address opens nothing. */
function open(kind: ViewedMedia["kind"], source: ViewedMediaSource): void {
  if (!source.url) return;
  viewedMedia.value = { kind, url: source.url, name: source.name };
}

export function openPictureViewer(picture: ViewedMediaSource): void {
  open("picture", picture);
}

export function openVideoViewer(video: ViewedMediaSource): void {
  open("video", video);
}

export function closeMediaViewer(): void {
  viewedMedia.value = null;
}
