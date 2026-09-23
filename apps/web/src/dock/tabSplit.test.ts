import { describe, expect, it } from "vitest";
import { MIN_WINDOW_EXTENT, type Box } from "./box";
import { splitFor, tabSplitFor } from "./tabSplit";

/** An odd-sized window, so the rounding is visible on both axes. */
const TARGET: Box = { x: 100, y: 50, width: 801, height: 601 };

/** The four edges, and nothing else, offer a split. */
const EDGES = ["left", "right", "top", "bottom"] as const;

describe("splitFor", () => {
  it("gives the tab the left half and pushes the window into the right one", () => {
    const split = splitFor(TARGET, "left");
    expect(split?.tab).toEqual({ x: 100, y: 50, width: 400, height: 601 });
    expect(split?.under).toEqual({ x: 500, y: 50, width: 401, height: 601 });
  });

  it("gives the tab the right half and leaves the window the left one", () => {
    const split = splitFor(TARGET, "right");
    expect(split?.tab).toEqual({ x: 500, y: 50, width: 401, height: 601 });
    expect(split?.under).toEqual({ x: 100, y: 50, width: 400, height: 601 });
  });

  it("gives the tab the top half and pushes the window down", () => {
    const split = splitFor(TARGET, "top");
    expect(split?.tab).toEqual({ x: 100, y: 50, width: 801, height: 300 });
    expect(split?.under).toEqual({ x: 100, y: 350, width: 801, height: 301 });
  });

  it("gives the tab the bottom half and leaves the window the top one", () => {
    const split = splitFor(TARGET, "bottom");
    expect(split?.tab).toEqual({ x: 100, y: 350, width: 801, height: 301 });
    expect(split?.under).toEqual({ x: 100, y: 50, width: 801, height: 300 });
  });

  // The whole point of the rounding discipline: no wallpaper seam, no overlap.
  it.each(EDGES)("tiles the target exactly on an odd size (%s)", (position) => {
    const split = splitFor(TARGET, position);
    if (!split) throw new Error("expected a split");
    const { tab, under } = split;
    const area = (box: Box) => box.width * box.height;
    expect(area(tab) + area(under)).toBe(TARGET.width * TARGET.height);
    expect(Math.min(tab.x, under.x)).toBe(TARGET.x);
    expect(Math.min(tab.y, under.y)).toBe(TARGET.y);
    expect(Math.max(tab.x + tab.width, under.x + under.width)).toBe(TARGET.x + TARGET.width);
    expect(Math.max(tab.y + tab.height, under.y + under.height)).toBe(TARGET.y + TARGET.height);
  });

  it("refuses the centre, which still tears the tab out under the pointer", () => {
    expect(splitFor(TARGET, "center")).toBeNull();
  });

  it("refuses a position it does not know", () => {
    expect(splitFor(TARGET, "edge")).toBeNull();
  });

  // A split that cannot fit is not a split: both halves have to stay usable.
  it("refuses a horizontal split that would leave a half too narrow", () => {
    const narrow: Box = { ...TARGET, width: MIN_WINDOW_EXTENT * 2 - 1 };
    expect(splitFor(narrow, "left")).toBeNull();
    expect(splitFor(narrow, "right")).toBeNull();
  });

  it("refuses a vertical split that would leave a half too short", () => {
    const short: Box = { ...TARGET, height: MIN_WINDOW_EXTENT * 2 - 1 };
    expect(splitFor(short, "top")).toBeNull();
    expect(splitFor(short, "bottom")).toBeNull();
  });

  it("allows a split whose halves are exactly the minimum", () => {
    const exact: Box = { ...TARGET, width: MIN_WINDOW_EXTENT * 2 };
    expect(splitFor(exact, "left")?.tab.width).toBe(MIN_WINDOW_EXTENT);
  });

  it("refuses a box it cannot measure", () => {
    expect(splitFor({ x: 0, y: 0, width: Number.NaN, height: 600 }, "left")).toBeNull();
  });

  it("keys each quadrant differently, and the same quadrant the same way", () => {
    const keys = EDGES.map((position) => splitFor(TARGET, position)?.key);
    expect(new Set(keys).size).toBe(EDGES.length);
    expect(splitFor(TARGET, "left")?.key).toBe(splitFor(TARGET, "left")?.key);
  });

  // The dwell tells one target from another by this string alone.
  it("keys two windows at different boxes differently", () => {
    const elsewhere: Box = { ...TARGET, x: TARGET.x + 40 };
    expect(splitFor(TARGET, "left")?.key).not.toBe(splitFor(elsewhere, "left")?.key);
  });
});

describe("tabSplitFor", () => {
  const drop = (over: Partial<Parameters<typeof tabSplitFor>[0]> = {}) =>
    tabSplitFor({ kind: "content", position: "left", target: TARGET, sameWindow: false, ...over });

  it("splits a tab dropped on another window's content edge", () => {
    expect(drop()?.tab).toEqual(splitFor(TARGET, "left")?.tab);
  });

  it("leaves a drop on the tab bar to dockview, which stacks it", () => {
    expect(drop({ kind: "tab" })).toBeNull();
    expect(drop({ kind: "header_space" })).toBeNull();
  });

  it("leaves the layout's own edge alone", () => {
    expect(drop({ kind: "edge" })).toBeNull();
  });

  it("does nothing when the tab is dropped on the window it came from", () => {
    expect(drop({ sameWindow: true })).toBeNull();
  });

  it("refuses a window whose box could not be read", () => {
    expect(drop({ target: null })).toBeNull();
  });

  it("keeps the centre as a tear-out", () => {
    expect(drop({ position: "center" })).toBeNull();
  });
});
