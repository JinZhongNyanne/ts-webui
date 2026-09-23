import { clampNumber, spansOverlap, type Box, type DesktopSize } from "./box";

/**
 * The geometry of a snap group: which windows are attached to the edge being
 * resized, and where a drag of that edge leaves them.
 *
 * Windows 11's behaviour, and the one the user asked for: drag the seam between
 * two windows parked side by side and it *is* a seam — one grows by exactly what
 * the other gives up, instead of one window sliding over its neighbour and
 * leaving a strip of wallpaper or an overlap behind.
 *
 * **The unit is the seam, not the pair.** A seam is one coordinate on one axis,
 * and more than two windows can sit on it: two stacked on the left of a
 * full-height window on the right share a single seam line, and dragging any of
 * those three edges has to move all three. So the group is the windows attached
 * to that *line* — on either side of it — rather than the dragged window's own
 * neighbours; `seamLinks` explains how far along the line that reaches, and why
 * it is still only one hop deep across a row of windows, where each pair has a
 * seam line of its own.
 *
 * **A group is recomputed from the boxes, never stored.** The tempting
 * alternative — remembering "these two were snapped together" when the snap
 * happens — would have to survive every later move, a minimise, a close, a
 * maximise and restore, `fromJSON` and the saved-layout schema, and would be
 * wrong the moment a window is nudged away by hand. The geometry already
 * carries the fact: windows only end up flush with one another because a snap
 * put them there, so "flush right now" is both the cheapest and the most
 * truthful definition of the group. It is re-derived once at the start of each
 * resize drag and then held for that drag, so the group cannot shift underfoot
 * while the pointer is down.
 *
 * Pure and DOM-free, like `snap.ts` and `windowSnap.ts`: the hook hands in the
 * boxes it read from dockview and applies the boxes it gets back.
 */

/** One side of a box. Named from the point of view of the window that owns it. */
export type Edge = "left" | "right" | "top" | "bottom";

/**
 * How far apart two edges may be and still count as the same seam.
 *
 * A snap leaves windows mathematically flush, but the boxes travel through
 * dockview's own clamping and `getBoundingClientRect`, which work in fractional
 * CSS pixels; a pair that ought to share a seam can come back a rounding error
 * apart. Two pixels absorbs that without reaching so far that two windows a
 * visible gap apart start dragging each other about.
 */
export const ADJACENT_TOLERANCE = 2;

/** A window that is not the one being resized: what it is, and where it is. */
export interface Sibling {
  readonly id: string;
  readonly box: Box;
}

/**
 * A window that follows a seam: which window, which seam, and the edge of its
 * own it moves.
 *
 * `edge` names the *dragged* window's edge, which is what identifies the seam
 * (and, for a corner drag, the axis). `follows` is the edge of *this* window
 * that travels to the seam: the opposite edge for a window on the far side of
 * the seam, and the *same* edge for one on the same side as the dragged window,
 * which happens when several windows are stacked against one long neighbour.
 */
export interface Link {
  /** The sibling's id. */
  readonly id: string;
  /** The *dragged* window's edge, i.e. which seam this link belongs to. */
  readonly edge: Edge;
  /** The sibling's own edge that moves to the seam; its opposite is pinned. */
  readonly follows: Edge;
}

/** dockview's eight handle directions, in the order it names them. */
const HANDLE_EDGES: Readonly<Record<string, readonly Edge[]>> = {
  top: ["top"],
  bottom: ["bottom"],
  left: ["left"],
  right: ["right"],
  topleft: ["top", "left"],
  topright: ["top", "right"],
  bottomleft: ["bottom", "left"],
  bottomright: ["bottom", "right"],
};

const HANDLE_PREFIX = "dv-resize-handle-";

/**
 * The edges a dockview resize handle drags, from the handle element's classes.
 *
 * `Overlay.setupResize` builds one child per direction with exactly one class,
 * `dv-resize-handle-<direction>`, and a corner handle moves two edges at once.
 * An unrecognised class yields no edges, which switches the feature off for
 * that gesture rather than guessing an edge and pulling the wrong neighbour
 * about — the way a dockview upgrade that renames its handles should fail.
 */
export function resizeEdgesOf(handleClass: string): readonly Edge[] {
  for (const token of handleClass.split(/\s+/)) {
    if (!token.startsWith(HANDLE_PREFIX)) continue;
    const edges = HANDLE_EDGES[token.slice(HANDLE_PREFIX.length)];
    if (edges) return edges;
  }
  return [];
}

/** The opposite side, which is the edge that stays pinned when one is moved. */
export function opposite(edge: Edge): Edge {
  if (edge === "left") return "right";
  if (edge === "right") return "left";
  if (edge === "top") return "bottom";
  return "top";
}

/** Where a box's given side sits, as one coordinate. */
export function edgeOf(box: Box, edge: Edge): number {
  if (edge === "left") return box.x;
  if (edge === "right") return box.x + box.width;
  if (edge === "top") return box.y;
  return box.y + box.height;
}

/** True for an edge that moves along x; the perpendicular axis is then y. */
export function horizontal(edge: Edge): boolean {
  return edge === "left" || edge === "right";
}

/**
 * Whether the two boxes actually lie beside each other along that seam.
 *
 * Sharing a coordinate is not sharing a seam: a window five hundred pixels
 * further down whose left edge happens to line up with the dragged window's
 * right edge has no shared border to move, and resizing it would look like
 * action at a distance. Touching at a single corner counts as no overlap, for
 * the same reason — there is no seam there either. Literally the same gate
 * `windowSnap.ts` puts on an abutting snap, `box.ts`'s `spansOverlap`, and
 * deliberately so: the pair that can abut is the pair that can later share a
 * resize.
 */
export function overlaps(a: Box, b: Box, edge: Edge): boolean {
  if (horizontal(edge)) return spansOverlap(a.y, a.y + a.height, b.y, b.y + b.height);
  return spansOverlap(a.x, a.x + a.width, b.x, b.x + b.width);
}

/**
 * Which edge of `box` sits on the seam, or `null` if neither does.
 *
 * The far side is tested first: a window that begins at the seam is the ordinary
 * neighbour, and only a window narrower than the tolerance — already far below
 * `MIN_WINDOW_EXTENT`, so not something a snap can produce — could match both.
 */
function flushEdge(box: Box, dragged: Edge, seam: number, tolerance: number): Edge | null {
  const far = opposite(dragged);
  if (Math.abs(edgeOf(box, far) - seam) <= tolerance) return far;
  if (Math.abs(edgeOf(box, dragged) - seam) <= tolerance) return dragged;
  return null;
}

/**
 * The windows attached to one seam, in the order the seam reaches them.
 *
 * **What a seam is.** One coordinate on one axis — the dragged edge's position.
 * Every window with an edge of its own within `tolerance` of it, on *either*
 * side, is a candidate: the far-side ones give up what the near-side ones take,
 * and the near-side ones (windows stacked alongside the dragged one against the
 * same long neighbour) have to move that same edge or they would be left behind,
 * overlapping the window that did follow. That is the bug this replaced: with
 * A above B on the left and a full-height C on the right, dragging A's right
 * edge moved C's left edge and left B's right edge where it was.
 *
 * **Why candidacy is not enough.** Two windows at opposite ends of the desktop
 * can share an x-coordinate by coincidence, and dragging one must not resize the
 * other — see `overlaps`. But plain pairwise overlap with the *dragged* window
 * is too narrow: in that A/B/C layout A and B do not overlap each other at all,
 * they only both overlap C. So membership is the **transitive closure of
 * perpendicular overlap over the seam's candidates, seeded from the dragged
 * window**: B is admitted because C is on the seam, overlaps A, and overlaps B.
 * A window on the seam that overlaps nothing already reached stays out, however
 * exactly its coordinate matches.
 *
 * The closure walks only through windows that are themselves on this seam, so it
 * cannot leak onto another seam — it reaches along one line, never across. That
 * a long window can join two windows at opposite ends of that line is the point
 * rather than a leak: they all share a border with it, so the seam really is
 * continuous between them.
 */
function seamLinks(
  dragged: Box,
  edge: Edge,
  siblings: readonly Sibling[],
  tolerance: number,
): readonly Link[] {
  const seam = edgeOf(dragged, edge);
  let waiting = siblings.flatMap((sibling) => {
    const follows = flushEdge(sibling.box, edge, seam, tolerance);
    return follows ? [{ sibling, follows }] : [];
  });
  const links: Link[] = [];
  let frontier: readonly Box[] = [dragged];
  while (frontier.length > 0 && waiting.length > 0) {
    const reached = waiting.filter((candidate) =>
      frontier.some((box) => overlaps(box, candidate.sibling.box, edge)),
    );
    waiting = waiting.filter((candidate) => !reached.includes(candidate));
    for (const { sibling, follows } of reached) links.push({ id: sibling.id, edge, follows });
    frontier = reached.map((candidate) => candidate.sibling.box);
  }
  return links;
}

/**
 * Every window that follows this resize: one entry per (dragged edge, window).
 *
 * A corner drag has two seams, one per axis, and they are worked out entirely
 * independently — a window may appear on both, and is then moved on both. Only
 * the edges actually being dragged are considered, so pushing a window's right
 * edge never disturbs whatever is parked above it.
 */
export function linksFor(
  dragged: Box,
  edges: readonly Edge[],
  siblings: readonly Sibling[],
  tolerance: number = ADJACENT_TOLERANCE,
): readonly Link[] {
  return edges.flatMap((edge) => seamLinks(dragged, edge, siblings, tolerance));
}

/**
 * `box` with one of its edges moved to `seam`, its opposite edge pinned, and
 * never left thinner than `min`.
 *
 * The one piece of arithmetic behind both halves of the feature: a followed
 * window moving its near or far edge onto the seam, and the dragged window being
 * held back at a limit. Pinning the opposite edge is what keeps the effect one
 * hop deep — whatever is flush against *that* edge sees nothing change, so
 * nothing propagates to it. Windows 11 stops at one hop too.
 *
 * The `min` clamp is belt and braces for a followed window, which the drag is
 * already held back for (see `seamLimitsFor`): this is arithmetic on boxes read
 * from a live dock, and a rounding error on a seam already sitting on its limit
 * must not be able to produce a window a fraction under the minimum, still less
 * a negative extent.
 */
export function movedEdge(box: Box, edge: Edge, seam: number, min: number): Box {
  if (edge === "left") {
    const far = box.x + box.width;
    const x = Math.min(seam, far - min);
    return { ...box, x, width: far - x };
  }
  if (edge === "right") return { ...box, width: Math.max(min, seam - box.x) };
  if (edge === "top") {
    const far = box.y + box.height;
    const y = Math.min(seam, far - min);
    return { ...box, y, height: far - y };
  }
  return { ...box, height: Math.max(min, seam - box.y) };
}

/** True when two boxes are the same rectangle. */
function same(a: Box, b: Box): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Where the attached windows go, given the dragged window's box after the
 * resize. Only the ones that actually move are returned, so a frame in which
 * the seam did not shift costs no repositioning at all.
 *
 * The seam is read from `after` on the *dragged* edge, and each window then
 * moves its own `follows` edge onto it: the far-side ones grow by what the
 * dragged window gave up, the same-side ones move with it. A window on both
 * seams of a corner drag is shifted twice, once per axis.
 */
export function followResize(
  links: readonly Link[],
  siblings: readonly Sibling[],
  after: Box,
  min: number,
): readonly Sibling[] {
  const boxes = new Map<string, Box>();
  for (const link of links) {
    const start = boxes.get(link.id) ?? siblings.find((s) => s.id === link.id)?.box;
    // A window closed or minimised mid-drag: nothing to follow, and nothing
    // worth reporting either.
    if (!start) continue;
    boxes.set(link.id, movedEdge(start, link.follows, edgeOf(after, link.edge), min));
  }
  return [...boxes]
    .filter(([id, box]) => {
      const before = siblings.find((s) => s.id === id)?.box;
      return !!before && !same(before, box);
    })
    .map(([id, box]) => ({ id, box }) satisfies Sibling);
}

/**
 * How far a seam may travel along its axis before some attached window runs out.
 *
 * `upper` is the largest coordinate the dragged edge may reach and `lower` the
 * smallest; either may be absent, meaning that direction is unbounded. Both can
 * apply at once now that windows on *both* sides of the seam follow it: pulling
 * the seam one way squeezes the far side, pushing it back squeezes the windows
 * stacked alongside the dragged one.
 */
export interface SeamBounds {
  readonly upper?: number;
  readonly lower?: number;
}

/**
 * One entry per *dragged* edge. An edge with no entry is unbounded, which is the
 * case for every edge with nothing attached to it — so a window stays freely
 * resizable in every direction that is not part of the group.
 */
export type SeamLimits = Readonly<Partial<Record<Edge, SeamBounds>>>;

/** Which way a window on the seam bounds it: from above, or from below. */
function boundsAbove(edge: Edge): boolean {
  return edge === "right" || edge === "bottom";
}

/**
 * The bound one attached window puts on its seam: `min` away from its pinned
 * edge, on whichever side of the seam that window lies.
 *
 * A window whose *near* edge follows (a far-side neighbour: `left` or `top`) is
 * pinned at its far end and so caps the seam from above; one whose far edge
 * follows (a same-side window: `right` or `bottom`) is pinned at its near end
 * and so floors it from below.
 */
function boundOf(box: Box, follows: Edge, min: number): SeamBounds {
  const pinned = edgeOf(box, opposite(follows));
  return boundsAbove(follows) ? { lower: pinned + min } : { upper: pinned - min };
}

/** The tighter of two bounds on the same seam, in both directions. */
function tightened(held: SeamBounds | undefined, add: SeamBounds): SeamBounds {
  if (!held) return add;
  const upper =
    add.upper === undefined
      ? held.upper
      : held.upper === undefined
        ? add.upper
        : Math.min(held.upper, add.upper);
  const lower =
    add.lower === undefined
      ? held.lower
      : held.lower === undefined
        ? add.lower
        : Math.max(held.lower, add.lower);
  return {
    ...(upper === undefined ? {} : { upper }),
    ...(lower === undefined ? {} : { lower }),
  };
}

/**
 * The furthest each seam may go, from the links and the boxes captured at
 * `pointerdown`.
 *
 * **Why the drag is held back rather than a window abandoned.** The user asked
 * for a seam that refuses: a snap group can never be dragged into an overlap, so
 * when an attached window has nothing left to give, the dragged edge stops too.
 * That costs re-positioning dockview's overlay inside the frame it announces —
 * see `useSnapGroups.ts`, which explains why that is nonetheless stable — and
 * buys a group that behaves like one set of tiles rather than windows that
 * suddenly start sliding over each other.
 *
 * Every window on the seam binds it, on both sides, and the tightest wins: the
 * seam stops as soon as the *first* of them is out of room, because going
 * further would overlap that one. Taking only the dragged window's own direct
 * neighbours would stop the drag too late and leave a stacked window squeezed
 * under the minimum. A corner drag yields two entries and the two axes are
 * worked out independently — a window to the right has nothing to say about how
 * far down the bottom edge may go.
 *
 * A link whose sibling has gone away mid-drag contributes no limit, the same way
 * `followResize` moves nothing for it: a window that is no longer there cannot
 * be overlapped.
 *
 * **The dragged window is on its own seam too.** Given `dragged`, each seam is
 * also bounded by the dragged window's own minimum — `boundOf` with the dragged
 * edge as the one that follows, since that is exactly what it does. Without it
 * the group is only a group from one side: the seam between two halves is where
 * both windows' handles overlap, a press there lands on whichever window is in
 * front, and when that is the window being *squeezed* nothing but dockview's own
 * 20px floor stopped it. The rig caught precisely that — the seam ran 78px past
 * the minimum, the dragged window down to 82px wide — while the unit fakes, which
 * pressed the handle each case named, never did. Only seamed edges get the bound:
 * an edge with nothing on it is a plain dockview resize, and not the group's to
 * hold.
 */
export function seamLimitsFor(
  links: readonly Link[],
  siblings: readonly Sibling[],
  min: number,
  dragged?: Box,
): SeamLimits {
  const limits: Partial<Record<Edge, SeamBounds>> = {};
  for (const link of links) {
    const box = siblings.find((s) => s.id === link.id)?.box;
    if (!box) continue;
    limits[link.edge] = tightened(limits[link.edge], boundOf(box, link.follows, min));
  }
  if (!dragged) return limits;
  for (const edge of Object.keys(limits) as Edge[]) {
    limits[edge] = tightened(limits[edge], boundOf(dragged, edge, min));
  }
  return limits;
}

/**
 * The frame's box with every bounded edge held inside its limits.
 *
 * The edge opposite a clamped one never moves, because it is the edge dockview
 * is holding still for this gesture: clamping a right-edge drag shortens the
 * width and leaves `x` alone, and clamping a left-edge drag moves `x` and widens
 * by as much, so the far edge stays where the pointer put it.
 *
 * `min` bounds the *dragged* window as well, which matters in one case only:
 * windows that were already overlapping when the drag started can produce a
 * limit inside the dragged window's own minimum, and squeezing it to nothing to
 * honour that would be a worse answer than the overlap the geometry arrived in.
 * The same geometry is the only way to arrive at an `upper` below its `lower`;
 * the lower bound is applied second and so wins, which keeps the frame a fixed
 * point of the same pointer position rather than making it flicker between the
 * two.
 *
 * Returns the identical object when nothing was clamped, which is how the hook
 * tells "this frame needs writing back" from "leave dockview's box alone" — with
 * no links at all there are no limits and so a box is never touched.
 */
export function clampToLimits(box: Box, limits: SeamLimits, min: number): Box {
  let clamped = box;
  for (const [edge, bounds] of Object.entries(limits) as [Edge, SeamBounds][]) {
    clamped = held(clamped, edge, bounds, min);
  }
  return clamped;
}

/** `box` with that one edge pulled inside `bounds`, or `box` itself if it is. */
function held(box: Box, edge: Edge, bounds: SeamBounds, min: number): Box {
  let inside = box;
  if (bounds.upper !== undefined && edgeOf(inside, edge) > bounds.upper) {
    inside = movedEdge(inside, edge, bounds.upper, min);
  }
  if (bounds.lower !== undefined && edgeOf(inside, edge) < bounds.lower) {
    inside = movedEdge(inside, edge, bounds.lower, min);
  }
  return inside;
}

/**
 * `box` brought inside the desktop, shrinking it first if it cannot fit.
 *
 * A followed box is derived arithmetic, not something the user dragged, so it
 * has to be checked before it is applied: a neighbour whose far edge sat a
 * fraction outside the desktop — which dockview's own clamping permits — would
 * otherwise be pushed further out by every frame of the drag.
 */
export function clampToDesktop(box: Box, desktop: DesktopSize): Box {
  const width = Math.min(box.width, desktop.width);
  const height = Math.min(box.height, desktop.height);
  return {
    x: clampNumber(box.x, 0, desktop.width - width),
    y: clampNumber(box.y, 0, desktop.height - height),
    width,
    height,
  };
}
