import { describe, expect, it } from "vitest";
import {
  isPlayableSong,
  parseFavorites,
  parseHistory,
  parsePlaylistDetail,
  parsePlaylists,
  parseSongs,
  playlistsFrom,
} from "./browse-types";

describe("parsePlaylists", () => {
  it("keeps the fields the cards render and drops the rest", () => {
    const list = parsePlaylists(
      {
        playlists: [
          { id: "7", name: "Daily", coverUrl: "http://cdn/a.jpg", songCount: 30, platform: "qq" },
          { id: "8", name: "Focus", extra: "ignored" },
        ],
      },
      "netease",
    );
    expect(list).toEqual([
      { id: "7", name: "Daily", coverUrl: "http://cdn/a.jpg", songCount: 30, platform: "qq" },
      { id: "8", name: "Focus", coverUrl: "", songCount: 0, platform: "netease" },
    ]);
  });

  it("refuses anything that is not a list of named, identified playlists", () => {
    expect(parsePlaylists(null, "netease")).toEqual([]);
    expect(parsePlaylists({ playlists: "nope" }, "netease")).toEqual([]);
    expect(parsePlaylists({ playlists: [{ id: "1" }, { name: "no id" }] }, "netease")).toEqual([]);
  });
});

describe("parseSongs", () => {
  it("passes the bot's own song objects through, platform filled in", () => {
    const songs = parseSongs(
      { songs: [{ id: "1", name: "A", artist: "B", duration: 210, platform: "qq" }, { id: "2" }] },
      "netease",
    );
    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({ id: "1", name: "A", duration: 210, platform: "qq" });
  });

  it("defaults the platform of a song that does not name one", () => {
    expect(parseSongs({ songs: [{ id: "9", name: "C" }] }, "bilibili")[0]?.platform).toBe(
      "bilibili",
    );
  });

  it("answers with an empty list for a failed or odd payload", () => {
    expect(parseSongs(undefined, "netease")).toEqual([]);
    expect(parseSongs({ error: "boom" }, "netease")).toEqual([]);
  });
});

describe("parseHistory", () => {
  it("reads the history rows, keeping when and who", () => {
    const rows = parseHistory({
      history: [
        {
          id: "1",
          name: "A",
          artist: "B",
          platform: "netease",
          duration: 0,
          playedAt: "2026-09-17 08:40:54",
          requestedBy: "alice",
        },
      ],
    });
    expect(rows[0]).toMatchObject({
      id: "1",
      playedAt: "2026-09-17 08:40:54",
      requestedBy: "alice",
    });
  });

  it("is empty when the bot keeps no database", () => {
    expect(parseHistory({ history: [] })).toEqual([]);
    expect(parseHistory({})).toEqual([]);
  });
});

describe("isPlayableSong", () => {
  /**
   * History rows come back with `duration: 0` and no url, so the bot cannot
   * resolve a stream from them; they have to be re-queued by id instead.
   */
  it("calls a history row unplayable and a search result playable", () => {
    expect(isPlayableSong({ id: "1", name: "A", platform: "netease", duration: 0 })).toBe(false);
    expect(isPlayableSong({ id: "1", name: "A", platform: "netease" })).toBe(false);
    expect(isPlayableSong({ id: "1", name: "A", platform: "netease", duration: 180 })).toBe(true);
  });
});

describe("parseFavorites", () => {
  it("reads the starred playlists the bot account keeps", () => {
    expect(
      parseFavorites({
        favorites: [
          {
            id: 3,
            platform: "netease",
            playlistId: "123",
            name: "Star",
            coverUrl: "",
            songCount: 9,
          },
          { platform: "qq", name: "no playlist id" },
        ],
      }),
    ).toEqual([{ id: "123", name: "Star", coverUrl: "", songCount: 9, platform: "netease" }]);
  });
});

describe("parsePlaylistDetail", () => {
  it("reads the header shown above a playlist's songs", () => {
    expect(
      parsePlaylistDetail({
        playlist: { id: "1", name: "Mix", description: "d", coverUrl: "c", songCount: 4 },
      }),
    ).toEqual({ id: "1", name: "Mix", description: "d", coverUrl: "c", songCount: 4 });
  });

  it("is null when the provider does not support details", () => {
    expect(parsePlaylistDetail({ error: "Not supported by this provider" })).toBeNull();
    expect(parsePlaylistDetail(null)).toBeNull();
  });
});

describe("playlistsFrom", () => {
  const stars = [
    { id: "1", name: "A", coverUrl: "", songCount: 1, platform: "netease" },
    { id: "2", name: "B", coverUrl: "", songCount: 2, platform: "qq" },
    { id: "3", name: "C", coverUrl: "", songCount: 3, platform: "netease" },
  ];

  /**
   * `/favorites` answers with every platform at once, so 我的收藏 gets its
   * source tab by filtering what is already in hand.
   */
  it("keeps the starred playlists of one platform, in order", () => {
    expect(playlistsFrom(stars, "netease")).toEqual([stars[0], stars[2]]);
  });

  it("keeps everything when no source is picked yet", () => {
    expect(playlistsFrom(stars, null)).toEqual(stars);
  });

  it("returns a new list and leaves the original alone", () => {
    const out = playlistsFrom(stars, "qq");
    expect(out).not.toBe(stars);
    expect(stars).toHaveLength(3);
  });
});
