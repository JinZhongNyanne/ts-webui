import { describe, expect, it } from "vitest";
import { batches, isChannelVisible, needsTalkPower } from "./client-features";
import { addPreset, MAX_AWAY_PRESETS, normalizePresets, removePreset } from "./away-presets";

describe("needsTalkPower", () => {
  const channel = (needed: number) => ({ neededTalkPower: needed });

  it("is false in a channel that asks for no talk power", () => {
    expect(needsTalkPower({ talkPower: 0, isTalker: false }, channel(0))).toBe(false);
  });

  it("is true when the channel asks for more than we have", () => {
    expect(needsTalkPower({ talkPower: 5, isTalker: false }, channel(10))).toBe(true);
  });

  it("is false with enough talk power or as a talker", () => {
    expect(needsTalkPower({ talkPower: 10, isTalker: false }, channel(10))).toBe(false);
    expect(needsTalkPower({ talkPower: 0, isTalker: true }, channel(10))).toBe(false);
  });
});

describe("isChannelVisible", () => {
  it("follows the subscription, except for the channel we are in", () => {
    expect(isChannelVisible({ id: "3", subscribed: true }, "1")).toBe(true);
    expect(isChannelVisible({ id: "3", subscribed: false }, "1")).toBe(false);
    expect(isChannelVisible({ id: "3", subscribed: false }, "3")).toBe(true);
    expect(isChannelVisible({ id: "3", subscribed: false }, null)).toBe(false);
  });
});

describe("batches", () => {
  it("splits into chunks of the given size", () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(batches([], 2)).toEqual([]);
  });
});

describe("away presets", () => {
  it("treats anything but an array as never edited", () => {
    expect(normalizePresets(null)).toBeNull();
    expect(normalizePresets("brb")).toBeNull();
  });

  it("trims, drops blanks, non-strings and duplicates, and caps length and count", () => {
    const long = "x".repeat(100);
    expect(normalizePresets([" brb ", "", 3, "brb", long])).toEqual(["brb", "x".repeat(80)]);
    const many = Array.from({ length: 20 }, (_, i) => `p${i}`);
    expect(normalizePresets(many)).toHaveLength(MAX_AWAY_PRESETS);
  });

  it("adds in front, moves an existing one there, and drops the oldest past the cap", () => {
    expect(addPreset(["a", "b"], " c ")).toEqual(["c", "a", "b"]);
    expect(addPreset(["a", "b"], "b")).toEqual(["b", "a"]);
    expect(addPreset(["a"], "   ")).toEqual(["a"]);
    const full = Array.from({ length: MAX_AWAY_PRESETS }, (_, i) => `p${i}`);
    const next = addPreset(full, "new");
    expect(next).toHaveLength(MAX_AWAY_PRESETS);
    expect(next[0]).toBe("new");
    expect(next).not.toContain(`p${MAX_AWAY_PRESETS - 1}`);
  });

  it("removes by text without touching the input", () => {
    const list = ["a", "b"];
    expect(removePreset(list, "a")).toEqual(["b"]);
    expect(list).toEqual(["a", "b"]);
  });
});
