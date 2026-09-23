import { describe, expect, it } from "vitest";
import { MIN_WINDOW_EXTENT } from "./box";
import { RELEASE_DISTANCE } from "./snap";
import { FILL_MAX_GROW, WINDOW_SNAP_DISTANCE, windowSnapFor, type WindowSnap } from "./windowSnap";

/**
 * Window-to-window snapping: the dragged window's edges against the OTHER
 * floating windows', with no desktop edge involved.
 */

/** A window 200x100 whose top-left is (x, y). */
const win = (x: number, y: number, width = 200, height = 100) => ({ x, y, width, height });

/**
 * The desktop these cases happen on, deliberately roomy.
 *
 * Its size matters because an abut now looks for the far wall of the gap it
 * would fill, and the desktop's own edge is one: on a cramped desktop every
 * alignment below would also be a gap fill, which is a different question and
 * has its own block at the bottom of this file.
 */
const DESKTOP = { width: 2400, height: 2000 };

/**
 * The neighbour every case below snaps against: 200x100 at (900, 700).
 *
 * Far enough from all four desktop edges that no gap around it is within reach
 * of a fill, so the alignment cases stay about where a window is *moved*.
 */
const OTHER = win(900, 700);

const snap = (
  box: { x: number; y: number; width: number; height: number },
  others = [OTHER],
  current: WindowSnap | null = null,
  suspended = false,
  desktop = DESKTOP,
) => windowSnapFor({ box, others, current, suspended, desktop });

describe("windowSnapFor", () => {
  it("leaves a window nowhere near another one alone", () => {
    expect(snap(win(50, 50))).toBeNull();
  });

  it("leaves a window alone when there is nothing else on the desktop", () => {
    expect(snap(win(400, 300 + WINDOW_SNAP_DISTANCE), [])).toBeNull();
  });

  it("abuts the dragged window's left edge to the neighbour's right", () => {
    // Level with the neighbour, a few pixels short of flush against it.
    const dragged = win(OTHER.x + OTHER.width - 4, OTHER.y);
    expect(snap(dragged)?.box).toEqual({ ...dragged, x: OTHER.x + OTHER.width });
    // Open desktop all the way to the right: no gap, so nothing to fill.
    expect(snap(dragged)?.fill).toBeNull();
  });

  it("abuts the dragged window's right edge to the neighbour's left", () => {
    const dragged = win(OTHER.x - 200 + 5, OTHER.y);
    expect(snap(dragged)?.box).toEqual({ ...dragged, x: OTHER.x - 200 });
    expect(snap(dragged)?.fill).toBeNull();
  });

  it("abuts below and above on the other axis too", () => {
    const below = win(OTHER.x, OTHER.y + OTHER.height - 3);
    expect(snap(below)?.box.y).toBe(OTHER.y + OTHER.height);
    const above = win(OTHER.x, OTHER.y - 100 + 3);
    expect(snap(above)?.box.y).toBe(OTHER.y - 100);
  });

  it("lines a window up with the neighbour's matching edges", () => {
    // A window well below the neighbour: nothing to abut, but the left edges
    // line up, which is how a column of windows is built.
    const dragged = win(OTHER.x + 6, OTHER.y + 400);
    expect(snap(dragged)?.box.x).toBe(OTHER.x);
    // ...and the right edges, for a window of the same width, from the other side.
    const wide = win(OTHER.x - 100 + 6, OTHER.y + 400, 300);
    expect(snap(wide)?.box.x).toBe(OTHER.x + OTHER.width - 300);
  });

  it("lines top and bottom edges up as well", () => {
    const dragged = win(OTHER.x + 600, OTHER.y + 5);
    expect(snap(dragged)?.box.y).toBe(OTHER.y);
  });

  it("snaps both axes at once, and resizes neither", () => {
    const dragged = win(OTHER.x + OTHER.width - 5, OTHER.y + 4);
    const snapped = snap(dragged);
    expect(snapped?.box).toEqual({
      x: OTHER.x + OTHER.width,
      y: OTHER.y,
      width: dragged.width,
      height: dragged.height,
    });
  });

  it("only abuts a neighbour it actually sits beside", () => {
    // Far below the neighbour: its right edge is no wall to press against, so
    // the near-flush left edge must not drag the window sideways.
    const dragged = win(OTHER.x + OTHER.width - 4, OTHER.y + 500);
    expect(snap(dragged)?.box.x ?? dragged.x).toBe(dragged.x);
  });

  it("reaches exactly as far as the snap distance and no further", () => {
    expect(snap(win(OTHER.x + WINDOW_SNAP_DISTANCE, OTHER.y + 400))?.box.x).toBe(OTHER.x);
    expect(snap(win(OTHER.x + WINDOW_SNAP_DISTANCE + 1, OTHER.y + 400))).toBeNull();
  });

  it("takes the nearest edge when several are in reach", () => {
    // Two neighbours in reach of the same edge, 2px and 6px away: the nearer wins.
    const near = win(301, 900);
    const far = win(309, 900);
    const dragged = win(303, 900);
    expect(
      windowSnapFor({
        box: dragged,
        others: [far, near],
        current: null,
        suspended: false,
        desktop: DESKTOP,
      })?.box.x,
    ).toBe(near.x);
  });

  it("breaks an exact tie the same way every frame", () => {
    // Equidistant neighbours: the first one the desktop lists wins, so the
    // window does not flip between them as the drag continues.
    const first = win(300, 900);
    const second = win(310, 900);
    const dragged = win(305, 900);
    const both = windowSnapFor({
      box: dragged,
      others: [first, second],
      current: null,
      suspended: false,
      desktop: DESKTOP,
    });
    expect(both?.box.x).toBe(first.x);
    expect(
      windowSnapFor({
        box: dragged,
        others: [second, first],
        current: null,
        suspended: false,
        desktop: DESKTOP,
      })?.box.x,
    ).toBe(second.x);
  });

  it("snaps nothing while the free-drag modifier is held", () => {
    const dragged = win(OTHER.x + OTHER.width - 4, OTHER.y);
    expect(snap(dragged, [OTHER], null, true)).toBeNull();
  });

  it("holds a snap a little past its reach, as the edge zones do", () => {
    const held = snap(win(OTHER.x + WINDOW_SNAP_DISTANCE, OTHER.y + 400));
    const further = win(OTHER.x + WINDOW_SNAP_DISTANCE + RELEASE_DISTANCE, OTHER.y + 400);
    expect(snap(further)).toBeNull();
    expect(snap(further, [OTHER], held ?? null)?.box.x).toBe(OTHER.x);
    const beyond = win(OTHER.x + WINDOW_SNAP_DISTANCE + RELEASE_DISTANCE + 1, OTHER.y + 400);
    expect(snap(beyond, [OTHER], held ?? null)).toBeNull();
  });

  it("names the alignment it chose, so the dwell can tell one from another", () => {
    const abutting = snap(win(OTHER.x + OTHER.width - 4, OTHER.y + 10))?.key;
    const aligned = snap(win(OTHER.x + 4, OTHER.y + 400))?.key;
    expect(abutting).toBeTruthy();
    expect(aligned).toBeTruthy();
    expect(abutting).not.toBe(aligned);
    // Stable: the same frame twice is the same key.
    expect(snap(win(OTHER.x + 4, OTHER.y + 400))?.key).toBe(aligned);
  });
});

/**
 * Gap filling: the resize half of the gesture, decided here and applied by the
 * caller on release.
 *
 * The geometry is easiest to read on a row of windows, so every case below
 * lines three boxes up at the same height and drags the middle one into the
 * space between the outer two.
 */
describe("windowSnapFor's gap fill", () => {
  const DESK = { width: 2400, height: 2000 };
  /** The neighbour the dragged window presses flush against, on its left. */
  const LEFT = win(100, 700);
  /** The dragged window's box a few pixels short of flush against `LEFT`. */
  const nearlyFlush = (width = 200, height = 100) =>
    win(LEFT.x + LEFT.width - 4, LEFT.y, width, height);
  const fillOf = (
    box: { x: number; y: number; width: number; height: number },
    others: readonly { x: number; y: number; width: number; height: number }[],
    desktop = DESK,
  ) => windowSnapFor({ box, others, current: null, suspended: false, desktop })?.fill ?? null;

  it("fills the gap between the neighbour it abuts and the desktop's edge", () => {
    // Only one window on the desktop and it is on the left, so the far wall of
    // the gap is the desktop's right edge, 300px away from a 200px window.
    const narrow = { width: LEFT.x + LEFT.width + 300, height: DESK.height };
    expect(fillOf(nearlyFlush(), [LEFT], narrow)).toEqual({
      x: LEFT.x + LEFT.width,
      y: LEFT.y,
      width: 300,
      height: 100,
    });
  });

  it("fills the gap between two neighbours", () => {
    const right = win(700, LEFT.y);
    expect(fillOf(nearlyFlush(), [LEFT, right])).toEqual({
      x: LEFT.x + LEFT.width,
      y: LEFT.y,
      width: right.x - (LEFT.x + LEFT.width),
      height: 100,
    });
  });

  it("shrinks a window too wide for the gap it was put in", () => {
    const right = win(560, LEFT.y);
    expect(fillOf(nearlyFlush(300), [LEFT, right])?.width).toBe(260);
  });

  it("refuses a gap too narrow to leave a window behind", () => {
    // Narrower than the smallest window anything on this desktop may be left
    // at, so the window keeps its size and merely abuts.
    const right = win(LEFT.x + LEFT.width + MIN_WINDOW_EXTENT - 1, LEFT.y);
    expect(fillOf(nearlyFlush(), [LEFT, right])).toBeNull();
  });

  it("refuses a gap it would have to grow too far to fill", () => {
    const tooFar = win(LEFT.x + LEFT.width + FILL_MAX_GROW * 200 + 1, LEFT.y);
    expect(fillOf(nearlyFlush(), [LEFT, tooFar])).toBeNull();
    // ...and takes the widest gap it will stretch to.
    const atTheLimit = win(LEFT.x + LEFT.width + FILL_MAX_GROW * 200, LEFT.y);
    expect(fillOf(nearlyFlush(), [LEFT, atTheLimit])?.width).toBe(FILL_MAX_GROW * 200);
  });

  it("refuses an axis a neighbour lies right across", () => {
    // A neighbour that begins before the dragged window and ends after it lies
    // on both sides at once, so neither wall counts it and the fill used to
    // grow straight across it. There is no pocket to fill here — the window is
    // sitting on top of another one — so the axis declines instead.
    const desk = { width: 700, height: 200 };
    const left = win(100, 50, 200, 100);
    const across = win(400, 0, 200, 200);
    // Flush against `left` horizontally, with `across` spanning the whole
    // height beside it: the vertical gap is walled by nothing but that window.
    expect(fillOf(win(left.x + left.width - 4, left.y, 200, 100), [left, across], desk)).toBeNull();
  });

  it("ignores a window that does not lie beside the gap", () => {
    // In the right place horizontally but hundreds of pixels lower: it walls
    // off nothing the dragged window would grow into, exactly as it offers no
    // edge to abut.
    const elsewhere = win(700, LEFT.y + 600);
    expect(fillOf(nearlyFlush(), [LEFT, elsewhere])).toBeNull();
  });

  /**
   * The pocket cases, which is where the gesture is really aimed: a window put
   * into a hole fills the hole, on both axes, and not merely on the axis whose
   * edge it happened to press against.
   *
   * These all abut on the horizontal axis and are left unsnapped vertically, so
   * the vertical growth on show is the pocket being filled and nothing else.
   */
  /** A tall neighbour on the left, whose own edges are out of vertical reach. */
  const TALL_LEFT = win(100, 650, 200, 300);
  /** Flush against `TALL_LEFT`, with no vertical alignment in reach. */
  const inPocket = (height = 100) => win(TALL_LEFT.x + TALL_LEFT.width - 4, 690, 200, height);

  it("fills the pocket vertically as well, not only the axis it abutted", () => {
    // The reported bug: flush on the horizontal axis, with a window above and
    // one below, and a strip of wallpaper left above it. Both strips go.
    const above = win(300, 400, 200, 210);
    const below = win(300, 810);
    const snapped = windowSnapFor({
      box: inPocket(),
      others: [TALL_LEFT, above, below],
      current: null,
      suspended: false,
      desktop: DESK,
    });
    expect(snapped?.key).toBe("x:abut-after@0");
    expect(snapped?.fill).toEqual({
      x: TALL_LEFT.x + TALL_LEFT.width,
      y: above.y + above.height,
      width: 200,
      height: below.y - (above.y + above.height),
    });
  });

  it("fills to the desktop's top and bottom when nothing is above or below", () => {
    // The desktop's own edges wall a pocket in exactly as another window does,
    // so a window abutting a tall neighbour on a short desktop fills its height.
    const short = { width: 2400, height: 700 };
    const tall = win(100, 50, 200, 600);
    const dragged = win(tall.x + tall.width - 4, 100, 200, 400);
    const snapped = windowSnapFor({
      box: dragged,
      others: [tall],
      current: null,
      suspended: false,
      desktop: short,
    });
    expect(snapped?.key).toBe("x:abut-after@0");
    expect(snapped?.fill).toEqual({ x: 300, y: 0, width: 200, height: short.height });
  });

  it("leaves the abutting edge on its neighbour and grows the other one", () => {
    // Abutting from the right this time: the window's right edge is already on
    // the neighbour's left and must stay there, so the fill runs leftwards.
    const right = win(700, 700);
    const wall = win(200, 700);
    const dragged = win(right.x - 200 + 5, right.y);
    const snapped = windowSnapFor({
      box: dragged,
      others: [right, wall],
      current: null,
      suspended: false,
      desktop: DESK,
    });
    expect(snapped?.box.x).toBe(right.x - 200);
    expect(snapped?.fill).toEqual({
      x: wall.x + wall.width,
      y: right.y,
      width: right.x - (wall.x + wall.width),
      height: 100,
    });
    // The edge that snapped has not moved off the neighbour it snapped to.
    expect((snapped?.fill?.x ?? 0) + (snapped?.fill?.width ?? 0)).toBe(right.x);
  });

  it("does not fill a window that abutted nothing, however walled in it is", () => {
    // The same pocket as the reported bug, but the window only lines its left
    // edge up with a column instead of pressing flush against anything. A fill
    // is an inference from an abut, so a drag that abutted nothing keeps its
    // size — otherwise every window dropped anywhere would inflate.
    const column = win(300, 200);
    const above = win(300, 400, 200, 210);
    const below = win(300, 810);
    const snapped = windowSnapFor({
      box: win(304, 690),
      others: [column, above, below],
      current: null,
      suspended: false,
      desktop: DESK,
    });
    expect(snapped?.box.x).toBe(column.x);
    expect(snapped?.key).not.toContain("abut");
    expect(snapped?.fill).toBeNull();
  });

  it("refuses a vertical gap it would have to grow too far to fill", () => {
    // One pixel past the cap on this axis alone, and the window keeps its
    // height: each axis is measured against its own extent.
    const above = win(300, 400, 200, 210);
    const tooFar = win(300, 811);
    const atTheLimit = win(300, 810);
    const fill = (below: ReturnType<typeof win>) =>
      windowSnapFor({
        box: inPocket(),
        others: [TALL_LEFT, above, below],
        current: null,
        suspended: false,
        desktop: DESK,
      })?.fill ?? null;
    expect(fill(atTheLimit)?.height).toBe(FILL_MAX_GROW * 100);
    expect(fill(tooFar)).toBeNull();
  });

  it("refuses a vertical gap too narrow to leave a window behind", () => {
    // A pocket shorter than the smallest window this desktop keeps: the window
    // would have to be squeezed below `MIN_WINDOW_EXTENT`, so it is not.
    const above = win(300, 400, 200, 220);
    const below = win(300, above.y + above.height + MIN_WINDOW_EXTENT - 10);
    const snapped = windowSnapFor({
      box: inPocket(),
      others: [TALL_LEFT, above, below],
      current: null,
      suspended: false,
      desktop: DESK,
    });
    expect(below.y - (above.y + above.height)).toBeLessThan(MIN_WINDOW_EXTENT);
    expect(snapped?.fill).toBeNull();
  });

  it("keeps a vertical fill out of the key as well", () => {
    // Same abut, same key, whether or not the neighbours leave a pocket around
    // it: a gap that opens or closes must not restart the dwell.
    const filling = windowSnapFor({
      box: inPocket(),
      others: [TALL_LEFT, win(300, 400, 200, 210), win(300, 810)],
      current: null,
      suspended: false,
      desktop: DESK,
    });
    const open = windowSnapFor({
      box: inPocket(),
      others: [TALL_LEFT],
      current: null,
      suspended: false,
      desktop: DESK,
    });
    expect(filling?.fill).not.toBeNull();
    expect(open?.fill).toBeNull();
    expect(filling?.key).toBe(open?.key);
  });

  it("never fills from a tidy-column alignment, only from an abut", () => {
    // Left edges lined up rather than pressed flush, with the same wall — and
    // the same gap — as the abutting cases above. Lining a column up is not a
    // request to be squeezed into the space beside it.
    const column = win(300, 700);
    const right = win(700, 1200);
    const dragged = win(column.x + 4, 1200);
    const snapped = windowSnapFor({
      box: dragged,
      others: [column, right],
      current: null,
      suspended: false,
      desktop: DESK,
    });
    expect(snapped?.box.x).toBe(column.x);
    expect(snapped?.fill).toBeNull();
  });

  it("names the same alignment whether or not it fills, so the dwell holds", () => {
    // A fill must never look like a new target: the gap changes as the other
    // windows are resized, and the half-second wait would start again with it.
    const filling = windowSnapFor({
      box: nearlyFlush(),
      others: [LEFT, win(700, LEFT.y)],
      current: null,
      suspended: false,
      desktop: DESK,
    });
    const open = windowSnapFor({
      box: nearlyFlush(),
      others: [LEFT, win(900, LEFT.y)],
      current: null,
      suspended: false,
      desktop: DESK,
    });
    expect(filling?.fill).not.toBeNull();
    expect(open?.fill).toBeNull();
    expect(filling?.key).toBe(open?.key);
  });
});
