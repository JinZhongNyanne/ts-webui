import { describe, expect, it } from "vitest";
import { discoverSources, loadSource, pickSource, saveSource } from "./discover-sources";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

describe("discoverSources", () => {
  it("offers every discover platform before /providers answers", () => {
    expect(discoverSources([])).toEqual(["netease", "qq", "kugou"]);
  });

  it("keeps only the enabled ones, in the bot's order", () => {
    expect(discoverSources(["bilibili", "qq", "netease"])).toEqual(["netease", "qq"]);
  });

  it("is empty when the bot runs none of them", () => {
    expect(discoverSources(["bilibili", "jellyfin"])).toEqual([]);
  });
});

describe("pickSource", () => {
  it("keeps the saved tab while it is offered", () => {
    expect(pickSource("qq", ["netease", "qq"], "netease")).toBe("qq");
  });

  it("falls back to the browse platform when the saved tab is gone", () => {
    expect(pickSource("kugou", ["netease", "qq"], "qq")).toBe("qq");
  });

  it("falls back to the first tab when neither is offered", () => {
    expect(pickSource(null, ["netease", "qq"], "bilibili")).toBe("netease");
  });

  it("is null without any tab", () => {
    expect(pickSource("qq", [], "qq")).toBeNull();
  });
});

describe("loadSource / saveSource", () => {
  it("remembers each section separately", () => {
    const s = memoryStorage();
    saveSource("recommend", "qq", s);
    saveSource("daily", "netease", s);
    expect(loadSource("recommend", s)).toBe("qq");
    expect(loadSource("daily", s)).toBe("netease");
  });

  it("ignores a corrupted value", () => {
    const s = memoryStorage({ "jinz.music.discoverSources": "[1,2" });
    expect(loadSource("recommend", s)).toBeNull();
    saveSource("recommend", "qq", s);
    expect(loadSource("recommend", s)).toBe("qq");
  });

  it("ignores a non-object value", () => {
    const s = memoryStorage({ "jinz.music.discoverSources": "[]" });
    expect(loadSource("daily", s)).toBeNull();
  });

  it("survives storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadSource("daily", broken)).toBeNull();
    expect(() => saveSource("daily", "qq", broken)).not.toThrow();
  });
});

describe("the library's own source tabs", () => {
  /**
   * 我的歌单 and 我的收藏 pick their platform the same way 推荐歌单 does, and
   * one section's choice must never move another's.
   */
  it("remembers the library sections apart from the discover ones", () => {
    const s = memoryStorage();
    saveSource("recommend", "netease", s);
    saveSource("playlists", "qq", s);
    saveSource("favorites", "kugou", s);
    expect(loadSource("recommend", s)).toBe("netease");
    expect(loadSource("playlists", s)).toBe("qq");
    expect(loadSource("favorites", s)).toBe("kugou");
  });
});
