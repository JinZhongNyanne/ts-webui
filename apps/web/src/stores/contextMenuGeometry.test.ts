import { describe, expect, it } from "vitest";
import { clampAxis, clampToViewport } from "./contextMenuGeometry";

const viewport = { width: 1000, height: 800 };
const menu = { width: 220, height: 300 };

describe("clampToViewport", () => {
  it("leaves a menu alone when it fits below and to the right of the cursor", () => {
    expect(clampToViewport({ x: 100, y: 100 }, menu, viewport)).toEqual({ x: 100, y: 100 });
  });

  it("flips above the cursor when there is no room below", () => {
    expect(clampToViewport({ x: 100, y: 700 }, menu, viewport)).toEqual({ x: 100, y: 400 });
  });

  it("flips left of the cursor when there is no room to the right", () => {
    expect(clampToViewport({ x: 900, y: 100 }, menu, viewport)).toEqual({ x: 680, y: 100 });
  });

  it("pushes inwards when the menu fits on neither side", () => {
    const tall = { width: 220, height: 780 };
    expect(clampToViewport({ x: 100, y: 500 }, tall, viewport)).toEqual({ x: 100, y: 12 });
  });

  it("never goes past the top-left margin", () => {
    expect(clampToViewport({ x: 0, y: 0 }, menu, viewport)).toEqual({ x: 8, y: 8 });
  });
});

describe("clampAxis", () => {
  it("leaves a box that already fits where it is", () => {
    expect(clampAxis(100, 220, 1000)).toBe(100);
  });

  it("pulls a box back from the far edge", () => {
    expect(clampAxis(900, 220, 1000)).toBe(772);
  });

  it("holds the near edge's margin", () => {
    expect(clampAxis(-40, 220, 1000)).toBe(8);
  });

  it("prefers the near edge when the box is bigger than the viewport", () => {
    expect(clampAxis(100, 1000, 1000)).toBe(8);
  });
});
