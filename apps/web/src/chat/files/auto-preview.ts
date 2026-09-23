/**
 * Whether a file card in chat shows its picture by itself ("stickers"), and
 * how often this page may do that.
 *
 * Only files shared through the hub (`ts3file://` cards) are ever loaded
 * without a click: an external `[IMG]` link is fetched from a third party and
 * would tell that host the viewer's address, so those keep click-to-load
 * (chat/richClick.ts). Here the bytes come through the hub from the same
 * TeamSpeak server the page is on, so nothing new learns who is looking.
 *
 * Only pictures, too. A video shared in chat is fetched whole before any of it
 * can be seen (chat/files/videos.ts), which is megabytes and a transfer slot
 * for something nobody asked for, so a video card always waits for its Play
 * button — the type check at the bottom of this file is what says so.
 *
 * The size limit keeps it to what a sticker is. A bigger picture is still a
 * picture, but loading it by itself would spend a transfer slot and a lot of
 * memory on something nobody asked to see, so it keeps its Preview button.
 *
 * The rate is what a busy channel needs: every auto-load is a transfer init,
 * which costs the session one of HUB_FT_RATE_PER_MIN (30) and the whole hub
 * one token of the shared TeamSpeak command budget (gateway/server-guard.ts,
 * about 60 a minute per server). Twenty pictures dropped into a channel would
 * otherwise have every viewer fire twenty inits at once, and a handful of
 * viewers would drain the budget for everyone's dialogs and admin tools. The
 * cap below leaves well over half of a session's inits for what the user
 * actually clicks, and past it a card simply falls back to click-to-load.
 */
import { imageMimeOf } from "./naming";

/** Pictures up to this load by themselves; bigger ones keep their button. */
export const AUTO_PREVIEW_MAX_BYTES = 256 * 1024;
/** Auto-loads this page may start per AUTO_PREVIEW_WINDOW_MS. */
export const AUTO_PREVIEW_MAX_PER_MIN = 12;
export const AUTO_PREVIEW_WINDOW_MS = 60_000;

export interface AutoPreviewCheck {
  /** The "show small images automatically" setting. */
  enabled: boolean;
  /** The file's name, which says what kind of picture it is. */
  name: string;
  /** Bytes, as the link said; undefined when it did not (so: not small enough to know). */
  size: number | undefined;
  /** An auto-load for this card already failed, and is not tried again. */
  failed?: boolean;
}

/** Whether this card's picture may be fetched without anyone clicking. */
export function autoPreviewable(c: AutoPreviewCheck): boolean {
  if (!c.enabled || c.failed) return false;
  if (c.size === undefined || c.size > AUTO_PREVIEW_MAX_BYTES) return false;
  return imageMimeOf(c.name) !== null;
}

export interface AutoPreviewRate {
  /** Whether an auto-load may start now; a true one spends a turn. */
  take(now: number): boolean;
  /** Turns spent inside the window, for tests. */
  readonly size: number;
}

/** A sliding window: at most `limit` auto-loads in any `windowMs`. */
export function createAutoPreviewRate(
  limit: number = AUTO_PREVIEW_MAX_PER_MIN,
  windowMs: number = AUTO_PREVIEW_WINDOW_MS,
): AutoPreviewRate {
  // Oldest first, so dropping what fell out of the window is a shift.
  let spent: readonly number[] = [];
  return {
    take(now) {
      const live = spent.filter((at) => now - at < windowMs);
      if (live.length >= limit) {
        spent = live;
        return false;
      }
      spent = [...live, now];
      return true;
    },
    get size() {
      return spent.length;
    },
  };
}
