/**
 * What the desktop shows *before* a snap arms.
 *
 * Every snap here waits out half a second of rest (`snapDwell.ts`), and until
 * this module existed the only thing on screen during that half second was
 * dockview's own drop highlight for a tab drag, and nothing at all for a window
 * drag. Both were dishonest in opposite directions: the highlight appears the
 * instant the pointer crosses an edge, at full strength, which reads as
 * "release now and this happens" — false for the next 500ms — while a window
 * drag gave no hint that resting there would do anything.
 *
 * So the feedback is now in two clearly different states, and the difference is
 * the message:
 *
 * - **dwelling** — a dashed, unfilled outline of the box, filling up over the
 *   half second. It says "this is the box, keep holding", and it cannot be
 *   mistaken for the armed preview because it has no solid fill and no solid
 *   border.
 * - **armed** — the solid preview `SnapOverlay` has always painted. It says
 *   "release and this happens", and now that is the truth.
 *
 * This module is only the decision of which one applies, shared so a tab drag
 * and a window drag cannot disagree about it. The box is whatever the armed
 * preview *would* be. Every desktop snap has one — a window-to-window snap
 * that fills no gap promises the lined-up position itself (`dragSnap.ts`) — so
 * `box` is `null` only for a frame with no box to offer, such as a window
 * whose own box could not be read, and then nothing is outlined either.
 *
 * How full the outline is drawn is deliberately NOT computed here. It is a CSS
 * animation of exactly `DWELL_MS`, started when the cue appears and restarted
 * whenever `since` changes — see `desktop.css`. A JS-computed fraction would
 * have to be recomputed per frame, and a drag that is being held perfectly
 * still produces no frames at all, which is precisely the gesture the cue has
 * to stay legible for.
 */

import type { Box } from "./box";
import type { Dwelled } from "./snapDwell";

/** The box a drag is waiting on, and when that wait started. */
export interface SnapDwelling {
  /** Where the snap would land, drawn as an outline rather than a promise. */
  readonly box: Box;
  /**
   * The timestamp the current wait began at, from the dwell itself.
   *
   * The view keys the cue on it, so re-anchoring the wait — the drag drifted
   * further than the tolerance allows — restarts the fill instead of letting it
   * run on and claim more of the half second has passed than really has.
   */
  readonly since: number;
}

/**
 * The pre-arm cue for this frame, or `null` when there should not be one.
 *
 * `box` is what the armed preview would show; `waited` is the dwell's own
 * answer for the frame. Nothing is remembered between calls: the caller keeps
 * the dwell state, and this returns a fresh value every time.
 */
export function dwellingFor(box: Box | null, waited: Dwelled): SnapDwelling | null {
  if (!box || waited.ready) return null;
  return { box, since: waited.state.since };
}
