/**
 * Thin client for the hub's music-bot proxy (/api/music-bot/*).
 * Every call carries the hub session id so the hub can require a live TS connection.
 */
import type { MusicSong } from "@jinz/protocol";
import { useTsStore } from "../stores/ts";
import type { BotSession } from "./permissions";

export type { BotSession };

/**
 * The bot reports some failures with HTTP 200 and `{ ok: false, message }` —
 * a song it cannot resolve, for instance. Without this the UI would call that
 * a success and show a track that never plays.
 */
export function refusalMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as { ok?: unknown; message?: unknown; error?: unknown };
  if (b.ok !== false) return null;
  if (typeof b.message === "string" && b.message) return b.message;
  if (typeof b.error === "string" && b.error) return b.error;
  return "failed";
}

/**
 * The queue position to send when removing the row we show at `index`.
 *
 * The bot's DELETE route forwards to its `!remove <n>` chat command, which
 * subtracts one before splicing — so it counts from 1, while `play-at` counts
 * from 0 on the very same array. Sending our own index removes the song above
 * the one clicked, and index 0 removes nothing at all (the bot answers HTTP 200
 * with "Usage: !remove <number>", which no error path catches).
 */
export function queueRemoveIndex(index: number): number {
  return index + 1;
}

/**
 * What to send as the body. A POST always carries JSON, even when the action
 * needs no arguments: a body-less POST reaches the hub through a reverse proxy
 * as `transfer-encoding: chunked` with no content type, which Fastify refuses
 * with 415 Unsupported Media Type.
 */
export function requestBody(method: string, body: unknown): unknown {
  return body === undefined && method === "POST" ? {} : body;
}

export class MusicApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, rawBody?: unknown): Promise<T> {
  const ts = useTsStore();
  const body = requestBody(method, rawBody);
  const res = await fetch(`/api/music-bot${path}`, {
    method,
    headers: {
      "x-session-id": ts.sessionId,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg =
      (data as { error?: string; message?: string } | null)?.error ??
      (data as { message?: string } | null)?.message ??
      `HTTP ${res.status}`;
    throw new MusicApiError(res.status, msg);
  }
  const refusal = refusalMessage(data);
  if (refusal !== null) throw new MusicApiError(res.status, refusal);
  return data as T;
}

export interface SearchResult {
  songs?: MusicSong[];
  playlists?: unknown[];
  albums?: unknown[];
}

export const musicApi = {
  /** What the bot lets the hub's session do; used to hide controls it would refuse. */
  me: () => call<BotSession>("GET", "/session/me"),
  providers: () => call<{ enabled: string[]; default: string }>("GET", "/music/providers"),
  search: (q: string, platform?: string, limit = 30) =>
    call<SearchResult>(
      "GET",
      `/music/search?q=${encodeURIComponent(q)}&limit=${limit}${platform ? `&platform=${encodeURIComponent(platform)}` : ""}`,
    ),
  searchAll: (q: string, limit = 20) =>
    call<SearchResult>("GET", `/music/search/all?q=${encodeURIComponent(q)}&limit=${limit}`),
  /** Timed lines (or, from older builds, an LRC string); see `parseLyrics`. */
  lyrics: (id: string, platform: string) =>
    call<unknown>(
      "GET",
      `/music/lyrics/${encodeURIComponent(id)}?platform=${encodeURIComponent(platform)}`,
    ),
  queue: (botId: string) =>
    call<{ queue: MusicSong[]; status: unknown }>("GET", `/player/${botId}/queue`),
  elapsed: (botId: string) => call<{ elapsed: number }>("GET", `/player/${botId}/elapsed`),
  history: (botId: string, limit = 50) =>
    call<unknown>("GET", `/player/${botId}/history?limit=${limit}`),

  /* ----------------------------- browsing ------------------------------ */

  /** Editor's-pick playlists; every provider offers these without a login. */
  recommendPlaylists: (platform: string) =>
    call<unknown>("GET", `/music/recommend/playlists?platform=${encodeURIComponent(platform)}`),
  /** Daily recommendations. Needs a logged-in provider AND a non-guest bot session. */
  recommendSongs: (platform: string) =>
    call<unknown>("GET", `/music/recommend/songs?platform=${encodeURIComponent(platform)}`),
  /** The playlists of whatever account the bot signed in with on that platform. */
  userPlaylists: (platform: string) =>
    call<unknown>("GET", `/music/user/playlists?platform=${encodeURIComponent(platform)}`),
  /** Playlists the bot account starred in its own web UI. */
  favorites: () => call<unknown>("GET", "/favorites"),
  bilibiliPopular: (limit = 20) => call<unknown>("GET", `/music/bilibili/popular?limit=${limit}`),
  playlistSongs: (id: string, platform: string) =>
    call<unknown>(
      "GET",
      `/music/playlist/${encodeURIComponent(id)}?platform=${encodeURIComponent(platform)}`,
    ),
  playlistDetail: (id: string, platform: string) =>
    call<unknown>(
      "GET",
      `/music/playlist/${encodeURIComponent(id)}/detail?platform=${encodeURIComponent(platform)}`,
    ),
  albumSongs: (id: string, platform: string) =>
    call<unknown>(
      "GET",
      `/music/album/${encodeURIComponent(id)}?platform=${encodeURIComponent(platform)}`,
    ),

  /* --------------------------- browse actions -------------------------- */

  /**
   * Queue a song the bot must look up again. History rows carry no duration and
   * no url, so `add-song` would queue something unplayable; this makes the bot
   * fetch the provider's own object first.
   */
  addById: (botId: string, songId: string, platform: string) =>
    call<{ message: string }>("POST", `/player/${botId}/add-by-id`, { songId, platform }),
  /** Append a whole playlist to the queue, leaving what is playing alone. */
  queuePlaylist: (botId: string, playlistId: string, platform: string) =>
    call<{ message: string }>("POST", `/player/${botId}/playlist`, { playlistId, platform }),
  /**
   * Replace what is playing with this playlist. `radio: "recommend"` tells the
   * hub it is a recommendation, which then plays in order (the bot ignores it).
   */
  playPlaylist: (botId: string, playlistId: string, platform: string, recommend = false) =>
    call<{ message: string }>("POST", `/player/${botId}/play-playlist`, {
      playlistId,
      platform,
      ...(recommend ? { radio: "recommend" } : {}),
    }),
  playAlbum: (botId: string, albumId: string, platform: string) =>
    call<{ message: string }>("POST", `/player/${botId}/play-album`, { albumId, platform }),
  /** Start an endless personal-radio stream from that platform. */
  startFm: (botId: string, platform: string) =>
    call<{ ok?: boolean; message: string }>("POST", `/player/${botId}/fm`, { platform }),
  addSong: (botId: string, song: MusicSong) =>
    call<{ message: string }>("POST", `/player/${botId}/add-song`, { song: pick(song) }),
  /**
   * Play this song now, keeping the queue. The bot also has `play-song`, which
   * plays it by REPLACING the queue; that is a destructive action nobody asked
   * for when they press "play now", and the bot reserves it for privileged
   * roles, so it is deliberately not used here.
   */
  playSong: (botId: string, song: MusicSong) =>
    call<{ ok?: boolean; message: string }>("POST", `/player/${botId}/play-now-song`, {
      song: pick(song),
    }),
  playNext: (botId: string, song: MusicSong) =>
    call<{ ok?: boolean; message: string }>("POST", `/player/${botId}/play-next-song`, {
      song: pick(song),
    }),
  playByQuery: (botId: string, query: string, platform?: string) =>
    call<{ message: string }>("POST", `/player/${botId}/add`, { query, platform }),
  pause: (botId: string) => call<{ message: string }>("POST", `/player/${botId}/pause`),
  resume: (botId: string) => call<{ message: string }>("POST", `/player/${botId}/resume`),
  next: (botId: string) => call<{ message: string }>("POST", `/player/${botId}/next`),
  prev: (botId: string) => call<{ message: string }>("POST", `/player/${botId}/prev`),
  stop: (botId: string) => call<{ message: string }>("POST", `/player/${botId}/stop`),
  seek: (botId: string, position: number) =>
    call<{ message: string }>("POST", `/player/${botId}/seek`, { position }),
  volume: (botId: string, volume: number) =>
    call<{ message: string }>("POST", `/player/${botId}/volume`, { volume }),
  mode: (botId: string, mode: string) =>
    call<{ message: string }>("POST", `/player/${botId}/mode`, { mode }),
  playAt: (botId: string, index: number) =>
    call<{ message: string }>("POST", `/player/${botId}/play-at`, { index }),
  remove: (botId: string, index: number) =>
    call<{ message: string }>("DELETE", `/player/${botId}/queue/${queueRemoveIndex(index)}`),
  clear: (botId: string) => call<{ message: string }>("POST", `/player/${botId}/clear`),
};

/**
 * The bot needs the whole song object it gave us in search results, not just
 * its id: it resolves the stream from fields like `duration` and `vip`, and
 * without them it answers `{ ok: false }` with a region/copyright message and
 * queues a track it can never play. We echo back exactly what it sent us.
 */
function pick(song: MusicSong): MusicSong {
  return { ...song };
}
