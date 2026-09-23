import { describe, expect, it } from "vitest";
import { MusicApiError } from "./api";
import { emptySection, fillSection, isStale, isUnsupported, orphanLoads } from "./section";

const describeErr = (e: unknown) => (e instanceof Error ? e.message : String(e));

describe("fillSection", () => {
  it("fills the list and records which source it belongs to", async () => {
    const s = emptySection<string>();
    await fillSection(s, "netease", async () => ["a", "b"], describeErr);
    expect(s).toEqual({
      items: ["a", "b"],
      loading: false,
      hidden: false,
      error: null,
      loadedFor: "netease",
      requested: "netease",
      seq: 1,
    });
  });

  it("drops an answer that a newer source switch has overtaken", async () => {
    const s = emptySection<string>();
    let finishSlow!: (v: string[]) => void;
    const slow = fillSection(
      s,
      "netease",
      () => new Promise<string[]>((r) => (finishSlow = r)),
      describeErr,
    );
    await fillSection(s, "qq", async () => ["qq-song"], describeErr);
    finishSlow(["netease-song"]);
    await slow;
    expect(s.items).toEqual(["qq-song"]);
    expect(s.loadedFor).toBe("qq");
    expect(s.loading).toBe(false);
  });

  it("drops an old bot's answer after a reset, even for the same source", async () => {
    const s = emptySection<string>();
    let finishOld!: (v: string[]) => void;
    const old = fillSection(
      s,
      "netease",
      () => new Promise<string[]>((r) => (finishOld = r)),
      describeErr,
    );
    orphanLoads(s);
    await fillSection(s, "netease", async () => ["new-bot"], describeErr);
    finishOld(["old-bot"]);
    await old;
    expect(s.items).toEqual(["new-bot"]);
  });

  it("keeps loading until the newest request for a source returns", async () => {
    const s = emptySection<string>();
    let finishFirst!: (v: string[]) => void;
    const first = fillSection(
      s,
      "netease",
      () => new Promise<string[]>((r) => (finishFirst = r)),
      describeErr,
    );
    void fillSection(s, "qq", () => new Promise<string[]>(() => {}), describeErr);
    void fillSection(s, "netease", () => new Promise<string[]>(() => {}), describeErr);
    finishFirst(["stale"]);
    await first;
    expect(s.items).toEqual([]);
    expect(s.loading).toBe(true);
  });

  it("drops a late failure from an overtaken source", async () => {
    const s = emptySection<string>();
    let failSlow!: (e: unknown) => void;
    const slow = fillSection(
      s,
      "netease",
      () => new Promise<string[]>((_, reject) => (failSlow = reject)),
      describeErr,
    );
    await fillSection(s, "qq", async () => ["qq-song"], describeErr);
    failSlow(new MusicApiError(502, "late"));
    await slow;
    expect(s.error).toBeNull();
    expect(s.items).toEqual(["qq-song"]);
  });

  it("hides the section when the bot does not offer it", async () => {
    for (const status of [403, 404, 501]) {
      const s = emptySection<string>();
      await fillSection(
        s,
        "qq",
        () => Promise.reject(new MusicApiError(status, "forbidden")),
        describeErr,
      );
      expect(s.hidden).toBe(true);
      expect(s.error).toBeNull();
      expect(s.items).toEqual([]);
    }
  });

  it("reports a real failure instead of hiding it", async () => {
    const s = emptySection<string>();
    await fillSection(
      s,
      "qq",
      () => Promise.reject(new MusicApiError(502, "bot down")),
      describeErr,
    );
    expect(s.hidden).toBe(false);
    expect(s.error).toBe("bot down");
  });

  it("clears a previous error and its contents on a failing reload", async () => {
    const s = emptySection<string>();
    await fillSection(s, "netease", async () => ["a"], describeErr);
    await fillSection(s, "netease", () => Promise.reject(new Error("boom")), describeErr);
    expect(s.items).toEqual([]);
    expect(s.error).toBe("boom");
    // Still marked as loaded, so the tab does not retry in a loop.
    expect(s.loadedFor).toBe("netease");
    expect(s.loading).toBe(false);
  });
});

describe("isStale", () => {
  it("reloads for a different source, but not for the same one", async () => {
    const s = emptySection<string>();
    expect(isStale(s, "netease")).toBe(true);
    await fillSection(s, "netease", async () => ["a"], describeErr);
    expect(isStale(s, "netease")).toBe(false);
    expect(isStale(s, "qq")).toBe(true);
    expect(isStale(s, "netease", true)).toBe(true);
  });

  it("does not ask twice for a source already being loaded", () => {
    const s = emptySection<string>();
    void fillSection(s, "qq", () => new Promise<string[]>(() => {}), describeErr);
    expect(isStale(s, "qq")).toBe(false);
    expect(isStale(s, "netease")).toBe(true);
  });
});

describe("isUnsupported", () => {
  it("only counts the bot's own refusals, not any error", () => {
    expect(isUnsupported(new MusicApiError(403, "x"))).toBe(true);
    expect(isUnsupported(new MusicApiError(500, "x"))).toBe(false);
    expect(isUnsupported(new Error("network"))).toBe(false);
  });
});
