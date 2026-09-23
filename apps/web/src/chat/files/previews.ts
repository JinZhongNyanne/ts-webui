/**
 * The pictures of chat file cards, fetched once and shared by everything that
 * shows them: the Preview button (card-actions.ts) and the stickers that load
 * by themselves (auto-preview-loader.ts).
 *
 * One key is one file (channel and path), so N cards of the same picture —
 * the same address repeated in a busy channel, a re-render, scrolling back —
 * cost the hub one transfer. The bytes come through the transfers store, so
 * they wait in the same line as every other transfer and the hub counts them
 * against the session's slots and rate like any other download.
 */
import { ftNameOf } from "@jinz/protocol";
import { watch } from "vue";
import { useTsStore } from "../../stores/ts";
import { useTransfersStore } from "../../stores/transfers";
import { PREVIEW_MAX_BYTES, type CardFile } from "./card";
import { createPreviewCache } from "./preview-cache";
import { imageMimeOf } from "./naming";

/** All previews held at once; one image is at most PREVIEW_MAX_BYTES. */
export const PREVIEW_CACHE_BYTES = 50 * 1024 * 1024;

const previews = createPreviewCache(PREVIEW_CACHE_BYTES);
/** Fetches under way, so two cards of one picture never become two downloads. */
const inFlight = new Map<string, Promise<string>>();
let watchingSession = false;

export const previewKey = (cid: string, path: string): string => `${cid}:${path}`;

/**
 * The same channel and path mean another file on another server (and a
 * replaced file after a reconnect), so nothing survives a new session.
 */
export function forgetPreviewsOnReconnect(): void {
  if (watchingSession) return;
  watchingSession = true;
  const ts = useTsStore();
  watch(
    () => `${ts.sessionId}:${ts.connState}`,
    () => previews.clear(),
  );
}

/** The picture's `blob:` URL when it is already here, without fetching anything. */
export function cachedPreview(file: CardFile): string | undefined {
  return previews.get(previewKey(file.cid, file.path));
}

/** The picture's `blob:` URL, fetched through the hub when it is not cached yet. */
export function fetchPreview(file: CardFile, cpw: string | undefined): Promise<string> {
  forgetPreviewsOnReconnect();
  const cached = cachedPreview(file);
  if (cached) return Promise.resolve(cached);
  const key = previewKey(file.cid, file.path);
  const running = inFlight.get(key);
  if (running) return running;
  const transfers = useTransfersStore();
  const fetching = transfers
    .fetchFile(file.cid, file.path, {
      ...(cpw === undefined ? {} : { cpw }),
      maxBytes: PREVIEW_MAX_BYTES,
    })
    .then((bytes) => keepPreview(file, bytes))
    // A failure is nobody's to keep: the next click (or card) may try again.
    .finally(() => inFlight.delete(key));
  inFlight.set(key, fetching);
  return fetching;
}

/**
 * Keeps `bytes` as this file's picture and answers its `blob:` URL. What the
 * sender just uploaded is already here, so seeding it means their own picture
 * shows without asking the server for what they sent (chat/files/uploader.ts).
 */
export function keepPreview(file: CardFile, bytes: Blob): string {
  forgetPreviewsOnReconnect();
  const type = imageMimeOf(ftNameOf(file.path)) ?? "application/octet-stream";
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  previews.put(previewKey(file.cid, file.path), url, bytes.size);
  return url;
}
