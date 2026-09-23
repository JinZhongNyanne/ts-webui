import { usableDesktop, type Box, type DesktopSize } from "./box";

/**
 * Aero Snap: take the POINTER to an edge of the desktop and the dragged window
 * takes half of it, into a corner and it takes a quarter, to the top and it
 * fills the desktop.
 *
 * This follows Windows 11: the gesture is armed by where the cursor is, not by
 * where the dragged window's edges happen to land. Dragging a wide window so
 * its left edge grazes the left of the screen does nothing in Windows; taking
 * the pointer there is what snaps it.
 *
 * The screen's edges are the only edges this file knows. Snapping a window to
 * the other *windows'* edges is a separate gesture with a switch of its own, and
 * lives in `windowSnap.ts`; whether either one is armed at all is `snapMode.ts`'s
 * to say, and how long the drag has to rest before it fires is
 * `snapDwell.ts`'s.
 *
 * Pure and DOM-free. The drag hook hands in the pointer each frame (already in
 * desktop coordinates) and gets back the zone to preview; the drop then asks
 * for that zone's box. Keeping the decision here means the whole gesture is
 * tested without a drag.
 */

export type SnapZone =
  "left" | "right" | "top" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

/**
 * How close the pointer has to come to an edge to arm that edge's half.
 *
 * Wider than the old box-based reach (12px), because the input is now a single
 * point rather than a whole window edge: the user flicks the cursor at the edge
 * of the screen and expects it to catch, and with a mouse the pointer is
 * usually stopped by the screen edge itself a few pixels in. Narrow enough that
 * it is still unmistakably "at the edge" and never fires mid-desktop.
 */
export const EDGE_DISTANCE = 24;

/**
 * How close the pointer has to come to BOTH a side and a top/bottom edge to arm
 * a quarter instead.
 *
 * Three times the edge band, because Windows 11's corner targets are regions,
 * not hairlines: aiming a quarter should not demand pixel accuracy in two axes
 * at once. Still far smaller than half the desktop, so the middle of an edge
 * reliably gives a half rather than a quarter.
 */
export const CORNER_DISTANCE = 72;

/** How much further the pointer has to travel before an armed zone lets go. */
export const RELEASE_DISTANCE = 16;

/** A pointer position, relative to the desktop's top-left corner. */
export interface SnapPointer {
  readonly x: number;
  readonly y: number;
}

export interface SnapInput {
  /** Where the pointer is this frame, relative to the desktop's top-left. */
  readonly pointer: SnapPointer;
  readonly desktop: DesktopSize;
  /** The zone armed on the previous frame, for hysteresis. */
  readonly current: SnapZone | null;
  /** True while the user holds the modifier that drags freely. */
  readonly suspended: boolean;
}

/**
 * The zone the pointer arms, or `null`.
 *
 * An already-armed zone holds on for a little longer than it took to arm, so a
 * pointer jittering on the boundary does not flicker the preview on and off.
 * Only the edges the armed zone is made of get that widened reach, so a zone
 * never bleeds into its neighbours.
 *
 * The bottom edge on its own arms nothing: in Windows it is the corners that
 * matter down there, and a pointer dragged low would otherwise keep snapping.
 */
export function snapZoneFor(input: SnapInput): SnapZone | null {
  if (input.suspended) return null;
  const desktop = usableDesktop(input.desktop.width, input.desktop.height);
  if (!desktop) return null;
  const { pointer, current } = input;

  /** The hysteresis bonus this edge gets, if the armed zone is built from it. */
  const held = (edge: string): number => (current && current.includes(edge) ? RELEASE_DISTANCE : 0);

  const fromLeft = pointer.x;
  const fromRight = desktop.width - pointer.x;
  const fromTop = pointer.y;
  const fromBottom = desktop.height - pointer.y;

  const inLeftBand = fromLeft <= CORNER_DISTANCE + held("left");
  const inRightBand = fromRight <= CORNER_DISTANCE + held("right");
  const inTopBand = fromTop <= CORNER_DISTANCE + held("top");
  const inBottomBand = fromBottom <= CORNER_DISTANCE + held("bottom");

  // Corners first: a pointer in a corner region means a quarter, not a half.
  if (inTopBand && inLeftBand) return "top-left";
  if (inTopBand && inRightBand) return "top-right";
  if (inBottomBand && inLeftBand) return "bottom-left";
  if (inBottomBand && inRightBand) return "bottom-right";

  if (fromTop <= EDGE_DISTANCE + held("top")) return "top";
  if (fromLeft <= EDGE_DISTANCE + held("left")) return "left";
  if (fromRight <= EDGE_DISTANCE + held("right")) return "right";
  return null;
}

/** The box a zone gives, tiling the desktop exactly. */
export function snapBox(zone: SnapZone, desktop: DesktopSize): Box {
  // The left/top halves round down so the right/bottom ones take the odd pixel
  // and the two together cover the desktop with no seam.
  const half = Math.floor(desktop.width / 2);
  const middle = Math.floor(desktop.height / 2);
  const rest = desktop.width - half;
  const lower = desktop.height - middle;
  switch (zone) {
    case "top":
      return { x: 0, y: 0, width: desktop.width, height: desktop.height };
    case "left":
      return { x: 0, y: 0, width: half, height: desktop.height };
    case "right":
      return { x: half, y: 0, width: rest, height: desktop.height };
    case "top-left":
      return { x: 0, y: 0, width: half, height: middle };
    case "top-right":
      return { x: half, y: 0, width: rest, height: middle };
    case "bottom-left":
      return { x: 0, y: middle, width: half, height: lower };
    case "bottom-right":
      return { x: half, y: middle, width: rest, height: lower };
  }
}
