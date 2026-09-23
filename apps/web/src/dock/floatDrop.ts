/**
 * "A tab dropped anywhere that is not a tab bar becomes its own window."
 *
 * dockview on its own only lets a dragged tab join a group (tab bar or content
 * centre) or split one (content edges). A desktop has no panes to split, so we
 * re-purpose the whole of a window's content — centre and edges alike — and the
 * empty desktop behind the windows: a tab released on any of them tears out
 * into a floating window at the drop point. Only the tab bar still joins.
 *
 * Pure: the decision and the box maths take plain values, so they are testable
 * without a live dock or a real drag.
 */

import { clampNumber, fitSize, type Box } from "./box";

export type { Box };

/**
 * The in-flight panel drag, as dockview describes it — `getPanelData()` on the
 * desktop, `event.getData()` inside the dock. Undefined for a foreign drag
 * (a file from the OS, text from another component).
 */
export type PanelDragData =
  | {
      readonly viewId: string;
      readonly groupId: string;
      readonly panelId: string | null;
      readonly tabGroupId?: string;
    }
  | undefined;

/** What dockview tells us about a drop that is about to happen. */
export interface DropInfo {
  /** dockview's drop location kind: 'tab' | 'header_space' | 'content' | 'edge'. */
  readonly kind: string;
  /**
   * Quadrant of the drop target: 'center' or one of the four edges. Carried
   * because dockview reports it, and read by nothing: every quadrant of a
   * window's content floats the same way.
   */
  readonly position: string;
  /** The drag payload, or undefined for a foreign drag (files, text…). */
  readonly data: PanelDragData;
}

/** What to float: a single tab, or a whole group dragged by its header. */
export type FloatTarget =
  | { readonly type: "panel"; readonly panelId: string }
  | { readonly type: "group"; readonly groupId: string };

/**
 * Decides whether a drop should float instead of docking.
 *
 * Only drags that came from this very dock count, and only over a group's
 * *content* — the tab bar and the header's void space still stack windows.
 * Every part of the content floats, edges included: splitting a window's own
 * interior into two panes is not a thing a desktop window does, and vetoing
 * the edges instead left a band around each window where a drop did nothing.
 *
 * A tab-group chip (a subset of a group's tabs) is left to dockview, which has
 * no way to float it as one window.
 */
export function floatTargetForDrop(drop: DropInfo, dockId: string): FloatTarget | null {
  if (drop.kind !== "content") return null;
  const data = drop.data;
  if (!data || data.viewId !== dockId) return null;
  if (data.panelId) return { type: "panel", panelId: data.panelId };
  if (data.tabGroupId) return null;
  return { type: "group", groupId: data.groupId };
}

/** What we know about a drag released on the empty desktop. */
export interface DesktopDropInfo {
  /** The in-flight drag payload. */
  readonly data: PanelDragData;
  /** True when the dragged tab is the only one left in its window. */
  readonly alone: boolean;
}

/**
 * What a drag released on the empty desktop does.
 *
 * - `tear` takes the tab out of the window it shares and gives it one of its
 *   own at the drop point.
 * - `move` leaves the window as it is and puts it at the drop point, which is
 *   what a tab *alone* in its window asks for: it already is its own window,
 *   and tearing it out would destroy and rebuild the very thing being dragged,
 *   reloading everything it holds for no gain.
 */
export type DesktopDrop =
  | { readonly type: "tear"; readonly panelId: string }
  | { readonly type: "move"; readonly panelId: string };

/**
 * Decides what a drag released on the empty desktop does, or `null` for a drag
 * the desktop must not touch.
 *
 * Dragging a tab onto the desktop means one thing to the user — "put that
 * window here" — so it is answered whether or not the tab has company. It used
 * to be refused outright when the tab was alone in its window, and a refusal
 * here is *silent*: the window stays put, nothing moves, nothing says why. A
 * gesture that does nothing at all is the bug; the window moves instead.
 *
 * A whole-group drag (`panelId` null) is still left to dockview: a window
 * dragged by its header is already being moved, by pointer events that never
 * reach this handler. Tab-group chips (a subset of a group's tabs) are left to
 * dockview too, which has no way to float one as a single window.
 *
 * Anything that is not this dock's own panel drag — an OS file, another
 * component's drag — is refused, so the desktop never swallows it.
 */
export function desktopDropFor(drop: DesktopDropInfo, dockId: string): DesktopDrop | null {
  const data = drop.data;
  if (!data || data.viewId !== dockId) return null;
  if (data.tabGroupId || !data.panelId) return null;
  return { type: drop.alone ? "move" : "tear", panelId: data.panelId };
}

/** Preferred size of a window floated by a drop. */
export const FLOAT_WIDTH = 460;
export const FLOAT_HEIGHT = 340;
/** How far above the cursor the window's top edge lands, so its tab bar is under the pointer. */
export const FLOAT_GRAB_OFFSET = 16;
/** Never float smaller than this, even in a tiny dock. */
const MIN_SIZE = 160;
/** A floating window never takes more than this share of the dock. */
const MAX_SHARE = 0.8;

/**
 * The floating window's box for a drop at `(pointX, pointY)`, both relative to
 * the dock's top-left corner.
 *
 * The window is centred horizontally on the pointer with its tab bar just under
 * it, shrunk to fit a small dock, and pushed back inside the dock so it can
 * always be grabbed again.
 *
 * `preferred` is the size a window that already exists wants to keep; without
 * one the window gets the default float size, capped at a share of the dock so
 * a fresh float never swallows the desktop. A size a window really had is only
 * capped by the dock itself: a half-screen window is taller than that share,
 * and shrinking it on the way out of a tab bar would be losing something.
 */
export function floatBoxAt(
  pointX: number,
  pointY: number,
  dockWidth: number,
  dockHeight: number,
  preferred: { readonly width: number; readonly height: number } | null = null,
): Box {
  const share = preferred ? 1 : MAX_SHARE;
  const width = fitSize(usableLength(preferred?.width, FLOAT_WIDTH), dockWidth, MIN_SIZE, share);
  const height = fitSize(
    usableLength(preferred?.height, FLOAT_HEIGHT),
    dockHeight,
    MIN_SIZE,
    share,
  );
  return {
    x: clampNumber(Math.round(pointX - width / 2), 0, Math.max(0, dockWidth - width)),
    y: clampNumber(Math.round(pointY - FLOAT_GRAB_OFFSET), 0, Math.max(0, dockHeight - height)),
    width,
    height,
  };
}

/** A remembered length, or `fallback` for one that is missing or nonsense. */
function usableLength(length: number | undefined, fallback: number): number {
  if (length === undefined || !Number.isFinite(length)) return fallback;
  return Math.max(length, MIN_SIZE);
}

/**
 * Where a torn-out tab's window goes: under the pointer, at the size that
 * panel's own window had — or, for a panel that has never had one, at the size
 * a fresh float gets.
 *
 * The POINTER decides the position: a tab dragged out of a tab bar lands where
 * it was dropped, like every other float-at-pointer gesture, because a window
 * that reappears somewhere else looks like it was lost. The remembered SIZE is
 * still honoured — moving a tab in and out of a tab bar must not resize the
 * window it came from — and is fitted to the dock it is coming back into: the
 * desktop may have been resized, or the box saved on a larger screen, and a
 * window that lands mostly off-screen cannot be grabbed again.
 */
export function tearOutBox(
  remembered: Box | null,
  pointX: number,
  pointY: number,
  dockWidth: number,
  dockHeight: number,
): Box {
  return floatBoxAt(pointX, pointY, dockWidth, dockHeight, remembered);
}

/** The two sizes a tab's window-to-be can take; see `landingBoxFor`. */
export interface LandingSizes {
  /** The box the tab's window has now, which a moved window keeps the size of. */
  readonly current: Box | null;
  /** The box the tab's own window last had, which a torn-out one comes back at. */
  readonly remembered: Box | null;
}

/**
 * The window a tab drop leaves at `(pointX, pointY)`, before any snap has had a
 * say — for a `move` its own window at the size it has, for a `tear` a new one
 * at the size `tearOutBox` gives.
 *
 * One function because two moments ask it and must agree. The drop asks it to
 * place the window. The drag asks it every frame, because a tab drag moves
 * nothing until it is let go — HTML5 drag-and-drop only carries a ghost image
 * — so the window-to-be is the only box there is for window-to-window snapping
 * to line up with its neighbours; sized any differently, the shadow the drag
 * shows would be a promise the release did not keep.
 */
export function landingBoxFor(
  type: DesktopDrop["type"],
  sizes: LandingSizes,
  pointX: number,
  pointY: number,
  dockWidth: number,
  dockHeight: number,
): Box {
  const preferred = type === "move" ? sizes.current : sizes.remembered;
  return tearOutBox(preferred, pointX, pointY, dockWidth, dockHeight);
}
