import { MIN_WINDOW_EXTENT, type Box, type DesktopSize } from "./box";
import { edgeOf, horizontal, movedEdge, opposite, overlaps, type Edge } from "./snapGroup";
import { WINDOW_SNAP_DISTANCE } from "./windowSnap";

/**
 * Snapping while a window is resized: where the dragged edges *would* land, so
 * the preview can show it and the release can put them there.
 *
 * The user's words were "calculate the snap position and wait until release,
 * then resize", and that is the whole shape of it. The edge goes on following
 * the cursor — dockview's `Overlay.setupResize` owns the gesture and has no
 * transform hook, and an edge that jumped about under the pointer would be
 * harder to aim than one that does not — while this works out the box the
 * window would take, and the hook paints it as the desktop's snap preview and
 * commits it on `pointerup`.
 *
 * **What an edge snaps to.** The same targets a moved window uses, chosen by
 * the same switches (`snapMode.ts`):
 *
 * - with window-to-window snapping on, the edges of the other visible floating
 *   windows. *Abutting* — the dragged right edge onto a neighbour's left edge —
 *   only against a window it actually lies beside on the other axis, which is
 *   the gate `windowSnap.ts` puts on an abut and `snapGroup.ts` on a seam, so
 *   that the pair a resize parks flush is the pair that then shares a seam.
 *   *Aligning* — the dragged right edge onto a neighbour's right edge, lining a
 *   column up — is not gated, for the reason `windowSnap.ts` gives: lining up
 *   with a window above is the point, and the two cannot overlap when it is;
 * - with screen-edge snapping on, the desktop's own edge on the dragged side.
 *   Only that one: the far edge of the desktop is not somewhere a left edge can
 *   usefully go.
 *
 * The reach is `WINDOW_SNAP_DISTANCE`, the drag's own, so an edge pulls in at
 * the same distance whether the window is being moved or resized.
 *
 * **Which target wins.** The nearest. An exact tie goes to whichever was offered
 * first: the other windows in the order they are handed in (the desktop's own
 * panel order, which does not change mid-drag, so a tie does not flicker), each
 * window's abut before its alignment, and the desktop's edge after every window.
 *
 * **Which edges move.** Only the ones being dragged, and a corner's two are
 * decided independently — the right edge knows nothing of where the bottom one
 * went. Each is decided against the frame's box as dockview proposed it, so the
 * overlap gate for one axis reads the other axis where the pointer has it, not
 * where a snap might take it.
 *
 * **What an edge never does.** It never snaps when it is on a seam
 * (`useSnapGroups.ts`): the neighbours linked to it at `pointerdown` are already
 * flush against it and following it, so it is snapped already, and pulling it
 * to some third window would drag the whole seam there with it — past a limit
 * the seam clamp worked out without knowing about the snap. So a seamed edge is
 * the seam's alone, and the snap only ever touches edges that have no limits,
 * which is why a snap cannot break the clamp. It never lands anywhere that
 * leaves the window narrower than `MIN_WINDOW_EXTENT` — the minimum every other
 * snap that resizes a window keeps — and never outside the desktop.
 *
 * Pure and DOM-free, like `windowSnap.ts`: the hook hands in the boxes it read
 * from dockview and applies the box it gets back.
 */

export interface ResizeSnapInput {
  /** The dragged window's box this frame, after any seam clamp. */
  readonly box: Box;
  /** The edges the pressed handle drags: one for a side, two for a corner. */
  readonly edges: readonly Edge[];
  /** The dragged edges that are on a seam, which are the seam's and never snap. */
  readonly seams: readonly Edge[];
  /**
   * The other visible floating windows. Order is the caller's, and decides ties.
   */
  readonly others: readonly Box[];
  /** The desktop, for its own edges and as the bounds a target must lie in. */
  readonly desktop: DesktopSize | null;
  /** Whether window-to-window snapping is on. */
  readonly toWindows: boolean;
  /** Whether screen-edge snapping is on. */
  readonly toEdges: boolean;
}

/** Where the desktop's own edge is on that side, if there is one to measure. */
function desktopEdge(edge: Edge, desktop: DesktopSize): number {
  if (edge === "left" || edge === "top") return 0;
  return edge === "right" ? desktop.width : desktop.height;
}

/** How wide or tall the window would be with that edge moved to `target`. */
function extentWith(box: Box, edge: Edge, target: number): number {
  const pinned = edgeOf(box, opposite(edge));
  return Math.abs(target - pinned);
}

/** Whether `target` is a place that edge may go at all, however near it is. */
function admissible(box: Box, edge: Edge, target: number, desktop: DesktopSize | null): boolean {
  // The edge must stay on its own side of the pinned one — a target past it
  // would turn the window inside out — and leave it at least the minimum.
  const pinned = edgeOf(box, opposite(edge));
  const outward = edge === "right" || edge === "bottom" ? target > pinned : target < pinned;
  if (!outward || extentWith(box, edge, target) < MIN_WINDOW_EXTENT) return false;
  if (!desktop) return true;
  const limit = horizontal(edge) ? desktop.width : desktop.height;
  return target >= 0 && target <= limit;
}

/** The targets on offer for one dragged edge, in tie-breaking order. */
function targetsFor(edge: Edge, input: ResizeSnapInput): readonly number[] {
  const { box, others, desktop } = input;
  const fromWindows = input.toWindows
    ? others.flatMap((other) => [
        ...(overlaps(box, other, edge) ? [edgeOf(other, opposite(edge))] : []),
        edgeOf(other, edge),
      ])
    : [];
  const fromDesktop = input.toEdges && desktop ? [desktopEdge(edge, desktop)] : [];
  return [...fromWindows, ...fromDesktop];
}

/** The nearest admissible target in reach for one edge, or `null`. */
function snappedEdge(edge: Edge, input: ResizeSnapInput): number | null {
  const at = edgeOf(input.box, edge);
  let best: { target: number; distance: number } | null = null;
  for (const target of targetsFor(edge, input)) {
    const distance = Math.abs(target - at);
    if (distance > WINDOW_SNAP_DISTANCE) continue;
    // Strictly nearer only, so the first of equals keeps it.
    if (best && best.distance <= distance) continue;
    if (!admissible(input.box, edge, target, input.desktop)) continue;
    best = { target, distance };
  }
  return best?.target ?? null;
}

/**
 * The box the window would take if it were let go now, or `null` when no dragged
 * edge is in reach of anything — in which case the release must leave dockview's
 * box exactly as the user dragged it.
 */
export function resizeSnapFor(input: ResizeSnapInput): Box | null {
  let snapped: Box | null = null;
  for (const edge of input.edges) {
    if (input.seams.includes(edge)) continue;
    const target = snappedEdge(edge, input);
    if (target === null) continue;
    // `admissible` has already kept the window at the minimum, so `movedEdge`'s
    // own floor never engages here; it is the same arithmetic the seam uses to
    // move one edge with the opposite one pinned.
    snapped = movedEdge(snapped ?? input.box, edge, target, MIN_WINDOW_EXTENT);
  }
  return snapped;
}
