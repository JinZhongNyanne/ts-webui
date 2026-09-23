import type { Box, DesktopSize } from "./box";
import { snapBox, type SnapZone } from "./snap";
import { layoutZoneBox, SNAP_LAYOUTS } from "./layouts";
import type { WindowStates } from "./windowState";

/**
 * Where a window goes when the desktop itself changes size.
 *
 * dockview leaves a floating window where its anchor put it — the desktop
 * moves `position` anchors every window top-left — so growing the browser
 * detached a window from the right or bottom edge it had been sitting on,
 * left a snapped half covering less than half, and left a maximised window
 * short of the corner. The rules here keep each window in the same place
 * *relative to the desktop* instead:
 *
 * - A window sitting exactly in a snap region (maximised, a half, a quarter,
 *   a Snap Layouts zone) is put in that same region at the new size.
 * - An edge on the desktop's edge, or on a seam with a neighbouring window,
 *   moves in proportion to the desktop, so a tiled layout stays tiled.
 * - A window with no edge held either way keeps its size and, on each axis,
 *   the same share of the free space on either side of it.
 *
 * Pure and DOM-free, like `snap.ts` and `layouts.ts`.
 */

const SNAP_ZONES: readonly SnapZone[] = [
  "top",
  "left",
  "right",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

/** Every snap region, as the box it takes on a desktop of a given size. */
const REGIONS: readonly ((desktop: DesktopSize) => Box)[] = [
  ...SNAP_ZONES.map((zone) => (desktop: DesktopSize) => snapBox(zone, desktop)),
  ...SNAP_LAYOUTS.flatMap((layout) =>
    layout.zones.map((zone) => (desktop: DesktopSize) => layoutZoneBox(zone, desktop)),
  ),
];

function sameBox(a: Box, b: Box): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * One axis of a free window: the same share of the slack before it.
 *
 * A window that did not fit the old desktop on this axis, or that hung off
 * its near edge, has no meaningful share and goes to the near edge, which is
 * where its title bar is reachable.
 */
function refitOffset(offset: number, extent: number, from: number, to: number): number {
  const slackBefore = from - extent;
  const slackAfter = Math.max(0, to - extent);
  if (slackBefore <= 0) return 0;
  const share = Math.min(Math.max(offset / slackBefore, 0), 1);
  return Math.round(share * slackAfter);
}

/** `box`, measured on a desktop of size `from`, moved onto one of size `to`. */
export function refitBox(box: Box, from: DesktopSize, to: DesktopSize): Box {
  const [moved] = refitBoxes([box], from, to);
  return moved ?? box;
}

/** One axis of a box, as the two edges the rules below talk about. */
interface Span {
  readonly start: number;
  readonly end: number;
}

type Axis = "x" | "y";

function spanOf(box: Box, axis: Axis): Span {
  return axis === "x"
    ? { start: box.x, end: box.x + box.width }
    : { start: box.y, end: box.y + box.height };
}

/** Whether two spans share some length, not just a point. */
function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Whether an edge of `box` is held in place by something: the desktop's own
 * edge, or the opposite edge of a window it sits against — the two windows
 * meeting there and overlapping along it, which is what a tiled layout's seam
 * is. Merely lining up with a window elsewhere on the desktop is not a seam.
 */
function attached(
  box: Box,
  others: readonly Box[],
  axis: Axis,
  edge: "start" | "end",
  size: number,
): boolean {
  const own = spanOf(box, axis);
  const value = own[edge];
  if (value === (edge === "start" ? 0 : size)) return true;
  const across: Axis = axis === "x" ? "y" : "x";
  return others.some((other) => {
    if (!overlaps(spanOf(other, across), spanOf(box, across))) return false;
    return spanOf(other, axis)[edge === "start" ? "end" : "start"] === value;
  });
}

/**
 * Every window, measured on a desktop of size `from`, moved onto one of size
 * `to` — as a set, because whether a window's edge is held in place depends
 * on its neighbours.
 *
 * - A window exactly in a snap region takes that region at the new size.
 * - On each axis, an *attached* edge (see `attached`) moves in proportion to
 *   the desktop. With both edges attached the window stretches, so a tiled
 *   layout stays tiled; with one, it keeps its size and follows that edge.
 * - A window with neither edge attached keeps its share of the free space.
 *
 * An edge value is mapped the same way wherever it appears, and a snap
 * region's edges are mapped to exactly where that region lands, so windows
 * meeting on a seam still meet after the move.
 */
export function refitBoxes(boxes: readonly Box[], from: DesktopSize, to: DesktopSize): Box[] {
  const regions = boxes.map((box) => REGIONS.find((regionAt) => sameBox(regionAt(from), box)));
  const edges = { x: new Map<number, number>(), y: new Map<number, number>() };
  boxes.forEach((box, i) => {
    const region = regions[i];
    if (!region) return;
    const moved = region(to);
    for (const axis of ["x", "y"] as const) {
      const before = spanOf(box, axis);
      const after = spanOf(moved, axis);
      edges[axis].set(before.start, after.start);
      edges[axis].set(before.end, after.end);
    }
  });
  const scale = (axis: Axis, value: number): number => {
    const known = edges[axis].get(value);
    if (known !== undefined) return known;
    const [before, after] = axis === "x" ? [from.width, to.width] : [from.height, to.height];
    if (value <= 0) return 0;
    if (value >= before) return after;
    return Math.round((value * after) / before);
  };

  return boxes.map((box, i) => {
    const region = regions[i];
    if (region) return region(to);
    const others = boxes.filter((_, j) => j !== i);
    const fit = (axis: Axis): Span => {
      const span = spanOf(box, axis);
      const extent = span.end - span.start;
      const [size, next] = axis === "x" ? [from.width, to.width] : [from.height, to.height];
      const near = attached(box, others, axis, "start", size);
      const far = attached(box, others, axis, "end", size);
      if (near && far) return { start: scale(axis, span.start), end: scale(axis, span.end) };
      if (near) {
        const start = scale(axis, span.start);
        return { start, end: start + extent };
      }
      if (far) {
        const start = Math.max(0, scale(axis, span.end) - extent);
        return { start, end: start + extent };
      }
      const start = refitOffset(span.start, extent, size, next);
      return { start, end: start + extent };
    };
    const x = fit("x");
    const y = fit("y");
    return { x: x.start, y: y.start, width: x.end - x.start, height: y.end - y.start };
  });
}

/**
 * The same states, with every maximised window's restore box refitted too, so
 * un-maximising after a resize puts the window back in the matching place.
 * Returns the map it was given when there is nothing to refit.
 */
export function refitStates(
  states: WindowStates,
  from: DesktopSize,
  to: DesktopSize,
): WindowStates {
  const maximized = Object.entries(states).filter(([, state]) => state.restore !== null);
  if (maximized.length === 0) return states;
  const next = { ...states };
  for (const [id, state] of maximized) {
    next[id] = { ...state, restore: refitBox(state.restore as Box, from, to) };
  }
  return next;
}
