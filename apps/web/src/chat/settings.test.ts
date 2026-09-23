import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHAT_SETTINGS,
  MAX_RETENTION_DAYS,
  clampRetention,
  normalizeChatSettings,
  normalizeHost,
  withImageHost,
  withoutImageHost,
} from "./settings";

describe("normalizeHost", () => {
  it.each([
    ["i.imgur.com", "i.imgur.com"],
    [" I.Example.COM ", "i.example.com"],
    ["localhost:8080", "localhost:8080"],
    ["[::1]:443", "[::1]:443"],
  ])("accepts %s", (input, out) => {
    expect(normalizeHost(input)).toBe(out);
  });

  it.each(["", "a b", "http://x", "x/y", "-x.com", "x..com", '"><img>'])("rejects %s", (h) => {
    expect(normalizeHost(h)).toBeNull();
  });
});

describe("normalizeChatSettings", () => {
  it("falls back to defaults for garbage", () => {
    expect(normalizeChatSettings(null)).toEqual(DEFAULT_CHAT_SETTINGS);
    expect(normalizeChatSettings("x")).toEqual(DEFAULT_CHAT_SETTINGS);
  });

  it("keeps valid values and drops invalid hosts and duplicates", () => {
    expect(
      normalizeChatSettings({
        historyEnabled: false,
        retentionDays: 7,
        imageHosts: ["A.com", "a.com", 5, "bad host"],
        autoImages: false,
      }),
    ).toEqual({
      historyEnabled: false,
      retentionDays: 7,
      imageHosts: ["a.com"],
      autoImages: false,
    });
  });

  it("shows small shared pictures by itself unless the stored value says not to", () => {
    expect(DEFAULT_CHAT_SETTINGS.autoImages).toBe(true);
    expect(normalizeChatSettings({}).autoImages).toBe(true);
    expect(normalizeChatSettings({ autoImages: "no" }).autoImages).toBe(true);
    expect(normalizeChatSettings({ autoImages: false }).autoImages).toBe(false);
  });

  it("clamps the retention", () => {
    expect(clampRetention(-3)).toBe(0);
    expect(clampRetention(1e9)).toBe(MAX_RETENTION_DAYS);
    expect(clampRetention("12")).toBe(12);
    expect(clampRetention("x")).toBe(30);
  });
});

describe("image host list", () => {
  it("adds a host once, without touching the original", () => {
    const a = withImageHost(DEFAULT_CHAT_SETTINGS, "X.com");
    expect(a.imageHosts).toEqual(["x.com"]);
    expect(DEFAULT_CHAT_SETTINGS.imageHosts).toEqual([]);
    expect(withImageHost(a, "x.com")).toBe(a);
    expect(withImageHost(a, "not a host")).toBe(a);
  });

  it("removes a host", () => {
    const a = withImageHost(withImageHost(DEFAULT_CHAT_SETTINGS, "a.com"), "b.com");
    expect(withoutImageHost(a, "A.com").imageHosts).toEqual(["b.com"]);
  });
});
