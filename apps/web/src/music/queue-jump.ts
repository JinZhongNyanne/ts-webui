/**
 * Jumping to a row of the bot's queue.
 *
 * The bot has `play-at` for exactly this, but guards it with a capability and
 * no guest flag, so the hub's guest session can never use it. A guest may play
 * a song now and remove rows, though, which together do the same thing: play a
 * copy of the row, then drop the original. That needs to know which row is
 * playing — the bot reports the song, not its index — so the index is found by
 * matching the song (and, for a song queued twice, its resolved stream url);
 * an ambiguous match plays the copy without removing anything rather than risk
 * removing the wrong row.
 *
 * Pure module: no Vue, no fetch.
 */
import type { MusicSong } from "@jinz/protocol";

/** Which of the bot routes involved this session may use. */
export interface JumpRights {
  readonly playAt: boolean;
  readonly skip: boolean;
  readonly playNow: boolean;
  readonly removeClear: boolean;
}

export type QueueJumpPlan =
  | { readonly kind: "none" }
  | { readonly kind: "playAt"; readonly index: number }
  | { readonly kind: "next" }
  /** Play `song` now, then remove the row at `removeAt` (0-based), if any. */
  | { readonly kind: "playNow"; readonly song: MusicSong; readonly removeAt: number | null };

const sameSong = (a: MusicSong, b: MusicSong): boolean =>
  a.id === b.id && a.platform === b.platform;

/** The queue row that is playing, or null when it cannot be told for sure. */
export function currentQueueIndex(
  queue: readonly MusicSong[],
  current: MusicSong | null | undefined,
): number | null {
  if (!current) return null;
  const rows = queue.flatMap((s, i) => (sameSong(s, current) ? [i] : []));
  // A song queued twice: the bot resolves a fresh stream url each time a row
  // plays, and `currentSong` is that very row, so its url tells them apart.
  const url = typeof current["url"] === "string" ? current["url"] : null;
  const exact = rows.length > 1 && url ? rows.filter((i) => queue[i]?.["url"] === url) : rows;
  return exact.length === 1 ? (exact[0] ?? null) : null;
}

/** How to start the row at `index`, or null when this session cannot. */
export function planQueueJump(
  queue: readonly MusicSong[],
  current: MusicSong | null | undefined,
  index: number,
  rights: JumpRights,
): QueueJumpPlan | null {
  const target = queue[index];
  if (!target || index < 0) return null;
  if (rights.playAt) return { kind: "playAt", index };

  const playing = currentQueueIndex(queue, current);
  if (playing === index) return { kind: "none" };
  if (playing !== null && index === playing + 1 && rights.skip) return { kind: "next" };
  if (!rights.playNow) return null;

  // play-now-song inserts its copy right after the playing row, which pushes
  // every later row one place down.
  const removeAt =
    playing === null || !rights.removeClear ? null : index > playing ? index + 1 : index;
  return { kind: "playNow", song: target, removeAt };
}
