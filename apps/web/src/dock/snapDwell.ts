/**
 * The pause a snap now waits out before it acts.
 *
 * Every snap on this desktop — the screen-edge zones and the window-to-window
 * alignments alike — used to fire on the frame the drag first came into reach,
 * which made a window flung across the desktop grab an edge it was only
 * passing. So a snap has to be *asked for*: the drag rests at the target for
 * half a second, and only then does the preview appear or the window align.
 *
 * Pure, and driven by timestamps handed in rather than a timer of its own: the
 * drag hook already runs a frame at a time and knows the clock, so this stays a
 * decision about two numbers and is tested without one. One dwell serves both
 * modes — the target is a string, and what produced it is the caller's business.
 */

/** Where the drag is, in whatever coordinates the caller measures rest in. */
export interface DwellPoint {
  readonly x: number;
  readonly y: number;
}

/** What the dwell remembers between frames. Immutable; every frame returns a new one. */
export interface DwellState {
  /** The target being waited out, or `null` while nothing is in reach. */
  readonly target: string | null;
  /** Where the drag was when this wait started, for the rest test. */
  readonly at: DwellPoint | null;
  /** When the current wait started. */
  readonly since: number;
  /** True once the wait has been served, and then until the drag leaves every target. */
  readonly settled: boolean;
}

/** Nothing waited for: a drag that has not yet come near anything. */
export const NO_DWELL: DwellState = Object.freeze({
  target: null,
  at: null,
  since: 0,
  settled: false,
});

/**
 * How long the drag has to rest at a target before it snaps.
 *
 * Half a second, as asked for: long enough that crossing an edge on the way
 * somewhere else never snaps, short enough that deliberately parking a window
 * against an edge does not feel like waiting.
 */
export const DWELL_MS = 500;

/**
 * How far the drag may drift and still count as resting, per axis.
 *
 * Strict stillness is not a thing a hand on a mouse — let alone a finger on
 * glass — can produce: the pointer wobbles a pixel or two while it is being
 * held deliberately still, and a rule that restarted on every wobble would
 * never fire at all. Four pixels is comfortably more than that wobble and
 * comfortably less than either snap rule's reach (12px to a window's edge, 24px
 * to the screen's), so the slack can never carry the drag into a neighbouring
 * target while the clock is still running.
 */
export const DWELL_TOLERANCE = 4;

/** One frame of a drag, as the dwell sees it. */
export interface DwellFrame {
  /**
   * What the snap rules armed this frame, or `null` for nothing in reach. Any
   * stable string will do, as long as two different targets get different ones.
   */
  readonly target: string | null;
  /** Where the drag is, for the rest test. */
  readonly at: DwellPoint;
  /** Now, in milliseconds. */
  readonly now: number;
}

export interface Dwelled {
  readonly state: DwellState;
  /** True when the snap may act this frame. */
  readonly ready: boolean;
}

function drifted(from: DwellPoint | null, to: DwellPoint): boolean {
  if (!from) return true;
  return Math.abs(to.x - from.x) > DWELL_TOLERANCE || Math.abs(to.y - from.y) > DWELL_TOLERANCE;
}

/**
 * Whether this frame's target may act, and what to remember for the next one.
 *
 * Three rules, each of them something a user would expect:
 *
 * - A new target starts its own half second, *unless a wait has already been
 *   served*, in which case it is armed at once. The half second buys one thing
 *   — proof that the drag is aiming rather than passing through — and a drag
 *   that has stood still at an edge for it has given that proof for the rest of
 *   the gesture. So moving from one zone to the next arms the second
 *   immediately, and the preview glides across instead of fading out and making
 *   the user wait again. Losing the target — dragging away, or letting go of the
 *   modifier — forgets the wait entirely, so coming back starts over rather than
 *   finishing a wait the drag had abandoned. A drag that sweeps through three
 *   edges in a tenth of a second therefore arms nothing at any of them: it
 *   never served a wait, and so has nothing to carry.
 * - While the wait is running, drifting further than `DWELL_TOLERANCE`
 *   re-anchors it and restarts the clock: the drag is still moving, so it is
 *   not yet resting anywhere.
 * - Once served, the wait stays served for as long as the same target holds,
 *   however much the drag then moves. The target's own hysteresis
 *   (`RELEASE_DISTANCE`) is what decides how far the drag may wander before the
 *   target is lost, and that is the one place that decision belongs; making an
 *   already-visible preview re-earn its dwell on every jitter would only flicker
 *   it off and on.
 */
export function dwell(state: DwellState, frame: DwellFrame): Dwelled {
  const { target, at, now } = frame;
  if (target === null) return { state: NO_DWELL, ready: false };
  if (target === state.target && state.settled) return { state, ready: true };
  // A wait already served is carried to the new target rather than re-earned;
  // the new target and the time it was reached are what the next frame needs.
  if (state.settled) return { state: { target, at, since: now, settled: true }, ready: true };
  const restarting = target !== state.target || drifted(state.at, at);
  const since = restarting ? now : state.since;
  const settled = now - since >= DWELL_MS;
  return {
    state: { target, at: restarting ? at : (state.at ?? at), since, settled },
    ready: settled,
  };
}
