import { describe, expect, it } from "vitest";
import { creditFor } from "./credit.js";

describe("creditFor", () => {
  it("credits the song a single-song call names", () => {
    const song = { id: 42, name: "x", platform: "qq" };
    expect(creditFor("POST", "/player/b1/play-next-song", { song })).toEqual({
      botId: "b1",
      kind: "songs",
      songs: [{ ...song, id: "42" }],
    });
  });

  it("builds the song from add-by-id, or falls back to the queue without a platform", () => {
    expect(creditFor("POST", "/player/b1/add-by-id", { songId: "7", platform: "qq" })).toEqual({
      botId: "b1",
      kind: "songs",
      songs: [{ id: "7", platform: "qq" }],
    });
    expect(creditFor("POST", "/player/b1/add-by-id", { songId: "7" })).toEqual({
      botId: "b1",
      kind: "diff",
    });
  });

  it("reads the queue for calls whose songs the browser never saw", () => {
    for (const action of ["add", "play", "playlist", "play-playlist", "play-album", "fm"]) {
      expect(creditFor("POST", `/player/b1/${action}`, {})).toEqual({ botId: "b1", kind: "diff" });
    }
  });

  it("ignores calls that queue nothing", () => {
    expect(creditFor("POST", "/player/b1/pause", {})).toBeNull();
    expect(creditFor("GET", "/player/b1/queue", undefined)).toBeNull();
    expect(creditFor("POST", "/player/b1/add-song", { song: { id: "1" } })).toBeNull();
  });
});
