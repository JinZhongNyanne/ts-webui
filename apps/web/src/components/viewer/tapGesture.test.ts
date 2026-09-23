import { describe, expect, it } from "vitest";
import { DOUBLE_TAP_MS, TAP_SLOP_PX, isDoubleTap, isTap } from "./tapGesture";

describe("isTap", () => {
  it("accepts a finger that lifted where it landed", () => {
    expect(isTap({ x: 100, y: 200 }, { x: 100, y: 200 })).toBe(true);
  });

  it("allows the wobble of a real fingertip", () => {
    expect(isTap({ x: 100, y: 200 }, { x: 100 + TAP_SLOP_PX, y: 200 })).toBe(true);
  });

  it("rejects a drag, whichever way it went", () => {
    expect(isTap({ x: 100, y: 200 }, { x: 100 + TAP_SLOP_PX + 1, y: 200 })).toBe(false);
    expect(isTap({ x: 100, y: 200 }, { x: 100, y: 200 - TAP_SLOP_PX - 1 })).toBe(false);
  });

  it("measures the diagonal, not either axis on its own", () => {
    // 10 and 10 are each inside the slop; together they are 14.1 and are not.
    expect(isTap({ x: 0, y: 0 }, { x: 10, y: 10 })).toBe(false);
  });
});

describe("isDoubleTap", () => {
  it("pairs two taps inside the window", () => {
    expect(isDoubleTap(1000, 1000 + DOUBLE_TAP_MS)).toBe(true);
  });

  it("does not pair taps further apart than the window", () => {
    expect(isDoubleTap(1000, 1000 + DOUBLE_TAP_MS + 1)).toBe(false);
  });

  it("never pairs the first tap of a session with nothing", () => {
    expect(isDoubleTap(0, 5)).toBe(false);
  });
});
