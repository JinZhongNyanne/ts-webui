import { describe, expect, it, vi } from "vitest";
import type { MusicSong } from "@jinz/protocol";
import {
  bestMatch,
  cleanTitle,
  fallbackPlatforms,
  findLyrics,
  matchScore,
  type LyricsSource,
} from "./lyrics-fallback";

const s = (over: Partial<MusicSong>): MusicSong => ({
  id: "1",
  name: "晴天",
  platform: "netease",
  artist: "周杰伦",
  duration: 269,
  ...over,
});

const LYRICS = {
  lyrics: [
    { time: 1, text: "故事的小黄花" },
    { time: 5, text: "从出生那年就飘着" },
    { time: 9, text: "童年的荡秋千" },
  ],
};

describe("cleanTitle", () => {
  it("drops bracketed tags", () => {
    expect(cleanTitle("【MV】晴天 (Live) [Remastered]")).toBe("晴天");
    expect(cleanTitle("《晴天》")).toBe("晴天");
  });

  it("keeps a title that is nothing but brackets", () => {
    expect(cleanTitle("(Intro)")).toBe("(Intro)");
  });
});

describe("matchScore", () => {
  it("accepts the same title by the same artist, and prefers the same length", () => {
    const own = s({ platform: "qq" });
    expect(matchScore(own, s({}))).toBe(7);
    expect(matchScore(own, s({ duration: 262 }))).toBe(6);
  });

  it("ranks a version of the song below the song itself", () => {
    const own = s({ platform: "qq" });
    expect(matchScore(own, s({ name: "晴天 (Live)" }))!).toBeLessThan(matchScore(own, s({}))!);
  });

  it("refuses another artist's song of the same name", () => {
    expect(matchScore(s({ platform: "qq" }), s({ artist: "someone else" }))).toBeNull();
  });

  it("refuses a very different cut, whose timings would be off", () => {
    expect(matchScore(s({ platform: "qq" }), s({ duration: 320 }))).toBeNull();
  });

  describe("for a video", () => {
    // Real titles from the bot's Bilibili search.
    const video = s({
      platform: "bilibili",
      name: "【𝐇𝐢-𝐑𝐞𝐬无损音质】｜《晴天》- 周杰伦 -‘故事的小黄花’",
      artist: "某UP主",
      duration: 270,
    });

    it("takes the song whose singer the title names", () => {
      expect(matchScore(video, s({}))).toBe(5);
    });

    it("refuses a cover by someone the title does not name", () => {
      expect(
        matchScore(video, s({ name: "晴天 (深情版)", artist: "Lucky小爱", duration: 268 })),
      ).toBeNull();
    });

    it("refuses a video that does not name the singer", () => {
      const bare = { ...video, name: "晴天" };
      expect(matchScore(bare, s({}))).toBeNull();
    });

    it("refuses a video of unknown length, such as a guitar lesson", () => {
      const lesson = s({
        platform: "bilibili",
        name: "周杰伦《稻香》吉他指弹详细讲解",
        duration: 0,
      });
      expect(matchScore(lesson, s({ name: "稻香", duration: 223 }))).toBeNull();
    });
  });

  it("takes a song without an artist only at the same length", () => {
    const own = s({ platform: "qq", artist: "" });
    expect(matchScore(own, s({ duration: 270 }))).not.toBeNull();
    expect(matchScore(own, s({ duration: 262 }))).toBeNull();
    expect(matchScore({ ...own, duration: 0 }, s({}))).toBeNull();
  });

  it("splits several artists", () => {
    const own = s({ platform: "qq", artist: "A / 周杰伦" });
    expect(matchScore(own, s({ artist: "周杰伦、B" }))).not.toBeNull();
  });
});

describe("bestMatch", () => {
  it("picks the highest scoring acceptable candidate", () => {
    const own = s({ platform: "qq" });
    const pick = bestMatch(own, [
      s({ id: "a", duration: 262 }),
      s({ id: "b" }),
      s({ id: "c", artist: "x" }),
    ]);
    expect(pick?.id).toBe("b");
  });
});

describe("fallbackPlatforms", () => {
  it("tries the other enabled lyrics platforms", () => {
    expect(fallbackPlatforms("netease", ["netease", "kugou", "bilibili"])).toEqual(["kugou"]);
    expect(fallbackPlatforms("bilibili", [])).toEqual(["netease", "qq", "kugou"]);
  });
});

describe("findLyrics", () => {
  function source(over: Partial<LyricsSource> = {}): LyricsSource {
    return {
      lyrics: vi.fn(async (_id: string, platform: string) =>
        platform === "qq" ? LYRICS : { lyrics: [] },
      ),
      search: vi.fn(async () => ({ songs: [s({ id: "q1", platform: "qq" })] })),
      ...over,
    };
  }

  it("uses the song's own lyrics when it has them, without searching", async () => {
    const src = source({ lyrics: vi.fn(async () => LYRICS) });
    const found = await findLyrics(s({}), [], src);
    expect(found).toEqual({ lines: LYRICS.lyrics, from: null });
    expect(src.search).not.toHaveBeenCalled();
  });

  it("finds them on another platform when the song's own has none", async () => {
    const src = source();
    const found = await findLyrics(s({}), ["netease", "qq"], src);
    expect(found.from).toBe("qq");
    expect(found.lines).toHaveLength(3);
    expect(src.search).toHaveBeenCalledWith("晴天 周杰伦", "qq", 8);
    expect(src.lyrics).toHaveBeenLastCalledWith("q1", "qq");
  });

  it("does not borrow a one-line placeholder", async () => {
    const src = source({
      lyrics: vi.fn(async (_id: string, platform: string) =>
        platform === "qq" ? { lyrics: [{ time: 0, text: "纯音乐，请欣赏" }] } : { lyrics: [] },
      ),
    });
    expect(await findLyrics(s({}), ["netease", "qq"], src)).toEqual({ lines: [], from: null });
  });

  it("moves on when a platform fails", async () => {
    const src = source({
      search: vi.fn(async (_q: string, platform: string) => {
        if (platform === "qq") throw new Error("down");
        return { songs: [s({ id: "k1", platform: "kugou" })] };
      }),
      lyrics: vi.fn(async (_id: string, platform: string) =>
        platform === "kugou" ? LYRICS : { lyrics: [] },
      ),
    });
    expect((await findLyrics(s({}), [], src)).from).toBe("kugou");
  });

  it("reports none when nothing matches, and a failure when its own platform failed", async () => {
    const nothing = source({ search: vi.fn(async () => ({ songs: [] })) });
    expect(await findLyrics(s({}), [], nothing)).toEqual({ lines: [], from: null });
    const broken = source({
      lyrics: vi.fn(async () => {
        throw new Error("500");
      }),
      search: vi.fn(async () => ({ songs: [] })),
    });
    await expect(findLyrics(s({}), [], broken)).rejects.toThrow();
  });
});
