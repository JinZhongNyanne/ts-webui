import { describe, expect, it } from "vitest";
import { MIN_WINDOW_EXTENT, type Box } from "./box";
import { resizeSnapFor, type ResizeSnapInput } from "./resizeSnap";
import { WINDOW_SNAP_DISTANCE } from "./windowSnap";

/**
 * Where a resize would snap: the dragged edges only, each to the nearest edge in
 * reach. The desktop is 1000x600, and every case states which switches are on.
 */
const DESKTOP = { width: 1000, height: 600 };

/** The dragged window: 488 wide, so its right edge sits 12px short of x=500. */
const DRAGGED: Box = { x: 0, y: 100, width: 488, height: 300 };

/** A neighbour whose left edge is at x=500 and which lies beside `DRAGGED`. */
const BESIDE: Box = { x: 500, y: 50, width: 300, height: 400 };

const snap = (input: Partial<ResizeSnapInput>) =>
  resizeSnapFor({
    box: DRAGGED,
    edges: ["right"],
    seams: [],
    others: [BESIDE],
    desktop: DESKTOP,
    toWindows: true,
    toEdges: false,
    ...input,
  });

describe("resizeSnapFor", () => {
  it("lands a dragged right edge on the left edge of the window beside it", () => {
    expect(snap({})).toEqual({ ...DRAGGED, width: 500 });
  });

  it("reaches exactly as far as a window drag does, and no further", () => {
    const at = (right: number) => snap({ box: { ...DRAGGED, width: right } });
    expect(at(500 - WINDOW_SNAP_DISTANCE)).toEqual({ ...DRAGGED, width: 500 });
    expect(at(500 + WINDOW_SNAP_DISTANCE)).toEqual({ ...DRAGGED, width: 500 });
    expect(at(500 - WINDOW_SNAP_DISTANCE - 1)).toBeNull();
  });

  it("returns nothing when no edge is in reach, so dockview's box is left alone", () => {
    expect(snap({ box: { ...DRAGGED, width: 400 } })).toBeNull();
  });

  it("only abuts a window it actually lies beside", () => {
    // Same left edge at x=500, but entirely below the dragged window: there is
    // no shared border to press against.
    const below: Box = { x: 500, y: 450, width: 300, height: 100 };
    expect(snap({ others: [below] })).toBeNull();
  });

  it("lines a right edge up with another window's right edge, beside it or not", () => {
    // A column: the window above ends at x=495, and lining up with it needs no
    // overlap — the boxes cannot overlap when they are one above the other.
    const above: Box = { x: 100, y: 420, width: 395, height: 100 };
    expect(snap({ others: [above] })).toEqual({ ...DRAGGED, width: 495 });
  });

  it("takes the nearest of several targets in reach", () => {
    const far: Box = { x: 498, y: 50, width: 100, height: 100 };
    const near: Box = { x: 491, y: 150, width: 100, height: 100 };
    expect(snap({ others: [far, near] })).toEqual({ ...DRAGGED, width: 491 });
  });

  it("breaks an exact tie in favour of the window offered first", () => {
    const first: Box = { x: 494, y: 150, width: 100, height: 100 };
    const second: Box = { x: 482, y: 250, width: 100, height: 100 };
    expect(snap({ others: [first, second] })).toEqual({ ...DRAGGED, width: 494 });
    expect(snap({ others: [second, first] })).toEqual({ ...DRAGGED, width: 482 });
  });

  it("moves a dragged left edge and keeps the right edge where it was", () => {
    const box: Box = { x: 508, y: 100, width: 300, height: 300 };
    const left: Box = { x: 0, y: 0, width: 500, height: 600 };
    expect(snap({ box, edges: ["left"], others: [left] })).toEqual({
      x: 500,
      y: 100,
      width: 308,
      height: 300,
    });
  });

  it("snaps the two axes of a corner drag independently", () => {
    const box: Box = { x: 0, y: 100, width: 492, height: 494 };
    expect(snap({ box, edges: ["bottom", "right"], toEdges: true })).toEqual({
      x: 0,
      y: 100,
      width: 500,
      height: 500,
    });
  });

  it("snaps one axis of a corner drag when only that one is in reach", () => {
    const box: Box = { x: 0, y: 100, width: 492, height: 300 };
    expect(snap({ box, edges: ["bottom", "right"], toEdges: true })).toEqual({
      ...box,
      width: 500,
    });
  });

  it("never moves an edge that is not being dragged", () => {
    // The left edge sits 4px from the desktop's edge, well in reach, but the
    // user is dragging the right edge and nothing else.
    const box: Box = { x: 4, y: 100, width: 300, height: 300 };
    expect(snap({ box, others: [], toEdges: true })).toBeNull();
  });

  it("leaves an edge on a seam to the seam, and still snaps the other one", () => {
    const box: Box = { x: 0, y: 100, width: 492, height: 494 };
    expect(snap({ box, edges: ["bottom", "right"], seams: ["right"], toEdges: true })).toEqual({
      ...box,
      height: 500,
    });
    expect(snap({ box, edges: ["right"], seams: ["right"], toEdges: true })).toBeNull();
  });

  it("snaps to the desktop's own edges only when screen-edge snapping is on", () => {
    const box: Box = { x: 0, y: 100, width: 994, height: 300 };
    expect(snap({ box, others: [], toEdges: false })).toBeNull();
    expect(snap({ box, others: [], toEdges: true })).toEqual({ ...box, width: 1000 });
  });

  it("snaps a top edge to the top of the desktop", () => {
    const box: Box = { x: 0, y: 9, width: 300, height: 300 };
    expect(snap({ box, edges: ["top"], others: [], toEdges: true })).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 309,
    });
  });

  it("snaps to other windows only when window-to-window snapping is on", () => {
    expect(snap({ toWindows: false })).toBeNull();
  });

  it("does nothing with both switches off", () => {
    expect(snap({ toWindows: false, toEdges: false, desktop: DESKTOP })).toBeNull();
  });

  it("refuses a target that would leave the window under the minimum", () => {
    const box: Box = { x: 0, y: 100, width: MIN_WINDOW_EXTENT + 4, height: 300 };
    const tight: Box = { x: MIN_WINDOW_EXTENT - 4, y: 0, width: 300, height: 600 };
    expect(snap({ box, others: [tight] })).toBeNull();
  });

  it("refuses a target outside the desktop", () => {
    // A neighbour hanging off the right-hand edge, whose right edge is 4px past
    // it: lining up with that would push the window off the desktop.
    const box: Box = { x: 600, y: 100, width: 398, height: 300 };
    const hanging: Box = { x: 700, y: 450, width: 304, height: 100 };
    expect(snap({ box, others: [hanging] })).toBeNull();
  });

  it("still snaps to windows when the desktop cannot be measured", () => {
    expect(snap({ desktop: null, toEdges: true })).toEqual({ ...DRAGGED, width: 500 });
  });
});
