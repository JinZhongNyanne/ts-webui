import { MIN_WINDOW_EXTENT, spansOverlap, type Box, type DesktopSize } from "./box";
import { RELEASE_DISTANCE } from "./snap";

/**
 * Window-to-window snapping: a dragged floating window's edges pulled into line
 * with the OTHER windows' edges. Nothing here knows about the desktop's edges —
 * that is `snap.ts`'s gesture, and the two are separate switches on the taskbar.
 *
 * Two kinds of alignment, because real desktops give both and they answer
 * different intentions:
 *
 * - **Abutting**, where the dragged window's left edge meets a neighbour's
 *   right (or its top meets a neighbour's bottom, and so on), so the two sit
 *   flush with no sliver of wallpaper between them. This is what "park these
 *   two side by side" means, and it only makes sense against a window the
 *   dragged one actually lies beside: pressing flush against the right edge of
 *   a window five hundred pixels further down aligns nothing a user can see, so
 *   an abut is offered only where the boxes overlap on the other axis.
 * - **Matching edges** — left to left, right to right, top to top, bottom to
 *   bottom — which is how a column or a row of windows is kept tidy. These are
 *   deliberately *not* gated on overlap: lining a window up with one above it is
 *   the whole point, and the boxes cannot overlap when it is.
 *
 * Centre alignment, which Figma-style guides also offer, is left out: the user
 * asked for edges, and a centre line is invisible on a desktop that draws no
 * guides.
 *
 * The two axes are decided independently, so a drag into the corner of a
 * neighbour can abut horizontally and line up vertically in the same frame.
 *
 * The snap itself only ever *moves* the window, but a window pressed flush
 * against a neighbour has usually been put *into* a pocket, and then there is a
 * second answer to give: the box that fills that pocket on both axes. It is
 * reported alongside,
 * never applied here, because dockview keeps the dragged window's size for
 * itself while the drag lasts — `Overlay.setupDrag` takes only a top-left back
 * from the transform hook. So the fill is shown as a preview and committed on
 * release, which is also how the screen-edge zones already behave, and means a
 * window never changes size under a hand that is still moving it.
 *
 * Pure and DOM-free, like `snap.ts`: the drag hook hands in the box it is about
 * to apply and the boxes of the other windows, and gets back the box to apply
 * instead.
 */

/**
 * How close two edges have to come before they pull together.
 *
 * Narrower than the screen-edge bands (24px and 72px), because these targets
 * are everywhere: on a busy desktop every window carries four of them, and a
 * generous reach would make a free drag feel sticky. Twelve pixels is the reach
 * the desktop's own edges had before they moved to the cursor, and it is enough
 * that two windows nudged together do go flush.
 */
export const WINDOW_SNAP_DISTANCE = 12;

/**
 * The most a gap fill will stretch a window, as a multiple of its own size.
 *
 * A gap fill is an inference — the user pressed one edge flush and we guess
 * they meant "put me between these" — so it has to stay recognisable as the
 * same window. Doubling is about as far as that holds: park a 300px window
 * against a neighbour with a 600px hole beside it and filling it is plainly
 * what was meant, whereas stretching it across a 900px hole is a maximise
 * nobody asked for, and the window keeps its size instead.
 *
 * Shrinking has no such limit: a window put in a hole smaller than itself
 * would otherwise overlap what walls the hole in, which is the one outcome the
 * gesture exists to avoid. It stops at `MIN_WINDOW_EXTENT` and declines below.
 */
export const FILL_MAX_GROW = 2;

/** Which way the window abutted on one axis, or `null` for no abut at all. */
type AbutSide = "after" | "before";

/**
 * The abut on each axis: what asks for a fill, and what pins an edge during it.
 *
 * An abut on *either* axis is what turns a drag into "put me between these", so
 * one is enough to fill both axes. On an axis that abutted, the abutting edge is
 * already flush and must not move, so that axis grows away from the neighbour
 * only; an axis that abutted nothing is free to grow both ways.
 */
export interface AbutSides {
  readonly x: AbutSide | null;
  readonly y: AbutSide | null;
}

/** A window-to-window snap: where the window goes, and which alignment did it. */
export interface WindowSnap {
  /** The dragged window's box, moved into line. Same size, always. */
  readonly box: Box;
  /**
   * The gap-filling box to commit when the window is let go, or `null`.
   *
   * Deliberately not folded into `box`: that one is applied every frame, and a
   * resize cannot be. This is the caller's to preview and to apply on release.
   */
  readonly fill: Box | null;
  /**
   * The alignments chosen, as `axis:name@index` parts joined by `|`.
   *
   * Two jobs, both of which need an alignment to be recognisable between
   * frames: the dwell in `snapDwell.ts` tells one target from another by it, and
   * the hysteresis below widens the reach of exactly the alignments that are
   * already holding.
   */
  readonly key: string;
}

export interface WindowSnapInput {
  /** The box the drag proposes this frame. */
  readonly box: Box;
  /**
   * The other visible floating windows. The dragged window is not among them,
   * and neither is a minimised one: an invisible window is nothing to line up
   * with. Order is the caller's, and decides ties.
   */
  readonly others: readonly Box[];
  /** The snap held on the previous frame, for hysteresis. */
  readonly current: WindowSnap | null;
  /** True while the user holds the modifier that drags freely. */
  readonly suspended: boolean;
  /**
   * The desktop the windows live on, whose edges also wall a gap in.
   *
   * The commonest gap of all has no second window in it: two columns, and the
   * dragged one pressed against the left neighbour with nothing but wallpaper
   * between it and the right-hand edge of the screen.
   */
  readonly desktop: DesktopSize;
}

/** One alignment on offer: where it would put the window's near edge. */
interface Candidate {
  /** `axis:name@index`; see `WindowSnap.key`. */
  readonly id: string;
  readonly value: number;
  readonly distance: number;
  /** Set only for the two abuts, because only an abut may fill a gap. */
  readonly abut: AbutSide | null;
}

/** Whether `id` is one of the alignments already holding the window. */
function heldAt(current: WindowSnap | null, id: string): boolean {
  return !!current && current.key.split("|").includes(id);
}

/**
 * The nearest alignment on one axis, or `null`.
 *
 * `start` and `extent` are the dragged window's near edge and its size on this
 * axis; `cross` is its span on the other one, which gates the abuts. Nearest
 * wins; an exact tie goes to whichever candidate was offered first, which is
 * abutting before matching edges and the desktop's own window order before
 * anything else. That order does not change mid-drag, so a window sitting
 * equidistant between two neighbours does not flip between them frame to frame.
 */
function nearestOn(
  axis: "x" | "y",
  start: number,
  extent: number,
  cross: readonly [number, number],
  others: readonly Box[],
  current: WindowSnap | null,
): Candidate | null {
  let best: Candidate | null = null;
  const offer = (
    name: string,
    index: number,
    value: number,
    abut: AbutSide | null = null,
  ): void => {
    const id = `${axis}:${name}@${index}`;
    const distance = Math.abs(value - start);
    const reach = WINDOW_SNAP_DISTANCE + (heldAt(current, id) ? RELEASE_DISTANCE : 0);
    if (distance > reach) return;
    if (best && best.distance <= distance) return;
    best = { id, value, distance, abut };
  };
  others.forEach((other, index) => {
    const near = axis === "x" ? other.x : other.y;
    const size = axis === "x" ? other.width : other.height;
    const otherCross: readonly [number, number] =
      axis === "x" ? [other.y, other.y + other.height] : [other.x, other.x + other.width];
    if (spansOverlap(cross[0], cross[1], otherCross[0], otherCross[1])) {
      offer("abut-after", index, near + size, "after");
      offer("abut-before", index, near - extent, "before");
    }
    offer("align-near", index, near);
    offer("align-far", index, near + size - extent);
  });
  return best;
}

/** A window's near edge and size on one axis, after a fill has had its say. */
interface Span {
  readonly start: number;
  readonly extent: number;
}

/**
 * The span a window being filled should take on one axis, or `null` to keep the
 * one it has.
 *
 * The pocket's walls are the nearest edges facing back at the window from either
 * side, whether another window's or the desktop's own. Only windows that overlap
 * on the *other* axis count, the same gate abutting itself uses, because a
 * window a few hundred pixels further down walls nothing off.
 *
 * `side` says which edge, if any, the snap has already pinned. An abut means the
 * window is flush against that wall, so that side is left exactly where the snap
 * put it and only the opposite edge moves — a fill must never lift a window off
 * the neighbour it was just pressed against. With no abut on this axis both
 * edges are free, which is how a window flush on one axis alone still ends up
 * filling the pocket it was dropped into on the other.
 *
 * A window closer than `MIN_WINDOW_EXTENT` is still a wall. Skipping it and
 * reaching for the next one along would grow the dragged window straight
 * through it, so a hole too small to leave a window in refuses the fill
 * instead — which is also the honest answer to "is there room here?".
 *
 * A window that already *overlaps* the dragged one counts as a wall from the
 * side it lies on, so the fill shrinks away from it or declines, rather than
 * growing over it. One lying across *both* sides is on no single side, and the
 * axis declines outright.
 */
function filledSpan(
  axis: "x" | "y",
  snapped: Box,
  others: readonly Box[],
  desktop: DesktopSize,
  side: AbutSide | null,
): Span | null {
  const start = axis === "x" ? snapped.x : snapped.y;
  const extent = axis === "x" ? snapped.width : snapped.height;
  const far = start + extent;
  const near = (box: Box): number => (axis === "x" ? box.x : box.y);
  const size = (box: Box): number => (axis === "x" ? box.width : box.height);
  const span = (box: Box): readonly [number, number] =>
    axis === "x" ? [box.y, box.y + box.height] : [box.x, box.x + box.width];
  const cross = span(snapped);
  const beside = others.filter((other) => {
    const otherCross = span(other);
    return spansOverlap(cross[0], cross[1], otherCross[0], otherCross[1]);
  });
  // A neighbour lying right across the window — beginning before its near edge
  // and ending after its far one — is on both sides at once, so neither wall
  // below would count it and the fill would grow straight over it. Nothing
  // here is a pocket: the window is on top of that neighbour already, and the
  // honest answer to "is there room?" is no, so the axis declines.
  const across = beside.some((other) => near(other) <= start && near(other) + size(other) >= far);
  if (across) return null;
  const edge = axis === "x" ? desktop.width : desktop.height;
  /** The nearest wall facing back at the window from beyond its far edge. */
  const after = beside.reduce(
    (nearest, other) => (near(other) >= start ? Math.min(nearest, near(other)) : nearest),
    edge,
  );
  /** The nearest wall facing back at it from before its near edge. */
  const before = beside.reduce((nearest, other) => {
    const back = near(other) + size(other);
    return back <= far ? Math.max(nearest, back) : nearest;
  }, 0);
  if (side === "after") return fillable(start, after - start, extent);
  if (side === "before") return fillable(before, far - before, extent);
  return fillable(before, after - before, extent);
}

/** `gap` as a span starting at `start`, if filling it is worth doing at all. */
function fillable(start: number, gap: number, extent: number): Span | null {
  if (gap === extent) return null;
  if (gap < MIN_WINDOW_EXTENT) return null;
  if (gap > FILL_MAX_GROW * extent) return null;
  return { start, extent: gap };
}

/**
 * The box a snapped window should be left in to fill the pocket it was put in,
 * or `null` when there is no pocket to fill.
 *
 * An abut on at least one axis is the whole precondition: pressing flush against
 * a wall is what says "put me between things", whereas lining edges up with a
 * window in another row is housekeeping, and a window merely let go in open
 * desktop has asked for nothing at all — inflating either to its surroundings
 * would be a resize nobody requested.
 *
 * Given that one abut, *both* axes are then measured and filled, because the
 * hole a window was dropped into has four sides and leaving a strip of wallpaper
 * along one of them is exactly the bug this rule replaced: an axis that abutted
 * nothing is still walled in by whatever lies above and below, and fills between
 * those walls. Each axis is measured independently, from the snapped box, and
 * each declines on its own terms, so a pocket that is a fill on one axis and too
 * wide on the other still grows the one it can.
 */
export function gapFillFor(
  snapped: Box,
  others: readonly Box[],
  desktop: DesktopSize,
  abuts: AbutSides,
): Box | null {
  if (!abuts.x && !abuts.y) return null;
  const horizontal = filledSpan("x", snapped, others, desktop, abuts.x);
  const vertical = filledSpan("y", snapped, others, desktop, abuts.y);
  if (!horizontal && !vertical) return null;
  return {
    x: horizontal?.start ?? snapped.x,
    y: vertical?.start ?? snapped.y,
    width: horizontal?.extent ?? snapped.width,
    height: vertical?.extent ?? snapped.height,
  };
}

/**
 * Where the dragged window should go to line up with its neighbours, or `null`
 * when it is not near any of them.
 */
export function windowSnapFor(input: WindowSnapInput): WindowSnap | null {
  if (input.suspended) return null;
  const { box, others, current, desktop } = input;
  if (others.length === 0) return null;
  const horizontal = nearestOn("x", box.x, box.width, [box.y, box.y + box.height], others, current);
  const vertical = nearestOn("y", box.y, box.height, [box.x, box.x + box.width], others, current);
  if (!horizontal && !vertical) return null;
  const snapped = { ...box, x: horizontal?.value ?? box.x, y: vertical?.value ?? box.y };
  return {
    box: snapped,
    // The key names the alignment and nothing else. A fill is not a target of
    // its own: a gap that opens or closes as the neighbours move must not look
    // like a new place to snap to, or the dwell would start its wait again.
    key: [horizontal?.id, vertical?.id].filter(Boolean).join("|"),
    fill: gapFillFor(snapped, others, desktop, {
      x: horizontal?.abut ?? null,
      y: vertical?.abut ?? null,
    }),
  };
}
