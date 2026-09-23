import { describe, expect, it } from "vitest";
import {
  CORNER_DISTANCE,
  EDGE_DISTANCE,
  RELEASE_DISTANCE,
  snapBox,
  snapZoneFor,
  type SnapZone,
} from "./snap";

const DESKTOP = { width: 1000, height: 800 };

/** The pointer at (x, y), relative to the desktop's top-left. */
const zone = (x: number, y: number, current: SnapZone | null = null, suspended = false) =>
  snapZoneFor({ pointer: { x, y }, desktop: DESKTOP, current, suspended });

/** A point safely clear of every band, for the axis we are not testing. */
const MID_X = DESKTOP.width / 2;
const MID_Y = DESKTOP.height / 2;

describe("snapZoneFor", () => {
  it("arms nothing in the middle of the desktop", () => {
    expect(zone(MID_X, MID_Y)).toBeNull();
  });

  it("arms nothing for a window's edge that the pointer is not at", () => {
    // The Windows 11 rule: a wide window whose left edge grazes the desktop's
    // arms nothing while the cursor is still out in the middle.
    expect(zone(400, MID_Y)).toBeNull();
  });

  it("arms the left half with the pointer at the left edge", () => {
    expect(zone(2, MID_Y)).toBe("left");
    expect(zone(EDGE_DISTANCE, MID_Y)).toBe("left");
  });

  it("arms the right half with the pointer at the right edge", () => {
    expect(zone(DESKTOP.width - 2, MID_Y)).toBe("right");
    expect(zone(DESKTOP.width - EDGE_DISTANCE, MID_Y)).toBe("right");
  });

  it("maximises with the pointer at the top edge", () => {
    expect(zone(MID_X, 2)).toBe("top");
    expect(zone(MID_X, EDGE_DISTANCE)).toBe("top");
  });

  it("arms nothing just inside an edge band", () => {
    expect(zone(EDGE_DISTANCE + 1, MID_Y)).toBeNull();
    expect(zone(DESKTOP.width - EDGE_DISTANCE - 1, MID_Y)).toBeNull();
    expect(zone(MID_X, EDGE_DISTANCE + 1)).toBeNull();
  });

  it("arms a quarter in each corner", () => {
    expect(zone(2, 2)).toBe("top-left");
    expect(zone(DESKTOP.width - 2, 2)).toBe("top-right");
    expect(zone(2, DESKTOP.height - 2)).toBe("bottom-left");
    expect(zone(DESKTOP.width - 2, DESKTOP.height - 2)).toBe("bottom-right");
  });

  it("uses a corner region larger than the edge band", () => {
    // Well past the edge band in both axes, but still in the corner region.
    const inset = CORNER_DISTANCE - 2;
    expect(inset).toBeGreaterThan(EDGE_DISTANCE);
    expect(zone(inset, inset)).toBe("top-left");
    expect(zone(DESKTOP.width - inset, DESKTOP.height - inset)).toBe("bottom-right");
    // Just outside it, the same pointer arms nothing at all.
    expect(zone(CORNER_DISTANCE + 1, CORNER_DISTANCE + 1)).toBeNull();
  });

  it("prefers the corner over the edge where the two overlap", () => {
    // At the very left edge but level with the top corner region: a quarter,
    // not the left half.
    expect(zone(2, CORNER_DISTANCE - 2)).toBe("top-left");
    expect(zone(2, DESKTOP.height - CORNER_DISTANCE + 2)).toBe("bottom-left");
    // And at the top edge but level with the right corner region.
    expect(zone(DESKTOP.width - CORNER_DISTANCE + 2, 2)).toBe("top-right");
  });

  it("arms nothing at the bottom edge alone: that is not a Windows gesture", () => {
    expect(zone(MID_X, DESKTOP.height - 2)).toBeNull();
    expect(zone(MID_X, DESKTOP.height)).toBeNull();
  });

  it("arms nothing while snapping is suspended", () => {
    expect(zone(2, 2, null, true)).toBeNull();
    expect(zone(2, 2, "top-left", true)).toBeNull();
    expect(zone(2, MID_Y, "left", true)).toBeNull();
  });

  it("holds an armed zone until the pointer is clearly away from the edge", () => {
    // Just past the arming distance: hysteresis keeps it, so the preview does
    // not flicker while the pointer jitters on the boundary.
    expect(zone(EDGE_DISTANCE + 2, MID_Y)).toBeNull();
    expect(zone(EDGE_DISTANCE + 2, MID_Y, "left")).toBe("left");
    expect(zone(EDGE_DISTANCE + RELEASE_DISTANCE, MID_Y, "left")).toBe("left");
    // Well past it: released.
    expect(zone(EDGE_DISTANCE + RELEASE_DISTANCE + 1, MID_Y, "left")).toBeNull();
  });

  it("holds an armed corner with the same widened reach", () => {
    expect(zone(CORNER_DISTANCE + 2, CORNER_DISTANCE + 2)).toBeNull();
    expect(zone(CORNER_DISTANCE + 2, CORNER_DISTANCE + 2, "top-left")).toBe("top-left");
    expect(
      zone(CORNER_DISTANCE + RELEASE_DISTANCE + 1, CORNER_DISTANCE + 2, "top-left"),
    ).toBeNull();
  });

  it("does not widen reach to other edges when a zone is armed", () => {
    // With "left" armed, the right edge gets no hysteresis of its own.
    const justOutside = DESKTOP.width - EDGE_DISTANCE - 4;
    expect(zone(justOutside, MID_Y, "left")).toBeNull();
    expect(zone(justOutside, MID_Y, "right")).toBe("right");
  });

  it("arms nothing against a desktop it cannot measure", () => {
    expect(
      snapZoneFor({
        pointer: { x: 0, y: 0 },
        desktop: { width: 0, height: 0 },
        current: null,
        suspended: false,
      }),
    ).toBeNull();
  });
});

describe("snapBox", () => {
  it("halves the desktop for the left and right zones", () => {
    expect(snapBox("left", DESKTOP)).toEqual({ x: 0, y: 0, width: 500, height: 800 });
    expect(snapBox("right", DESKTOP)).toEqual({ x: 500, y: 0, width: 500, height: 800 });
  });

  it("fills the desktop for the top zone", () => {
    expect(snapBox("top", DESKTOP)).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
  });

  it("quarters the desktop for the corners", () => {
    expect(snapBox("top-left", DESKTOP)).toEqual({ x: 0, y: 0, width: 500, height: 400 });
    expect(snapBox("top-right", DESKTOP)).toEqual({ x: 500, y: 0, width: 500, height: 400 });
    expect(snapBox("bottom-left", DESKTOP)).toEqual({ x: 0, y: 400, width: 500, height: 400 });
    expect(snapBox("bottom-right", DESKTOP)).toEqual({ x: 500, y: 400, width: 500, height: 400 });
  });

  it("covers the desktop exactly with an odd width", () => {
    const odd = { width: 1001, height: 801 };
    const left = snapBox("left", odd);
    const rightHalf = snapBox("right", odd);
    expect(left.width + rightHalf.width).toBe(odd.width);
    expect(rightHalf.x).toBe(left.width);
    const topLeft = snapBox("top-left", odd);
    const bottomLeft = snapBox("bottom-left", odd);
    expect(topLeft.height + bottomLeft.height).toBe(odd.height);
  });
});
