import { describe, expect, it } from "vitest";
import { activeLineIndex, parseLrc, parseLyrics } from "./lyrics";

describe("parseLyrics", () => {
  it("reads the bot's timed rows, translation included", () => {
    expect(
      parseLyrics({
        lyrics: [
          { time: 12.5, text: "second", translation: "第二" },
          { time: 1, text: "first" },
        ],
      }),
    ).toEqual([
      { time: 1, text: "first" },
      { time: 12.5, text: "second", translation: "第二" },
    ]);
  });

  it("drops rows it cannot place or show", () => {
    expect(
      parseLyrics({
        lyrics: [
          { time: "3", text: "string time" },
          { time: -1, text: "negative" },
          { time: 4, text: "   " },
          { time: Number.NaN, text: "nan" },
          null,
          "raw",
          { time: 5, text: "kept", translation: " " },
        ],
      }),
    ).toEqual([{ time: 5, text: "kept" }]);
  });

  it("parses a raw LRC string", () => {
    expect(parseLyrics({ lyrics: "[00:01.50]hello\n[00:03.00]world" })).toEqual([
      { time: 1.5, text: "hello" },
      { time: 3, text: "world" },
    ]);
  });

  it("is empty for anything else", () => {
    expect(parseLyrics(null)).toEqual([]);
    expect(parseLyrics({})).toEqual([]);
    expect(parseLyrics({ lyrics: 3 })).toEqual([]);
  });
});

describe("parseLrc", () => {
  it("expands a line with several time tags", () => {
    expect(parseLrc("[00:10.00][01:10.00]chorus")).toEqual([
      { time: 10, text: "chorus" },
      { time: 70, text: "chorus" },
    ]);
  });

  it("skips metadata tags and empty lines", () => {
    expect(parseLrc("[ar:someone]\n[00:02.00]\n[00:02.5]x\r\n")).toEqual([
      { time: 2.5, text: "x" },
    ]);
  });

  it("reads millisecond and colon-separated fractions", () => {
    expect(parseLrc("[00:01.250]a\n[00:02:50]b")).toEqual([
      { time: 1.25, text: "a" },
      { time: 2.5, text: "b" },
    ]);
  });
});

describe("activeLineIndex", () => {
  const lines = [
    { time: 1, text: "a" },
    { time: 5, text: "b" },
    { time: 9, text: "c" },
  ];

  it("is -1 before the first line", () => {
    expect(activeLineIndex(lines, 0.5)).toBe(-1);
    expect(activeLineIndex([], 10)).toBe(-1);
  });

  it("is the last line that has started", () => {
    expect(activeLineIndex(lines, 1)).toBe(0);
    expect(activeLineIndex(lines, 8.99)).toBe(1);
    expect(activeLineIndex(lines, 300)).toBe(2);
  });
});
