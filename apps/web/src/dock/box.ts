/**
 * The rectangle every part of the desktop speaks in, and the two clamps that
 * keep one inside its container.
 *
 * Pure and DOM-free: placement, snapping and the float-drop maths all size
 * boxes against a container they are handed, so they stay testable without a
 * live dock.
 */

/** A window's box, relative to the desktop's top-left corner. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The desktop's own box, which every other box is placed inside. */
export interface DesktopSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The desktop's size, or `null` for a box we cannot place anything against.
 *
 * dockview's container is still 0x0 on the first frame and a detached element
 * reports NaN, so callers skip and try again on the next frame rather than
 * placing a window at a nonsense position.
 */
export function usableDesktop(width: number, height: number): DesktopSize | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/** `preferred`, shrunk to `maxShare` of what is available but never below `minimum`. */
export function fitSize(
  preferred: number,
  available: number,
  minimum: number,
  maxShare: number,
): number {
  const cap = Math.max(minimum, Math.floor(available * maxShare));
  return Math.min(preferred, cap);
}

/**
 * Whether two spans on one axis overlap at all.
 *
 * Half-open on purpose, so spans that merely touch do not overlap: two windows
 * meeting at a single corner share no border, and neither an abut nor a resize
 * seam is meaningful there. It lives here because three separate rules ask it —
 * `windowSnap.ts` for which neighbour may be abutted and which walls a gap in,
 * and `snapGroup.ts` for which neighbour shares a seam — and their answers have
 * to agree: the pair that can abut is the pair that can later share a resize,
 * so one predicate rather than three copies free to drift apart.
 */
export function spansOverlap(
  from: number,
  to: number,
  otherFrom: number,
  otherTo: number,
): boolean {
  return from < otherTo && otherFrom < to;
}

/** `value` inside `[min, max]`; a non-finite value becomes `min`. */
export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * The narrowest a window may be left by a snap that resizes it.
 *
 * Gap filling, a tab split and a linked resize all have to answer "is there
 * still a window here?", and they must answer it the same way or a window
 * squeezed to nothing by one gesture would be refused by the next. Below this
 * a window has room for its title bar and little else, so a gesture that would
 * go further declines instead.
 *
 * Deliberately smaller than `placement.ts`'s MIN_SIZE, which is the size a
 * window is *opened* at: what is too small to offer is not too small to keep.
 */
export const MIN_WINDOW_EXTENT = 160;
