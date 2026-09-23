import { shallowRef, type ShallowRef } from "vue";

/**
 * Which kinds of snapping a floating window's drag obeys, as two independent
 * user preferences:
 *
 * - **to the screen's edges** — Aero Snap, where the pointer at an edge gives
 *   the window half the desktop, a corner a quarter and the top the lot
 *   (`snap.ts`). Off by default. It is the more drastic of the two — a window
 *   let go near the edge of the screen is resized to half of it — and on a
 *   desktop whose windows are mostly dragged by their tabs, which is what people
 *   grab, taking a tab towards the edge of the screen is as often a way of
 *   getting it *out of the way* as a request to fill half the screen with it.
 *   So it is there for whoever wants it, one switch away, and asks first.
 * - **to the other windows' edges** — the magnetic alignment in
 *   `windowSnap.ts`, which nudges a dragged window flush against its
 *   neighbours or into line with them, and fills the pocket it was put in. On
 *   by default: it only ever acts on a window already being put beside another,
 *   after the drag has rested there (`snapDwell.ts`) and with its shadow shown
 *   first, so what it does is always what the user was visibly lining up.
 *
 * Only the defaults changed, not what was saved. Each switch is stored the
 * moment it is flipped, so someone who already chose either keeps the choice;
 * only a switch nobody has touched follows the new default.
 *
 * Two switches rather than one three-way choice because they answer different
 * wishes and compose: a user may want either, both or neither.
 *
 * Published as module-level refs, the way `maximizedWindows.ts` publishes window
 * state, for the same reason: the taskbar switches and the drag hook are not in
 * the same component tree — dockview builds part of the shell itself — so a
 * preference cannot be handed down as a prop. A module-level ref is a singleton,
 * which is what the desktop is: one dock, one set of windows, one set of snap
 * rules.
 *
 * Storage is the house pattern for small desktop preferences (see
 * `useWallpaper.ts`): one short string each, every failure swallowed, the
 * default on anything that is not what we wrote. A blocked or full localStorage
 * must cost the user a remembered switch, never a working desktop.
 */

/** Where the screen-edge switch is saved. */
export const SNAP_EDGES_KEY = "jinz.desktop.snapToEdges.v1";

/** Where the window-to-window switch is saved. */
export const SNAP_WINDOWS_KEY = "jinz.desktop.snapToWindows.v1";

/** Off by default: resizing a window to half the screen is asked for, not assumed. */
export const DEFAULT_SNAP_TO_EDGES = false;

/** On by default: lining windows up is announced by its shadow and never drastic. */
export const DEFAULT_SNAP_TO_WINDOWS = true;

/** The two values we write, so a stray string never reads as either state. */
const ON = "true";
const OFF = "false";

/** A saved flag, or `fallback` for anything we did not write. */
function loadFlag(
  key: string,
  fallback: boolean,
  storage: Pick<Storage, "getItem"> = localStorage,
): boolean {
  try {
    const raw = storage.getItem(key);
    if (raw === ON) return true;
    if (raw === OFF) return false;
    return fallback;
  } catch {
    /* blocked storage: the default, then */
    return fallback;
  }
}

/** Remembers a flag for the next visit; a refusal is not worth reporting. */
function saveFlag(key: string, on: boolean, storage: Pick<Storage, "setItem">): void {
  try {
    storage.setItem(key, on ? ON : OFF);
  } catch {
    /* ignore quota and private-window errors: the switch still holds for this session */
  }
}

/** The saved screen-edge choice, or the default. */
export function loadSnapToEdges(storage: Pick<Storage, "getItem"> = localStorage): boolean {
  return loadFlag(SNAP_EDGES_KEY, DEFAULT_SNAP_TO_EDGES, storage);
}

/** The saved window-to-window choice, or the default. */
export function loadSnapToWindows(storage: Pick<Storage, "getItem"> = localStorage): boolean {
  return loadFlag(SNAP_WINDOWS_KEY, DEFAULT_SNAP_TO_WINDOWS, storage);
}

export function saveSnapToEdges(on: boolean, storage: Pick<Storage, "setItem"> = localStorage) {
  saveFlag(SNAP_EDGES_KEY, on, storage);
}

export function saveSnapToWindows(on: boolean, storage: Pick<Storage, "setItem"> = localStorage) {
  saveFlag(SNAP_WINDOWS_KEY, on, storage);
}

/**
 * The live preferences. Read at import rather than lazily, so nothing has to
 * touch storage from inside a render.
 */
const toEdges: ShallowRef<boolean> = shallowRef(loadSnapToEdges());
const toWindows: ShallowRef<boolean> = shallowRef(loadSnapToWindows());

/**
 * Whether a drag snaps to the screen's edges.
 *
 * Reactive: call it inside a `computed` or a template and it re-runs when the
 * switch is flipped.
 */
export function snapToEdges(): boolean {
  return toEdges.value;
}

/** Whether a drag snaps to the other windows' edges. Reactive, as above. */
export function snapToWindows(): boolean {
  return toWindows.value;
}

/** Flips the screen-edge switch, and remembers it. */
export function setSnapToEdges(on: boolean): void {
  toEdges.value = on;
  saveSnapToEdges(on);
}

/** Flips the window-to-window switch, and remembers it. */
export function setSnapToWindows(on: boolean): void {
  toWindows.value = on;
  saveSnapToWindows(on);
}
