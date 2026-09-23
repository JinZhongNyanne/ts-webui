/**
 * Recognising the taps the picture viewer listens for, as plain numbers.
 *
 * The stage sets `touch-action: none` so it can pan and pinch itself, and a
 * browser that has been told the touches are ours may stop synthesising the
 * `dblclick` that "double tap to toggle fit" would otherwise ride on. The
 * viewer therefore recognises the gesture from the pointer stream, which means
 * deciding two things: whether a release was a tap at all, and whether it was
 * the second of a pair. Both are arithmetic, so both live here rather than
 * tangled into the event handlers.
 */

/** Two taps closer together than this are a double tap (a phone's double click). */
export const DOUBLE_TAP_MS = 300;
/** A press that travelled further than this before lifting was a drag, not a tap. */
export const TAP_SLOP_PX = 12;

export interface TapPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Whether a finger that went down at `press` and came up at `release` stayed
 * still enough to mean a tap. No fingertip lands and lifts on one pixel, which
 * is what the slop allows for.
 */
export function isTap(press: TapPoint, release: TapPoint): boolean {
  return Math.hypot(press.x - release.x, press.y - release.y) <= TAP_SLOP_PX;
}

/**
 * Whether a tap at `at` completes a double tap begun at `previousTapAt`.
 *
 * A zero (or unset) previous time is "no tap pending", so the very first tap of
 * a session can never be mistaken for the second one; times are the event
 * timestamps, which share one clock.
 */
export function isDoubleTap(previousTapAt: number, at: number): boolean {
  return previousTapAt > 0 && at - previousTapAt <= DOUBLE_TAP_MS;
}
