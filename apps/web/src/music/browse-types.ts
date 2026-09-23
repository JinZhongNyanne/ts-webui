/**
 * Shapes the discover / library / history tabs read back from the bot, with a
 * parser for each.
 *
 * Everything here crosses a trust boundary: the payloads come from whatever
 * music provider the bot happened to ask (NetEase, QQ, Bilibili, Jellyfin, …),
 * and those differ in which fields they fill in. Each parser keeps only rows it
 * can actually render and answers with an empty list rather than throwing, so
 * one odd provider cannot blank a whole tab.
 *
 * Pure module: no Vue, no fetch, so it can be unit-tested on its own.
 */
import type { MusicSong } from "@jinz/protocol";

/** A playlist or album card. */
export interface MusicPlaylist {
  id: string;
  name: string;
  coverUrl: string;
  songCount: number;
  platform: string;
}

/** The header above a playlist's songs, when the provider offers one. */
export interface MusicPlaylistDetail {
  id: string;
  name: string;
  description: string;
  coverUrl: string;
  songCount: number;
}

/**
 * A play-history row: a song, plus when it played and who asked for it.
 * The bot writes `playedAt` as its SQLite timestamp string ("2026-09-17
 * 08:40:54"), not as an epoch number.
 */
export interface MusicHistoryEntry extends MusicSong {
  playedAt?: string | number;
}

function str(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function rows(payload: unknown, key: string): Record<string, unknown>[] {
  if (typeof payload !== "object" || payload === null) return [];
  const list = (payload as Record<string, unknown>)[key];
  if (!Array.isArray(list)) return [];
  return list.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
}

/** Playlist cards from `/music/recommend/playlists` or `/music/user/playlists`. */
export function parsePlaylists(payload: unknown, defaultPlatform: string): MusicPlaylist[] {
  return rows(payload, "playlists").flatMap((r) => {
    const id = str(r.id);
    const name = str(r.name);
    if (!id || !name) return [];
    return [
      {
        id,
        name,
        coverUrl: str(r.coverUrl),
        songCount: num(r.songCount),
        platform: str(r.platform, defaultPlatform),
      },
    ];
  });
}

/** Songs from any `{ songs: [...] }` answer. The bot's own object is kept whole:
 *  it resolves a stream from fields we do not model, so dropping them would make
 *  the song unplayable (see `pick()` in api.ts). */
export function parseSongs(payload: unknown, defaultPlatform: string): MusicSong[] {
  return rows(payload, "songs").flatMap((r) => {
    const id = str(r.id);
    const name = str(r.name);
    if (!id || !name) return [];
    return [{ ...r, id, name, platform: str(r.platform, defaultPlatform) } as MusicSong];
  });
}

/** Rows from `/player/:botId/history`. */
export function parseHistory(payload: unknown): MusicHistoryEntry[] {
  return rows(payload, "history").flatMap((r) => {
    const id = str(r.id);
    const name = str(r.name);
    if (!id || !name) return [];
    return [{ ...r, id, name, platform: str(r.platform) } as MusicHistoryEntry];
  });
}

/**
 * Can the bot resolve a stream from this object, or must it look the song up
 * again by id?
 *
 * History rows are stored records, not provider results: they carry
 * `duration: 0` and no url. Handing one back to `add-song` queues a track the
 * bot can never play, so those go through `add-by-id` instead.
 */
export function isPlayableSong(song: MusicSong): boolean {
  return num(song.duration) > 0;
}

/** Starred playlists from `/favorites`; the bot names the playlist `playlistId`. */
export function parseFavorites(payload: unknown): MusicPlaylist[] {
  return rows(payload, "favorites").flatMap((r) => {
    const id = str(r.playlistId);
    const name = str(r.name);
    const platform = str(r.platform);
    if (!id || !name || !platform) return [];
    return [{ id, name, coverUrl: str(r.coverUrl), songCount: num(r.songCount), platform }];
  });
}

/**
 * The playlists of one platform.
 *
 * `/favorites` is the one library list the bot serves for every platform at
 * once — each row names its own — so 我的收藏 honours its source tab by
 * filtering what is already in hand instead of asking again. `null` means no
 * tab has settled yet, which shows the whole list rather than nothing.
 */
export function playlistsFrom(
  playlists: readonly MusicPlaylist[],
  platform: string | null,
): MusicPlaylist[] {
  if (platform === null) return [...playlists];
  return playlists.filter((p) => p.platform === platform);
}

/** The header from `/music/playlist/:id/detail`, or null when unsupported. */
export function parsePlaylistDetail(payload: unknown): MusicPlaylistDetail | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = (payload as Record<string, unknown>).playlist;
  if (typeof p !== "object" || p === null) return null;
  const r = p as Record<string, unknown>;
  const name = str(r.name);
  if (!name) return null;
  return {
    id: str(r.id),
    name,
    description: str(r.description),
    coverUrl: str(r.coverUrl),
    songCount: num(r.songCount),
  };
}
