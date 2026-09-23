import { describe, expect, it } from "vitest";
import type { MusicSong } from "@jinz/protocol";
import {
  addedSongs,
  parsePlayedAt,
  RequesterBook,
  relabelResponse,
  relabelSong,
} from "./requesters.js";

const song = (id: string, requestedBy?: string, platform = "netease"): MusicSong => ({
  id,
  name: `song ${id}`,
  platform,
  ...(requestedBy !== undefined ? { requestedBy } : {}),
});

describe("addedSongs", () => {
  it("returns what the queue gained, counting a song queued twice as new", () => {
    const before = [song("1"), song("2")];
    const after = [song("1"), song("2"), song("2"), song("3")];
    expect(addedSongs(before, after).map((s) => s.id)).toEqual(["2", "3"]);
  });

  it("tells platforms apart and ignores rows that are not songs", () => {
    const after = [song("1", undefined, "qq"), { junk: true } as unknown as MusicSong];
    expect(addedSongs([song("1")], after).map((s) => s.platform)).toEqual(["qq"]);
  });
});

describe("parsePlayedAt", () => {
  it("reads the bot's SQLite timestamps as UTC", () => {
    expect(parsePlayedAt("2026-09-19 12:00:00")).toBe(Date.UTC(2026, 8, 19, 12));
  });

  it("gives NaN for anything unreadable", () => {
    expect(parsePlayedAt(undefined)).toBeNaN();
    expect(parsePlayedAt("yesterday")).toBeNaN();
  });
});

describe("RequesterBook", () => {
  it("names the latest request for the queue, and the one before a play for history", () => {
    const book = new RequesterBook();
    book.record("b1", [song("1")], "Alice", 1_000);
    book.record("b1", [song("1")], "Bob", 10 * 60_000);
    expect(book.nameFor("b1", song("1"), undefined, 11 * 60_000)).toBe("Bob");
    expect(book.nameFor("b1", song("1"), 2_000)).toBe("Alice");
    expect(book.nameFor("b2", song("1"))).toBeNull();
  });

  // In guest mode the bot's own guests share the hub's name; a request from
  // last week must not claim the song one of them queued today.
  it("names a queued song only after a recent request", () => {
    const book = new RequesterBook();
    book.record("b1", [song("1")], "Alice", 0);
    expect(book.nameFor("b1", song("1"), undefined, 23 * 3600_000)).toBe("Alice");
    expect(book.nameFor("b1", song("1"), undefined, 25 * 3600_000)).toBeNull();
  });

  it("caps song ids, platforms and bots, which anyone may choose", () => {
    const book = new RequesterBook();
    expect(book.record("b1", [song("x".repeat(129))], "A")).toBe(false);
    expect(book.record("b1", [song("1", undefined, "p".repeat(33))], "A")).toBe(false);
    for (let i = 0; i < 16; i++) book.record(`bot${i}`, [song("1")], "A");
    expect(book.record("bot16", [song("1")], "A")).toBe(false);
  });

  it("keeps a bot called __proto__ as data", () => {
    const book = new RequesterBook();
    book.record("__proto__", [song("1")], "A");
    const copy = RequesterBook.fromJson(JSON.parse(JSON.stringify(book.toJson())));
    expect(copy.nameFor("__proto__", song("1"))).toBe("A");
  });

  it("allows for the bot's clock running a little behind ours", () => {
    const book = new RequesterBook();
    book.record("b1", [song("1")], "Alice", 100_000);
    expect(book.nameFor("b1", song("1"), 100_000 - 60_000)).toBe("Alice");
  });

  it("refuses an empty name and trims a long one", () => {
    const book = new RequesterBook();
    expect(book.record("b1", [song("1")], "  ")).toBe(false);
    book.record("b1", [song("1")], "x".repeat(100));
    expect(book.nameFor("b1", song("1"))).toHaveLength(64);
  });

  it("survives a round trip through JSON and drops malformed records", () => {
    const book = new RequesterBook();
    book.record("b1", [song("1"), song("2")], "Alice");
    const copy = RequesterBook.fromJson(JSON.parse(JSON.stringify(book.toJson())));
    expect(copy.nameFor("b1", song("2"))).toBe("Alice");
    const bad = RequesterBook.fromJson({ b1: { "netease:1": [{ name: 3, at: "x" }] }, b2: 7 });
    expect(bad.toJson()).toEqual({});
  });

  it("forgets the least recently requested songs once a bot has too many", () => {
    const book = new RequesterBook();
    for (let i = 0; i < 1001; i++) book.record("b1", [song(String(i))], "A", i);
    expect(book.nameFor("b1", song("0"), undefined, 1001)).toBeNull();
    expect(book.nameFor("b1", song("1000"), undefined, 1001)).toBe("A");
  });
});

describe("relabelSong", () => {
  const book = new RequesterBook();
  book.record("b1", [song("1")], "Alice");

  it("puts the TeamSpeak name on a song the bot credited to the hub's account", () => {
    expect(relabelSong(song("1", "游客"), book, "b1", "游客").requestedBy).toBe("Alice");
    expect(relabelSong(song("1"), book, "b1", "游客").requestedBy).toBe("Alice");
  });

  it("leaves a song someone requested in the bot's own web UI alone", () => {
    expect(relabelSong(song("1", "admin"), book, "b1", "游客").requestedBy).toBe("admin");
  });

  it("keeps the bot's name when the hub has no record", () => {
    expect(relabelSong(song("2", "游客"), book, "b1", "游客").requestedBy).toBe("游客");
  });
});

describe("relabelResponse", () => {
  const book = new RequesterBook();
  book.record("b1", [song("1")], "Alice", Date.UTC(2026, 8, 19, 12));

  it("relabels the queue and the current song riding along with it", () => {
    const book = new RequesterBook();
    book.record("b1", [song("1")], "Alice");
    const body = { queue: [song("1", "游客")], status: { currentSong: song("1", "游客") } };
    const out = relabelResponse("/player/b1/queue", body, book, "游客") as typeof body;
    expect(out.queue[0]!.requestedBy).toBe("Alice");
    expect(out.status.currentSong.requestedBy).toBe("Alice");
    expect(body.queue[0]!.requestedBy).toBe("游客");
  });

  it("relabels history by when each song was played", () => {
    const body = {
      history: [
        { ...song("1", "游客"), playedAt: "2026-09-19 12:03:00" },
        { ...song("1", "游客"), playedAt: "2026-09-18 12:00:00" },
      ],
    };
    const out = relabelResponse("/player/b1/history", body, book, "游客") as typeof body;
    expect(out.history.map((h) => h.requestedBy)).toEqual(["Alice", "游客"]);
  });

  it("passes other answers through untouched", () => {
    const body = { queue: [song("1", "游客")] };
    expect(relabelResponse("/bot", body, book, "游客")).toBe(body);
    expect(relabelResponse("/player/b1/queue", null, book, "游客")).toBeNull();
  });
});
