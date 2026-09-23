/**
 * Long-press geometry, shared by `useLongPress`.
 *
 * The channel tree opens its menus from `contextmenu`, which a touch device
 * never fires, so a held finger has to stand in for a right click. The only
 * part worth testing on its own is telling a held finger from a scroll.
 */

/** How long a finger must rest before the menu opens, in milliseconds. */
export const LONG_PRESS_MS = 500;

/** How far it may drift in that time, in CSS pixels, before it counts as a scroll. */
export const LONG_PRESS_MOVE_TOLERANCE = 10;

/** A point on the screen, in client coordinates. */
export interface PressPoint {
  readonly x: number;
  readonly y: number;
}

/** Whether the finger has moved far enough that this is a scroll, not a press. */
export function movedTooFar(
  start: PressPoint,
  now: PressPoint,
  tolerance: number = LONG_PRESS_MOVE_TOLERANCE,
): boolean {
  return Math.abs(now.x - start.x) > tolerance || Math.abs(now.y - start.y) > tolerance;
}
