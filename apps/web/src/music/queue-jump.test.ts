import { describe, expect, it } from "vitest";
import type { MusicSong } from "@jinz/protocol";
import { currentQueueIndex, planQueueJump, type JumpRights } from "./queue-jump";

const song = (id: string, platform = "qq"): MusicSong =>
  ({ id, name: id, artist: "a", platform }) as MusicSong;

const A = song("a");
const B = song("b");
const C = song("c");
const D = song("d");

const guest: JumpRights = { playAt: false, skip: true, playNow: true, removeClear: true };
const member: JumpRights = { playAt: true, skip: true, playNow: true, removeClear: true };

describe("currentQueueIndex", () => {
  it("finds the playing song by id and platform", () => {
    expect(currentQueueIndex([A, B, C], B)).toBe(1);
  });

  it("does not confuse the same id on another platform", () => {
    expect(currentQueueIndex([song("b", "netease"), B], B)).toBe(1);
  });

  /**
   * The bot resolves a fresh stream url (with its own key) every time a row
   * plays, and reports the very same object as `currentSong`; seen live, a
   * song queued twice had two different urls and only one matched.
   */
  it("tells duplicates apart by the stream url the bot resolved", () => {
    const played = { ...A, url: "http://x/a.mp3?vkey=1" };
    const playing = { ...A, url: "http://x/a.mp3?vkey=2" };
    expect(currentQueueIndex([played, B, playing, C], playing)).toBe(2);
  });

  it("is null when nothing plays, the song is gone, or it cannot be told apart", () => {
    expect(currentQueueIndex([A, B], null)).toBeNull();
    expect(currentQueueIndex([A, B], C)).toBeNull();
    expect(currentQueueIndex([A, B, A], A)).toBeNull();
    const url = { ...A, url: "http://x/a.mp3" };
    expect(currentQueueIndex([url, B, url], url)).toBeNull();
  });
});

describe("planQueueJump", () => {
  it("uses play-at when the bot allows it", () => {
    expect(planQueueJump([A, B, C], A, 2, member)).toEqual({ kind: "playAt", index: 2 });
  });

  it("does nothing for the row that is already playing", () => {
    expect(planQueueJump([A, B, C], B, 1, guest)).toEqual({ kind: "none" });
  });

  it("skips once when a guest picks the very next row", () => {
    expect(planQueueJump([A, B, C], A, 1, guest)).toEqual({ kind: "next" });
  });

  /**
   * play-now-song inserts a copy right after the current row and plays it, so
   * a row further down has moved one place: [A*, C', B, C] → remove index 3.
   */
  it("plays a later row now and removes the original, one place further down", () => {
    expect(planQueueJump([A, B, C], A, 2, guest)).toEqual({
      kind: "playNow",
      song: C,
      removeAt: 3,
    });
  });

  /** [A, B, C*, D] + play-now(A) → [A, B, C, A', D]: the original stays at 0. */
  it("plays an earlier row now and removes the original where it was", () => {
    expect(planQueueJump([A, B, C, D], C, 0, guest)).toEqual({
      kind: "playNow",
      song: A,
      removeAt: 0,
    });
  });

  it("keeps the original when the playing row cannot be told apart", () => {
    expect(planQueueJump([A, B, A], A, 1, guest)).toEqual({
      kind: "playNow",
      song: B,
      removeAt: null,
    });
  });

  it("keeps the original when removing is not allowed", () => {
    expect(planQueueJump([A, B, C], A, 2, { ...guest, removeClear: false })).toEqual({
      kind: "playNow",
      song: C,
      removeAt: null,
    });
  });

  it("falls back to play-now when skipping is not allowed", () => {
    expect(planQueueJump([A, B, C], A, 1, { ...guest, skip: false })).toEqual({
      kind: "playNow",
      song: B,
      removeAt: 2,
    });
  });

  it("refuses when the session may neither play-at nor play now", () => {
    expect(planQueueJump([A, B], A, 1, { ...guest, playNow: false, skip: false })).toBeNull();
  });

  it("refuses a row that does not exist", () => {
    expect(planQueueJump([A, B], A, 5, member)).toBeNull();
    expect(planQueueJump([A, B], A, -1, member)).toBeNull();
  });
});
