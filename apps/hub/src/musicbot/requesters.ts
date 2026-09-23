/**
 * Who asked for a song through this hub.
 *
 * The bot credits every song to the account that sent the request, and the hub
 * talks to it as one account for everybody (its service account, or "游客").
 * So the hub keeps its own book: which TeamSpeak nickname requested which song
 * on which bot, and puts that name back on the rows the bot reports as the
 * hub's own. Songs requested anywhere else (the bot's web UI, a TeamSpeak chat
 * command) keep the name the bot gave them.
 *
 * Songs carry no unique entry id, so a request is keyed by `platform:id` and
 * stamped with its time: the queue shows the latest request for a song, a
 * history row the latest one made before it was played.
 *
 * Pure module: the bridge holds the book, the state store writes it to disk.
 */
import type { MusicSong } from "@jinz/protocol";

/** What the bot calls a session without an account (its `GUEST_USERNAME`). */
export const BOT_GUEST_NAME = "游客";

/** Requests remembered per song; older ones only matter to old history rows. */
const RECORDS_PER_SONG = 5;
/** Songs remembered per bot before the least recently requested are forgotten. */
const SONGS_PER_BOT = 1000;
/**
 * How far a history row's play time may sit before the request it came from.
 * The bot stamps plays with its own clock, which need not agree with ours.
 */
const CLOCK_SLACK_MS = 5 * 60_000;
/** Longest nickname kept; TeamSpeak's own limit is 30 characters. */
const MAX_NAME_LENGTH = 64;
/** Bots remembered per bot URL; a real bot runs a handful. */
const BOTS_PER_URL = 16;
/**
 * Song ids and platforms come from the browser or a bot anyone may name, so
 * their length is capped before they become keys kept on disk.
 */
const MAX_ID_LENGTH = 128;
const MAX_PLATFORM_LENGTH = 32;
/**
 * How long a request still names a queued song. The bot's own guests share
 * the hub's guest name, so an old record must not claim a song a guest of the
 * bot's web UI queued today.
 */
export const QUEUE_RECORD_TTL_MS = 24 * 60 * 60_000;

export interface RequestRecord {
  name: string;
  /** ms since epoch, hub clock. */
  at: number;
}

/** The on-disk shape: botId → song key → records, oldest first. */
export type RequesterBookJson = Record<string, Record<string, RequestRecord[]>>;

type SongRef = Pick<MusicSong, "id" | "platform">;

export function songKey(song: SongRef): string {
  return `${song.platform}:${song.id}`;
}

function isSong(value: unknown): value is MusicSong {
  if (typeof value !== "object" || value === null) return false;
  const { id, platform } = value as Record<string, unknown>;
  return (
    ((typeof id === "string" && id !== "" && id.length <= MAX_ID_LENGTH) ||
      typeof id === "number") &&
    typeof platform === "string" &&
    platform !== "" &&
    platform.length <= MAX_PLATFORM_LENGTH
  );
}

/** The bot answers with numeric ids on some platforms; keys always use the string form. */
function refOf(song: MusicSong): SongRef {
  return { id: String(song.id), platform: song.platform };
}

/**
 * Songs in `after` that were not in `before`, counted as a multiset so a song
 * queued a second time still counts as new.
 */
export function addedSongs(before: readonly MusicSong[], after: readonly MusicSong[]): MusicSong[] {
  const seen = new Map<string, number>();
  for (const s of before) {
    if (!isSong(s)) continue;
    const k = songKey(refOf(s));
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const added: MusicSong[] = [];
  for (const s of after) {
    if (!isSong(s)) continue;
    const k = songKey(refOf(s));
    const left = seen.get(k) ?? 0;
    if (left > 0) seen.set(k, left - 1);
    else added.push(s);
  }
  return added;
}

/** `2026-09-19 12:00:00` (SQLite, UTC), ISO text or epoch ms; NaN when it is none of them. */
export function parsePlayedAt(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || !value) return Number.NaN;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  return Date.parse(iso);
}

export class RequesterBook {
  private readonly bots = new Map<string, Map<string, RequestRecord[]>>();

  static fromJson(json: unknown): RequesterBook {
    const book = new RequesterBook();
    if (typeof json !== "object" || json === null) return book;
    for (const [botId, songs] of Object.entries(json as Record<string, unknown>)) {
      if (typeof songs !== "object" || songs === null) continue;
      const map = new Map<string, RequestRecord[]>();
      for (const [key, records] of Object.entries(songs as Record<string, unknown>)) {
        if (!Array.isArray(records)) continue;
        const valid = records
          .filter(
            (r): r is RequestRecord =>
              typeof r?.name === "string" && r.name !== "" && Number.isFinite(r?.at),
          )
          .map((r) => ({ name: r.name.slice(0, MAX_NAME_LENGTH), at: r.at }))
          .sort((a, b) => a.at - b.at);
        if (valid.length) map.set(key, valid.slice(-RECORDS_PER_SONG));
      }
      if (map.size) book.bots.set(botId, map);
      if (book.bots.size >= BOTS_PER_URL) break;
    }
    return book;
  }

  toJson(): RequesterBookJson {
    // fromEntries defines keys, so a bot id of "__proto__" is kept as data.
    return Object.fromEntries(
      [...this.bots].map(([botId, songs]) => [botId, Object.fromEntries(songs)]),
    );
  }

  /** Credits `songs` on `botId` to `name`; false when there was nothing to note. */
  record(botId: string, songs: readonly MusicSong[], name: string, at = Date.now()): boolean {
    const who = name.trim().slice(0, MAX_NAME_LENGTH);
    const refs = songs.filter(isSong).map(refOf);
    if (!who || refs.length === 0) return false;
    if (!this.bots.has(botId) && this.bots.size >= BOTS_PER_URL) return false;
    const book = this.bots.get(botId) ?? new Map<string, RequestRecord[]>();
    for (const ref of refs) {
      const key = songKey(ref);
      const records = [...(book.get(key) ?? []), { name: who, at }].slice(-RECORDS_PER_SONG);
      // Re-inserting moves the key to the end, so the map stays in request order.
      book.delete(key);
      book.set(key, records);
    }
    while (book.size > SONGS_PER_BOT) book.delete(book.keys().next().value!);
    this.bots.set(botId, book);
    return true;
  }

  /** True when `song` was credited to someone at or after `since`. */
  creditedSince(botId: string, song: SongRef, since: number): boolean {
    const records = this.bots.get(botId)?.get(songKey(song));
    return (records?.at(-1)?.at ?? -Infinity) >= since;
  }

  /**
   * Who requested `song` through the hub: for a queued song the latest request
   * of the last day, for a play at `playedAt` the latest one made before it.
   * Null when the hub has no such record.
   */
  nameFor(botId: string, song: SongRef, playedAt?: number, now = Date.now()): string | null {
    const records = this.bots.get(botId)?.get(songKey(song));
    if (!records?.length) return null;
    if (playedAt === undefined || Number.isNaN(playedAt)) {
      const last = records.at(-1)!;
      return last.at >= now - QUEUE_RECORD_TTL_MS ? last.name : null;
    }
    for (let i = records.length - 1; i >= 0; i--) {
      if (records[i]!.at <= playedAt + CLOCK_SLACK_MS) return records[i]!.name;
    }
    return null;
  }
}

/**
 * The song with the hub's record in place of the bot's name, when the bot
 * credited it to the hub's own account. `identity` is that account's name.
 */
export function relabelSong<T>(
  song: T,
  book: RequesterBook,
  botId: string,
  identity: string,
  playedAt?: number,
): T {
  if (!isSong(song)) return song;
  const by = typeof song.requestedBy === "string" ? song.requestedBy.trim() : "";
  if (by && by !== identity) return song;
  const name = book.nameFor(botId, refOf(song), playedAt);
  return name ? { ...song, requestedBy: name } : song;
}

function relabelList(
  list: unknown,
  book: RequesterBook,
  botId: string,
  identity: string,
  withPlayTime: boolean,
): unknown {
  if (!Array.isArray(list)) return list;
  return list.map((s: unknown) =>
    relabelSong(
      s,
      book,
      botId,
      identity,
      withPlayTime ? parsePlayedAt((s as { playedAt?: unknown } | null)?.playedAt) : undefined,
    ),
  );
}

const QUEUE_PATH = /^\/player\/([^/]+)\/queue$/;
const HISTORY_PATH = /^\/player\/([^/]+)\/history$/;

/**
 * A proxied GET answer with the hub's requesters filled in: the queue (and the
 * status riding along with it) and the play history. Anything else, and any
 * body not shaped the way the bot answers, is returned as it came.
 */
export function relabelResponse(
  path: string,
  body: unknown,
  book: RequesterBook,
  identity: string,
): unknown {
  if (typeof body !== "object" || body === null) return body;
  const b = body as Record<string, unknown>;
  const queue = QUEUE_PATH.exec(path);
  if (queue) {
    const botId = queue[1]!;
    const status = b["status"] as Record<string, unknown> | null | undefined;
    return {
      ...b,
      queue: relabelList(b["queue"], book, botId, identity, false),
      ...(status && typeof status === "object"
        ? {
            status: {
              ...status,
              currentSong: relabelSong(status["currentSong"], book, botId, identity),
            },
          }
        : {}),
    };
  }
  const history = HISTORY_PATH.exec(path);
  if (history) {
    return { ...b, history: relabelList(b["history"], book, history[1]!, identity, true) };
  }
  return body;
}
