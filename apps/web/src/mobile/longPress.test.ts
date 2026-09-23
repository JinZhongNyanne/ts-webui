import { describe, expect, it } from "vitest";
import { LONG_PRESS_MOVE_TOLERANCE, LONG_PRESS_MS, movedTooFar } from "./longPress";

const origin = { x: 100, y: 100 };

describe("movedTooFar", () => {
  it("tolerates the small drift of a finger held still", () => {
    expect(movedTooFar(origin, { x: 103, y: 104 })).toBe(false);
    expect(movedTooFar(origin, origin)).toBe(false);
  });

  it("reports a scroll as a move, in either direction", () => {
    expect(movedTooFar(origin, { x: 100, y: 100 + LONG_PRESS_MOVE_TOLERANCE + 1 })).toBe(true);
    expect(movedTooFar(origin, { x: 100 - LONG_PRESS_MOVE_TOLERANCE - 1, y: 100 })).toBe(true);
  });

  it("holds a press that drifts exactly to the tolerance", () =>
    expect(movedTooFar(origin, { x: 100 + LONG_PRESS_MOVE_TOLERANCE, y: 100 })).toBe(false));

  it("waits long enough to tell a press from a tap", () =>
    expect(LONG_PRESS_MS).toBeGreaterThan(300));
});
