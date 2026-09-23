import { describe, expect, it } from "vitest";
import { clampNumber, fitSize, MIN_WINDOW_EXTENT, spansOverlap, usableDesktop } from "./box";

describe("clampNumber", () => {
  it("keeps a value inside the range", () => {
    expect(clampNumber(5, 0, 10)).toBe(5);
    expect(clampNumber(-3, 0, 10)).toBe(0);
    expect(clampNumber(42, 0, 10)).toBe(10);
  });

  it("falls back to the minimum for a value that is not a number", () => {
    expect(clampNumber(Number.NaN, 4, 10)).toBe(4);
  });
});

describe("fitSize", () => {
  it("keeps the preferred size when it fits", () => {
    expect(fitSize(460, 1000, 160, 0.8)).toBe(460);
  });

  it("shrinks to a share of a small container", () => {
    expect(fitSize(460, 400, 160, 0.8)).toBe(320);
  });

  it("never goes below the minimum", () => {
    expect(fitSize(460, 100, 160, 0.8)).toBe(160);
  });
});

describe("usableDesktop", () => {
  it("returns the size of a real box", () => {
    expect(usableDesktop(1280, 720)).toEqual({ width: 1280, height: 720 });
  });

  it("returns null for a box we cannot size against", () => {
    // dockview's container is 0x0 on the first frame; a detached element is NaN.
    expect(usableDesktop(0, 720)).toBeNull();
    expect(usableDesktop(1280, 0)).toBeNull();
    expect(usableDesktop(Number.NaN, 720)).toBeNull();
    expect(usableDesktop(1280, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("spansOverlap", () => {
  it("is true for spans that share any length at all", () => {
    expect(spansOverlap(0, 100, 50, 150)).toBe(true);
    expect(spansOverlap(50, 150, 0, 100)).toBe(true);
    // One span wholly inside the other still overlaps.
    expect(spansOverlap(20, 40, 0, 100)).toBe(true);
  });

  it("is false for spans that merely touch, and for spans apart", () => {
    // Half-open, which is what keeps two windows corner to corner from counting
    // as neighbours: `windowSnap`'s abut and `snapGroup`'s seam both read this.
    expect(spansOverlap(0, 100, 100, 200)).toBe(false);
    expect(spansOverlap(100, 200, 0, 100)).toBe(false);
    expect(spansOverlap(0, 100, 140, 200)).toBe(false);
  });
});

describe("MIN_WINDOW_EXTENT", () => {
  it("leaves room for a title bar, and less than a window is opened at", () => {
    expect(MIN_WINDOW_EXTENT).toBeGreaterThan(0);
    expect(MIN_WINDOW_EXTENT).toBeLessThan(200);
  });
});
