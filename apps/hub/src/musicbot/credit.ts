/**
 * Which songs a proxied player call queued, so the hub can credit them to the
 * TeamSpeak user who made it (see requesters.ts).
 *
 * A call naming one song is credited from its body. A call whose songs the
 * browser never saw — a text query, a playlist, an album, personal FM — is
 * credited by comparing the queue before and after it.
 *
 * Pure module.
 */
import type { MusicSong } from "@jinz/protocol";

export type Credit =
  { botId: string; kind: "songs"; songs: MusicSong[] } | { botId: string; kind: "diff" };

/** Calls whose body carries the whole song object. */
const SONG_BODY = new Set(["add-song", "play-song", "play-now-song", "play-next-song"]);
/** Calls that queue songs the hub only learns about from the queue itself. */
const QUEUE_DIFF = new Set(["add", "play", "playlist", "play-playlist", "play-album", "fm"]);

const PLAYER_ACTION = /^\/player\/([^/]+)\/([a-z-]+)$/;

function field(body: unknown, key: string): unknown {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>)[key] : null;
}

function asSong(value: unknown): MusicSong | null {
  const id = field(value, "id");
  const platform = field(value, "platform");
  if ((typeof id !== "string" && typeof id !== "number") || typeof platform !== "string") {
    return null;
  }
  return { ...(value as MusicSong), id: String(id) };
}

/** How to credit this call, or null when it queues nothing. `path` is the readable sub-path. */
export function creditFor(method: string, path: string, body: unknown): Credit | null {
  if (method !== "POST") return null;
  const m = PLAYER_ACTION.exec(path);
  if (!m) return null;
  const botId = m[1]!;
  const action = m[2]!;
  if (SONG_BODY.has(action)) {
    const song = asSong(field(body, "song"));
    return song ? { botId, kind: "songs", songs: [song] } : null;
  }
  if (action === "add-by-id") {
    const song = asSong({ id: field(body, "songId"), platform: field(body, "platform") });
    // Without a platform the bot picks its default one, which only the queue tells.
    return song ? { botId, kind: "songs", songs: [song] } : { botId, kind: "diff" };
  }
  return QUEUE_DIFF.has(action) ? { botId, kind: "diff" } : null;
}
