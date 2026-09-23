import { describe, expect, it } from "vitest";
import { MIN_WINDOW_EXTENT, type Box } from "./box";
import {
  ADJACENT_TOLERANCE,
  clampToDesktop,
  clampToLimits,
  followResize,
  linksFor,
  resizeEdgesOf,
  seamLimitsFor,
  type Sibling,
} from "./snapGroup";

/**
 * Two windows filling a 1000x600 desktop as a pair of Aero halves: the seam
 * between them is at x=500, which is the geometry every case below starts from.
 */
const LEFT: Box = { x: 0, y: 0, width: 500, height: 600 };
const RIGHT: Sibling = { id: "right", box: { x: 500, y: 0, width: 500, height: 600 } };

describe("resizeEdgesOf", () => {
  it("reads the one edge a side handle drags", () => {
    expect(resizeEdgesOf("dv-resize-handle-right")).toEqual(["right"]);
    expect(resizeEdgesOf("dv-resize-handle-top")).toEqual(["top"]);
  });

  it("reads both edges a corner handle drags", () => {
    expect(resizeEdgesOf("dv-resize-handle-topleft")).toEqual(["top", "left"]);
    expect(resizeEdgesOf("dv-resize-handle-bottomright")).toEqual(["bottom", "right"]);
  });

  it("finds the handle among the other classes on the element", () => {
    expect(resizeEdgesOf("something dv-resize-handle-left dv-extra")).toEqual(["left"]);
  });

  it("drags nothing for a class that is not a resize handle", () => {
    expect(resizeEdgesOf("dv-resize-container")).toEqual([]);
    expect(resizeEdgesOf("dv-resize-handle-sideways")).toEqual([]);
    expect(resizeEdgesOf("")).toEqual([]);
  });
});

describe("linksFor", () => {
  it("links the neighbour whose left edge is flush with the dragged right edge", () => {
    expect(linksFor(LEFT, ["right"], [RIGHT])).toEqual([
      { id: "right", edge: "right", follows: "left" },
    ]);
  });

  it("leaves a neighbour on an edge that is not being dragged alone", () => {
    expect(linksFor(LEFT, ["bottom"], [RIGHT])).toEqual([]);
  });

  it("does not link a flush neighbour that does not overlap perpendicularly", () => {
    const below: Sibling = { id: "below", box: { x: 500, y: 700, width: 300, height: 200 } };
    expect(linksFor(LEFT, ["right"], [below])).toEqual([]);
  });

  it("does not link a neighbour that only meets at a corner", () => {
    // Its top edge is exactly the dragged window's bottom: zero overlap.
    const corner: Sibling = { id: "corner", box: { x: 500, y: 600, width: 300, height: 200 } };
    expect(linksFor(LEFT, ["right"], [corner])).toEqual([]);
  });

  it("links across two pixels of slack but not three", () => {
    const slack = (gap: number): Sibling => ({
      id: "gap",
      box: { ...RIGHT.box, x: 500 + gap },
    });
    expect(ADJACENT_TOLERANCE).toBe(2);
    expect(linksFor(LEFT, ["right"], [slack(2)])).toHaveLength(1);
    expect(linksFor(LEFT, ["right"], [slack(-2)])).toHaveLength(1);
    expect(linksFor(LEFT, ["right"], [slack(3)])).toEqual([]);
  });

  it("links on both axes for a corner drag", () => {
    const dragged: Box = { x: 200, y: 200, width: 300, height: 200 };
    const right: Sibling = { id: "r", box: { x: 500, y: 250, width: 200, height: 200 } };
    const below: Sibling = { id: "b", box: { x: 250, y: 400, width: 200, height: 150 } };
    // Grouped by dragged edge, in the order the handle names them.
    expect(linksFor(dragged, ["bottom", "right"], [right, below])).toEqual([
      { id: "b", edge: "bottom", follows: "top" },
      { id: "r", edge: "right", follows: "left" },
    ]);
  });

  it("links every neighbour stacked along the same edge", () => {
    const top: Sibling = { id: "t", box: { x: 500, y: 0, width: 300, height: 300 } };
    const bottom: Sibling = { id: "b", box: { x: 500, y: 300, width: 300, height: 300 } };
    expect(linksFor(LEFT, ["right"], [top, bottom]).map((l) => l.id)).toEqual(["t", "b"]);
  });
});

describe("followResize", () => {
  const links = linksFor(LEFT, ["right"], [RIGHT]);

  it("moves the followed neighbour's near edge and leaves its far edge alone", () => {
    const after: Box = { ...LEFT, width: 600 };
    expect(followResize(links, [RIGHT], after, MIN_WINDOW_EXTENT)).toEqual([
      { id: "right", box: { x: 600, y: 0, width: 400, height: 600 } },
    ]);
  });

  it("gives the space back when the dragged window shrinks", () => {
    const after: Box = { ...LEFT, width: 300 };
    expect(followResize(links, [RIGHT], after, MIN_WINDOW_EXTENT)).toEqual([
      { id: "right", box: { x: 300, y: 0, width: 700, height: 600 } },
    ]);
  });

  it("leaves the neighbour at exactly the minimum extent for a seam held at its limit", () => {
    // The drag itself is held back now, so the box `followResize` is given has
    // already been through `clampToLimits`: the seam it reads is the limit, and
    // the neighbour lands on the minimum by arithmetic rather than by clamping.
    const limits = seamLimitsFor(links, [RIGHT], MIN_WINDOW_EXTENT);
    const after = clampToLimits({ ...LEFT, width: 950 }, limits, MIN_WINDOW_EXTENT);
    expect(followResize(links, [RIGHT], after, MIN_WINDOW_EXTENT)).toEqual([
      {
        id: "right",
        box: { x: 1000 - MIN_WINDOW_EXTENT, y: 0, width: MIN_WINDOW_EXTENT, height: 600 },
      },
    ]);
  });

  it("leaves the neighbour's own neighbour untouched — A|B|C is one hop", () => {
    const b: Sibling = { id: "b", box: { x: 400, y: 0, width: 300, height: 600 } };
    const c: Sibling = { id: "c", box: { x: 700, y: 0, width: 300, height: 600 } };
    const a: Box = { x: 0, y: 0, width: 400, height: 600 };
    const moved = followResize(linksFor(a, ["right"], [b, c]), [b, c], { ...a, width: 500 }, 160);
    expect(moved).toEqual([{ id: "b", box: { x: 500, y: 0, width: 200, height: 600 } }]);
  });

  it("follows a dragged top edge by moving the neighbour's bottom edge", () => {
    const above: Sibling = { id: "a", box: { x: 0, y: 0, width: 500, height: 200 } };
    const dragged: Box = { x: 0, y: 200, width: 500, height: 400 };
    const after: Box = { x: 0, y: 300, width: 500, height: 300 };
    const moved = followResize(linksFor(dragged, ["top"], [above]), [above], after, 160);
    expect(moved).toEqual([{ id: "a", box: { x: 0, y: 0, width: 500, height: 300 } }]);
  });

  it("reports nothing when the seam did not actually move", () => {
    expect(followResize(links, [RIGHT], LEFT, MIN_WINDOW_EXTENT)).toEqual([]);
  });

  it("ignores a link whose sibling has since gone away", () => {
    expect(followResize(links, [], { ...LEFT, width: 600 }, MIN_WINDOW_EXTENT)).toEqual([]);
  });
});

describe("seamLimitsFor", () => {
  it("stops a dragged right edge where the neighbour reaches its minimum", () => {
    const links = linksFor(LEFT, ["right"], [RIGHT]);
    expect(seamLimitsFor(links, [RIGHT], MIN_WINDOW_EXTENT)).toEqual({
      right: { upper: 1000 - MIN_WINDOW_EXTENT },
    });
  });

  it("takes the tightest limit of several neighbours stacked along one edge", () => {
    const top: Sibling = { id: "t", box: { x: 500, y: 0, width: 300, height: 300 } };
    const bottom: Sibling = { id: "b", box: { x: 500, y: 300, width: 500, height: 300 } };
    const links = linksFor(LEFT, ["right"], [top, bottom]);
    // The shorter neighbour's far edge is at 800, so it binds first.
    expect(seamLimitsFor(links, [top, bottom], MIN_WINDOW_EXTENT)).toEqual({
      right: { upper: 800 - MIN_WINDOW_EXTENT },
    });
  });

  it("limits each axis of a corner drag independently", () => {
    const dragged: Box = { x: 200, y: 200, width: 300, height: 200 };
    const right: Sibling = { id: "r", box: { x: 500, y: 250, width: 200, height: 200 } };
    const below: Sibling = { id: "b", box: { x: 250, y: 400, width: 200, height: 250 } };
    const links = linksFor(dragged, ["bottom", "right"], [right, below]);
    expect(seamLimitsFor(links, [right, below], MIN_WINDOW_EXTENT)).toEqual({
      right: { upper: 700 - MIN_WINDOW_EXTENT },
      bottom: { upper: 650 - MIN_WINDOW_EXTENT },
    });
  });

  it("limits a dragged left edge from the near side instead", () => {
    const dragged: Box = { x: 500, y: 0, width: 500, height: 600 };
    const left: Sibling = { id: "l", box: { x: 0, y: 0, width: 500, height: 600 } };
    expect(seamLimitsFor(linksFor(dragged, ["left"], [left]), [left], MIN_WINDOW_EXTENT)).toEqual({
      left: { lower: MIN_WINDOW_EXTENT },
    });
  });

  it("limits a dragged top edge from the near side too", () => {
    const dragged: Box = { x: 0, y: 200, width: 500, height: 400 };
    const above: Sibling = { id: "a", box: { x: 0, y: 0, width: 500, height: 200 } };
    expect(seamLimitsFor(linksFor(dragged, ["top"], [above]), [above], MIN_WINDOW_EXTENT)).toEqual({
      top: { lower: MIN_WINDOW_EXTENT },
    });
  });

  // The seam is symmetric: pressed from the far side, the window being squeezed
  // is the dragged one itself, and nothing but its own minimum stands between it
  // and dockview's 20px floor. The rig caught exactly this — pressing the seam
  // between two halves hits the handle of whichever window is in front.
  it("stops the seam where the dragged window itself runs out of room", () => {
    const dragged: Box = { x: 500, y: 0, width: 500, height: 600 };
    const left: Sibling = { id: "l", box: { x: 0, y: 0, width: 500, height: 600 } };
    const links = linksFor(dragged, ["left"], [left]);
    expect(seamLimitsFor(links, [left], MIN_WINDOW_EXTENT, dragged)).toEqual({
      left: { lower: MIN_WINDOW_EXTENT, upper: 1000 - MIN_WINDOW_EXTENT },
    });
  });

  it("takes the tighter of the dragged window's minimum and its neighbours'", () => {
    const narrow: Box = { x: 0, y: 0, width: 300, height: 600 };
    const right: Sibling = { id: "r", box: { x: 300, y: 0, width: 700, height: 600 } };
    const links = linksFor(narrow, ["right"], [right]);
    expect(seamLimitsFor(links, [right], MIN_WINDOW_EXTENT, narrow)).toEqual({
      right: { upper: 1000 - MIN_WINDOW_EXTENT, lower: MIN_WINDOW_EXTENT },
    });
  });

  it("leaves an edge with nothing on its seam to dockview, own minimum or not", () => {
    // A plain resize keeps dockview's own floor: the snap group's minimum is a
    // rule about seams, and an edge that is not on one is not the group's to hold.
    const links = linksFor(LEFT, ["bottom", "right"], [RIGHT]);
    expect(seamLimitsFor(links, [RIGHT], MIN_WINDOW_EXTENT, LEFT)).toEqual({
      right: { upper: 1000 - MIN_WINDOW_EXTENT, lower: MIN_WINDOW_EXTENT },
    });
  });

  it("bounds nothing without links", () => {
    expect(seamLimitsFor([], [RIGHT], MIN_WINDOW_EXTENT)).toEqual({});
  });

  it("ignores a link whose sibling has since gone away", () => {
    expect(seamLimitsFor(linksFor(LEFT, ["right"], [RIGHT]), [], MIN_WINDOW_EXTENT)).toEqual({});
  });
});

describe("clampToLimits", () => {
  it("returns the very same box when nothing bounds it", () => {
    const box: Box = { x: 0, y: 0, width: 900, height: 600 };
    expect(clampToLimits(box, {}, MIN_WINDOW_EXTENT)).toBe(box);
  });

  it("returns the very same box for an edge that has not reached its limit", () => {
    const box: Box = { ...LEFT, width: 600 };
    expect(clampToLimits(box, { right: { upper: 840 } }, MIN_WINDOW_EXTENT)).toBe(box);
  });

  it("holds a growing right edge at the limit, leaving the near edge alone", () => {
    expect(
      clampToLimits({ ...LEFT, width: 950 }, { right: { upper: 840 } }, MIN_WINDOW_EXTENT),
    ).toEqual({ x: 0, y: 0, width: 840, height: 600 });
  });

  it("lets an edge shrink away from its limit freely", () => {
    const box: Box = { ...LEFT, width: 200 };
    expect(clampToLimits(box, { right: { upper: 840 } }, MIN_WINDOW_EXTENT)).toBe(box);
  });

  it("holds a left edge at its limit, keeping the far edge still", () => {
    expect(
      clampToLimits(
        { x: 50, y: 0, width: 950, height: 600 },
        { left: { lower: 160 } },
        MIN_WINDOW_EXTENT,
      ),
    ).toEqual({ x: 160, y: 0, width: 840, height: 600 });
  });

  it("holds a top edge at its limit, keeping the bottom still", () => {
    expect(
      clampToLimits(
        { x: 0, y: 100, width: 500, height: 500 },
        { top: { lower: 160 } },
        MIN_WINDOW_EXTENT,
      ),
    ).toEqual({ x: 0, y: 160, width: 500, height: 440 });
  });

  it("clamps each axis of a corner drag independently", () => {
    const asked: Box = { x: 200, y: 200, width: 400, height: 400 };
    expect(
      clampToLimits(asked, { right: { upper: 540 }, bottom: { upper: 490 } }, MIN_WINDOW_EXTENT),
    ).toEqual({
      x: 200,
      y: 200,
      width: 340,
      height: 290,
    });
  });

  it("clamps only the bounded axis of a corner drag, leaving the free one", () => {
    const asked: Box = { x: 200, y: 200, width: 400, height: 400 };
    expect(clampToLimits(asked, { right: { upper: 540 } }, MIN_WINDOW_EXTENT)).toEqual({
      x: 200,
      y: 200,
      width: 340,
      height: 400,
    });
  });

  it("never clamps the dragged window itself below the minimum extent", () => {
    // Only reachable from windows that already overlapped: the limit would ask
    // for a 100px window, and a window is never squeezed below the minimum.
    expect(
      clampToLimits({ x: 200, y: 0, width: 500, height: 600 }, { right: { upper: 300 } }, 160),
    ).toEqual({
      x: 200,
      y: 0,
      width: 160,
      height: 600,
    });
    expect(
      clampToLimits({ x: 100, y: 0, width: 400, height: 600 }, { left: { lower: 600 } }, 160),
    ).toEqual({
      x: 340,
      y: 0,
      width: 160,
      height: 600,
    });
  });
});

describe("clampToDesktop", () => {
  const desktop = { width: 1000, height: 600 };

  it("leaves a box that already fits", () => {
    const box: Box = { x: 10, y: 10, width: 100, height: 100 };
    expect(clampToDesktop(box, desktop)).toEqual(box);
  });

  it("pulls a box that hangs off the right edge back inside", () => {
    expect(clampToDesktop({ x: 950, y: 0, width: 200, height: 100 }, desktop)).toEqual({
      x: 800,
      y: 0,
      width: 200,
      height: 100,
    });
  });

  it("shrinks a box that is wider than the desktop", () => {
    expect(clampToDesktop({ x: -50, y: 0, width: 1200, height: 800 }, desktop)).toEqual({
      x: 0,
      y: 0,
      width: 1000,
      height: 600,
    });
  });
});

/**
 * A seam shared by more than two windows: A and B stacked on the left of a
 * 1000x600 desktop, C spanning both of them on the right, so that
 * `A.right === B.right === C.left` is one seam line rather than two.
 *
 *   +---------+---------+
 *   |    A    |         |
 *   +---------+    C    |
 *   |    B    |         |
 *   +---------+---------+
 */
const STACK_A: Box = { x: 0, y: 0, width: 500, height: 300 };
const STACK_B: Sibling = { id: "b", box: { x: 0, y: 300, width: 500, height: 300 } };
const STACK_C: Sibling = { id: "c", box: { x: 500, y: 0, width: 500, height: 600 } };

describe("a seam shared by more than two windows", () => {
  it("links the window on the same side of the seam as the dragged one", () => {
    expect(linksFor(STACK_A, ["right"], [STACK_B, STACK_C])).toEqual([
      { id: "c", edge: "right", follows: "left" },
      { id: "b", edge: "right", follows: "right" },
    ]);
  });

  it("moves both the same-side and the far-side window as the seam is dragged", () => {
    const links = linksFor(STACK_A, ["right"], [STACK_B, STACK_C]);
    const moved = followResize(links, [STACK_B, STACK_C], { ...STACK_A, width: 600 }, 160);
    expect(moved).toEqual([
      { id: "c", box: { x: 600, y: 0, width: 400, height: 600 } },
      { id: "b", box: { x: 0, y: 300, width: 600, height: 300 } },
    ]);
  });

  it("moves the window above when the lower one's edge is the one dragged", () => {
    const a: Sibling = { id: "a", box: STACK_A };
    const dragged = STACK_B.box;
    const links = linksFor(dragged, ["right"], [a, STACK_C]);
    const moved = followResize(links, [a, STACK_C], { ...dragged, width: 400 }, 160);
    expect(moved).toEqual([
      { id: "c", box: { x: 400, y: 0, width: 600, height: 600 } },
      { id: "a", box: { x: 0, y: 0, width: 400, height: 300 } },
    ]);
  });

  it("admits a window reachable only through a taller one on the same seam", () => {
    // Three stacked windows against one tall neighbour: the bottom one overlaps
    // neither of the others, but all three overlap C.
    const top: Box = { x: 0, y: 0, width: 500, height: 200 };
    const middle: Sibling = { id: "m", box: { x: 0, y: 200, width: 500, height: 200 } };
    const bottom: Sibling = { id: "l", box: { x: 0, y: 400, width: 500, height: 200 } };
    const links = linksFor(top, ["right"], [middle, bottom, STACK_C]);
    expect(links.map((l) => l.id)).toEqual(["c", "m", "l"]);
  });

  it("refuses a window that shares the seam coordinate but overlaps nothing on it", () => {
    // Its left edge is on the seam, but it is off below every window that is.
    const away: Sibling = { id: "away", box: { x: 500, y: 700, width: 300, height: 200 } };
    const links = linksFor(STACK_A, ["right"], [STACK_B, STACK_C, away]);
    expect(links.map((l) => l.id)).toEqual(["c", "b"]);
  });

  it("is still one hop for a row A|B|C, whichever seam is dragged", () => {
    // The A|B seam and the B|C seam are different lines, so dragging one never
    // reaches the window on the other: C keeps its box when A|B moves, and A
    // keeps its box when B|C moves.
    const a: Box = { x: 0, y: 0, width: 300, height: 600 };
    const b: Sibling = { id: "b", box: { x: 300, y: 0, width: 300, height: 600 } };
    const c: Sibling = { id: "c", box: { x: 600, y: 0, width: 400, height: 600 } };
    expect(linksFor(a, ["right"], [b, c]).map((l) => l.id)).toEqual(["b"]);
    expect(linksFor(b.box, ["right"], [{ id: "a", box: a }, c]).map((l) => l.id)).toEqual(["c"]);
  });

  it("takes the tightest limit over both sides of the seam", () => {
    const links = linksFor(STACK_A, ["right"], [STACK_B, STACK_C]);
    // Rightwards, C runs out at 1000 - 160; leftwards, B runs out at 0 + 160.
    expect(seamLimitsFor(links, [STACK_B, STACK_C], MIN_WINDOW_EXTENT)).toEqual({
      right: { upper: 1000 - MIN_WINDOW_EXTENT, lower: MIN_WINDOW_EXTENT },
    });
  });

  it("holds the seam at whichever of the two bounds the drag has reached", () => {
    const limits = seamLimitsFor(
      linksFor(STACK_A, ["right"], [STACK_B, STACK_C]),
      [STACK_B, STACK_C],
      MIN_WINDOW_EXTENT,
    );
    expect(clampToLimits({ ...STACK_A, width: 990 }, limits, MIN_WINDOW_EXTENT)).toEqual({
      ...STACK_A,
      width: 840,
    });
    expect(clampToLimits({ ...STACK_A, width: 20 }, limits, MIN_WINDOW_EXTENT)).toEqual({
      ...STACK_A,
      width: MIN_WINDOW_EXTENT,
    });
  });

  it("keeps the two seams of a corner drag independent", () => {
    // A corner drag of the stacked layout's A: the right seam carries B and C,
    // the bottom seam carries only B, and neither limit leaks into the other.
    const links = linksFor(STACK_A, ["bottom", "right"], [STACK_B, STACK_C]);
    expect(links).toEqual([
      { id: "b", edge: "bottom", follows: "top" },
      { id: "c", edge: "right", follows: "left" },
      { id: "b", edge: "right", follows: "right" },
    ]);
    expect(seamLimitsFor(links, [STACK_B, STACK_C], MIN_WINDOW_EXTENT)).toEqual({
      bottom: { upper: 600 - MIN_WINDOW_EXTENT },
      right: { upper: 1000 - MIN_WINDOW_EXTENT, lower: MIN_WINDOW_EXTENT },
    });
  });
});
