/**
 * Cover art URLs for the music panel.
 *
 * The bot hands back absolute URLs on a third-party CDN, usually over plain
 * http — which the CSP (`img-src 'self'`) and, on https, the mixed-content rule
 * both refuse. Every `<img>` points at the hub's proxy instead. Undefined
 * without a token or a cover, so the `♪` placeholder still shows.
 */
import type { MusicSong } from "@jinz/protocol";
import { assetToken, hasAssetToken } from "../ts/asset-token";

export function coverUrl(url: string | undefined | null): string | undefined {
  if (!url || !hasAssetToken.value) return undefined;
  return `/api/music-bot-cover/${encodeURIComponent(assetToken())}?url=${encodeURIComponent(url)}`;
}

/** The cover of a song, under whichever of the three names its provider used. */
export function songCover(song: MusicSong | null | undefined): string | undefined {
  if (!song) return undefined;
  const raw = (song.coverUrl ??
    (song as { cover?: string }).cover ??
    (song as { picUrl?: string }).picUrl) as string | undefined;
  return coverUrl(raw);
}

/** `m:ss`, for durations the bot reports in seconds. */
export function formatDuration(sec: number | undefined): string {
  if (!sec || !Number.isFinite(sec)) return "0:00";
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
