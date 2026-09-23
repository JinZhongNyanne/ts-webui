import { describe, expect, it } from "vitest";
import type { Box, DesktopSize } from "./box";
import { dragSnapFor, NO_DRAG_SNAP, type DragSnapInput } from "./dragSnap";
import { snapBox } from "./snap";
import { windowSnapFor } from "./windowSnap";

const DESKTOP: DesktopSize = { width: 1200, height: 800 };
/** A neighbour on the left, which a window dragged beside it can abut. */
const LEFT: Box = { x: 0, y: 100, width: 400, height: 400 };
/** A window dragged about the middle of the desktop, 5px off LEFT's right edge. */
const NEAR_LEFT: Box = { x: 405, y: 100, width: 300, height: 400 };
/** Open desktop, nowhere near a window or an edge. */
const MIDDLE = { x: 600, y: 400 };

/** Both modes on, nothing held, pointer mid-desktop: override what each test is about. */
function input(over: Partial<DragSnapInput> = {}): DragSnapInput {
  return {
    pointer: MIDDLE,
    box: NEAR_LEFT,
    others: [LEFT],
    desktop: DESKTOP,
    toEdges: true,
    toWindows: true,
    suspended: false,
    holdTop: false,
    current: NO_DRAG_SNAP,
    ...over,
  };
}

describe("dragSnapFor", () => {
  it("arms nothing in open desktop", () => {
    // 200px clear of LEFT on one axis and 150px out of line with it on the other.
    const snap = dragSnapFor(input({ box: { ...NEAR_LEFT, x: 600, y: 250 } }));
    expect(snap).toEqual(NO_DRAG_SNAP);
  });

  it("arms the zone the pointer is at, promising that zone's box", () => {
    const snap = dragSnapFor(input({ pointer: { x: 5, y: 400 }, others: [] }));
    expect(snap.zone).toBe("left");
    expect(snap.window).toBeNull();
    expect(snap.target).toBe("zone:left");
    expect(snap.box).toEqual(snapBox("left", DESKTOP));
  });

  it("arms a window snap, promising the box the window will be moved into", () => {
    const snap = dragSnapFor(input());
    const expected = windowSnapFor({
      box: NEAR_LEFT,
      others: [LEFT],
      current: null,
      suspended: false,
      desktop: DESKTOP,
    });
    expect(snap.zone).toBeNull();
    expect(snap.window).toEqual(expected);
    expect(snap.target).toBe(`window:${expected?.key}`);
  });

  // A plain abut with no gap to fill used to promise nothing, so the window
  // jumped into line with no shadow at all. The shadow is now the snapped box.
  it("promises the snapped box for an abut that fills nothing", () => {
    // Small enough that neither the pocket beside it nor the column it stands
    // in is within twice its own size, so there is nothing to fill.
    const narrow: Box = { x: 405, y: 100, width: 200, height: 300 };
    const snap = dragSnapFor(input({ box: narrow }));
    expect(snap.window?.fill).toBeNull();
    expect(snap.box).toEqual({ ...narrow, x: 400 });
  });

  it("promises the filled box when the abut fills a gap", () => {
    const right: Box = { x: 800, y: 100, width: 400, height: 400 };
    const snap = dragSnapFor(input({ others: [LEFT, right] }));
    expect(snap.window?.fill).not.toBeNull();
    expect(snap.box).toEqual(snap.window?.fill);
  });

  // The zone is the bigger, more deliberate gesture; see the module's note.
  it("lets a screen-edge zone win over a window snap in the same frame", () => {
    const snap = dragSnapFor(input({ pointer: { x: 5, y: 400 } }));
    expect(snap.zone).toBe("left");
    expect(snap.window).toBeNull();
  });

  it("offers no zone while screen-edge snapping is off", () => {
    const snap = dragSnapFor(input({ pointer: { x: 5, y: 400 }, toEdges: false }));
    expect(snap.zone).toBeNull();
    // …and the window snap it would have beaten is free to act.
    expect(snap.window).not.toBeNull();
  });

  it("offers no window snap while window-to-window snapping is off", () => {
    const snap = dragSnapFor(input({ toWindows: false }));
    expect(snap).toEqual(NO_DRAG_SNAP);
  });

  it("offers no zone for a drag whose pointer it has not seen", () => {
    const snap = dragSnapFor(input({ pointer: null, others: [] }));
    expect(snap.zone).toBeNull();
  });

  it("offers nothing at all under the free-drag modifier", () => {
    const snap = dragSnapFor(input({ pointer: { x: 5, y: 400 }, suspended: true }));
    expect(snap).toEqual(NO_DRAG_SNAP);
  });

  // The Snap Layouts flyout hangs from the top edge; reaching down into it
  // takes the pointer out of the edge band, and must not disarm the top.
  it("holds the top zone while the caller says the pointer is over the flyout", () => {
    const snap = dragSnapFor(input({ holdTop: true }));
    expect(snap.zone).toBe("top");
    expect(snap.box).toEqual(snapBox("top", DESKTOP));
  });

  it("keeps an armed zone a little past its band, through the previous frame", () => {
    const armed = dragSnapFor(input({ pointer: { x: 5, y: 400 }, others: [] }));
    const outside = { x: 30, y: 400 };
    expect(dragSnapFor(input({ pointer: outside, others: [] })).zone).toBeNull();
    expect(dragSnapFor(input({ pointer: outside, others: [], current: armed })).zone).toBe("left");
  });

  it("keeps a window snap a little past its reach, through the previous frame", () => {
    // Off LEFT's top by 50px, so only the horizontal abut is ever in reach.
    const start: Box = { ...NEAR_LEFT, y: 150 };
    const held = dragSnapFor(input({ box: start }));
    expect(held.window).not.toBeNull();
    const further: Box = { ...start, x: 420 };
    expect(dragSnapFor(input({ box: further })).window).toBeNull();
    expect(dragSnapFor(input({ box: further, current: held })).window).not.toBeNull();
  });
});
