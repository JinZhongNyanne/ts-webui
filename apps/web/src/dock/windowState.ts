import type { Box, DesktopSize } from "./box";

/**
 * Which windows are minimised or maximised, and where a maximised one goes back to.
 *
 * dockview does not serialise either for a floating group, and hiding one with
 * its own `setVisible` would let it re-clamp the window from a zero-sized box,
 * so the desktop keeps this itself and saves it beside dockview's layout.
 *
 * Immutable throughout: every function returns a new map.
 */

export interface WindowState {
  readonly minimized: boolean;
  /** The box to restore to, set only while the window is maximised. */
  readonly restore: Box | null;
  /**
   * The box this panel's *own* window last had, or `null` for a panel that has
   * never had one.
   *
   * Stacking a tab into another window and tearing it out again must not lose
   * the window it had: the tab's content survives the move (dockview renders
   * every panel `always`), so the frame has to as well, or the panel comes
   * back as a default-sized box somewhere near the drop point. Only recorded
   * while the panel is alone in a floating group — that is exactly when the
   * window on screen is *its* window and not one it is sharing.
   */
  readonly float: Box | null;
}

/** Window state by dock panel id. */
export type WindowStates = Readonly<Record<string, WindowState>>;

const OPEN: WindowState = { minimized: false, restore: null, float: null };

/** No window minimised, none maximised. */
export const NO_WINDOWS: WindowStates = Object.freeze({});

export function stateOf(states: WindowStates, panelId: string): WindowState {
  return states[panelId] ?? OPEN;
}

export function isMinimized(states: WindowStates, panelId: string): boolean {
  return stateOf(states, panelId).minimized;
}

export function isMaximized(states: WindowStates, panelId: string): boolean {
  return stateOf(states, panelId).restore !== null;
}

/** A new map with `panelId` set to `state`, or with it removed when it is plain. */
function withState(states: WindowStates, panelId: string, state: WindowState): WindowStates {
  const next = { ...states };
  if (!state.minimized && state.restore === null && state.float === null) delete next[panelId];
  else next[panelId] = state;
  return next;
}

export function setMinimized(
  states: WindowStates,
  panelId: string,
  minimized: boolean,
): WindowStates {
  return withState(states, panelId, { ...stateOf(states, panelId), minimized });
}

/** What a click on the taskbar's "minimise all" toggle came to. */
export interface ShowDesktopToggle {
  readonly states: WindowStates;
  /**
   * The windows this click minimised, for the next click to bring back.
   *
   * Empty when the click restored instead, or when there was nothing showing
   * to put away.
   */
  readonly minimized: readonly string[];
}

/**
 * Windows' "show desktop" button, as a decision.
 *
 * While anything is showing, the click puts every window away and reports
 * which ones it moved. Once everything is already minimised, the click brings
 * back exactly those — `remembered` — and nothing else: a window the user
 * minimised themselves before pressing the button is not a window they asked
 * to see again, so restoring it would be the button inventing an intention.
 * Ids that are no longer in the layout are dropped on the way back.
 */
export function toggleShowDesktop(
  states: WindowStates,
  panelIds: readonly string[],
  remembered: readonly string[],
): ShowDesktopToggle {
  const showing = panelIds.filter((id) => !isMinimized(states, id));
  if (showing.length > 0) {
    return {
      states: showing.reduce((acc, id) => setMinimized(acc, id, true), states),
      minimized: showing,
    };
  }
  const live = new Set(panelIds);
  const back = remembered.filter((id) => live.has(id) && isMinimized(states, id));
  return {
    states: back.reduce((acc, id) => setMinimized(acc, id, false), states),
    minimized: [],
  };
}

/** The box `panelId`'s own window last had, or `null` if it never had one. */
export function floatBoxOf(states: WindowStates, panelId: string): Box | null {
  return stateOf(states, panelId).float;
}

/** One window seen on the desktop: its panel, and its box if it is its own window. */
export interface FloatSighting {
  readonly panelId: string;
  /** The window's box, or `null` when the panel shares a window or has none. */
  readonly box: Box | null;
}

function sameBox(a: Box, b: Box): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Records where each panel's own window is, for a later tear-out to come back to.
 *
 * A `null` box means "not its own window right now" and is deliberately *not*
 * written: a stacked tab must keep the box it had before it was stacked, which
 * is the whole point. Returns the map it was given when nothing changed, so a
 * desktop at rest does not churn a new object on every layout event.
 */
export function rememberFloats(
  states: WindowStates,
  sightings: readonly FloatSighting[],
): WindowStates {
  return sightings.reduce((acc, { panelId, box }) => {
    if (!box) return acc;
    const current = stateOf(acc, panelId).float;
    if (current && sameBox(current, box)) return acc;
    return withState(acc, panelId, { ...stateOf(acc, panelId), float: box });
  }, states);
}

/** Whether a box covers the whole desktop, which is what "maximised" looks like. */
export function fillsDesktop(box: Box, desktop: DesktopSize): boolean {
  return box.x === 0 && box.y === 0 && box.width === desktop.width && box.height === desktop.height;
}

/** Where a drag put a window, and where that window was before it started. */
export interface DragLanding {
  /** The box the window ended up in. */
  readonly box: Box;
  readonly desktop: DesktopSize;
  /** The box the window had before the drag, or `null` when it is not known. */
  readonly before: Box | null;
}

/**
 * What a finished drag does to a window's maximised state.
 *
 * Windows treats "filled by dragging to the top edge" and "maximised by the
 * button" as the same state, and this is where the two are made the same here.
 * Without it a top-edge snap only *moved* the window: `isMaximized` stayed
 * false, so the next press of the maximise button maximised a window that was
 * already the size of the desktop, stored the desktop as its restore box and
 * left it stuck full-screen for good.
 *
 * - A landing that fills the desktop maximises, remembering the pre-drag box.
 *   A window that is *already* maximised keeps the restore box it had, so
 *   dropping a maximised window back on the top edge does not overwrite the
 *   size it still has to come back to. With no pre-drag box to remember —
 *   and with one that already fills the desktop, which is nothing to restore
 *   to — the state is left alone rather than made un-restorable.
 * - Any other landing is not maximised, which is the half and quarter snaps
 *   and every free drag. A maximised window dragged away from the top drops
 *   the flag, as it does in Windows: it is somewhere else now, and its old
 *   restore box is not where the user wants it to go back to. A drag that
 *   ends where it began — a click on the title bar of a maximised window —
 *   still lands on the full desktop and so changes nothing.
 */
export function settleDrag(
  states: WindowStates,
  panelId: string,
  landing: DragLanding,
): WindowStates {
  const { box, desktop, before } = landing;
  if (!fillsDesktop(box, desktop)) {
    return isMaximized(states, panelId) ? setMaximized(states, panelId, null) : states;
  }
  if (isMaximized(states, panelId)) return states;
  if (!before || fillsDesktop(before, desktop)) return states;
  return setMaximized(states, panelId, before);
}

/** Maximises with the box to come back to, or un-maximises with `null`. */
export function setMaximized(
  states: WindowStates,
  panelId: string,
  restore: Box | null,
): WindowStates {
  return withState(states, panelId, { ...stateOf(states, panelId), restore });
}

/** Forgets a window, for when it is closed. */
export function forgetWindow(states: WindowStates, panelId: string): WindowStates {
  const next = { ...states };
  delete next[panelId];
  return next;
}

/** Drops the state of every window that is no longer in the layout. */
export function pruneStates(states: WindowStates, liveIds: readonly string[]): WindowStates {
  const live = new Set(liveIds);
  const next: Record<string, WindowState> = {};
  for (const [id, state] of Object.entries(states)) {
    if (live.has(id)) next[id] = state;
  }
  return next;
}

function asBox(value: unknown): Box | null {
  if (!value || typeof value !== "object") return null;
  const box = value as Record<string, unknown>;
  const numbers = [box.x, box.y, box.width, box.height];
  if (!numbers.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return {
    x: box.x as number,
    y: box.y as number,
    width: box.width as number,
    height: box.height as number,
  };
}

/**
 * Reads the saved state back.
 *
 * Anything that is not the shape we wrote is dropped rather than trusted: this
 * comes from localStorage, which another tab, an older build or a user can have
 * written, and a desktop that refuses to start is worse than one that forgets
 * which window was minimised.
 */
export function parseStates(raw: string | null): WindowStates {
  if (!raw) return NO_WINDOWS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NO_WINDOWS;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NO_WINDOWS;
  const next: Record<string, WindowState> = {};
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const state = value as Record<string, unknown>;
    next[id] = {
      minimized: state.minimized === true,
      restore: asBox(state.restore),
      float: asBox(state.float),
    };
  }
  return next;
}

export function serializeStates(states: WindowStates): string {
  return JSON.stringify(states);
}
