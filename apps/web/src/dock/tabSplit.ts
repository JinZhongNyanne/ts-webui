import { MIN_WINDOW_EXTENT, type Box } from "./box";

/**
 * "A tab dropped on a window's edge splits that window in half."
 *
 * A desktop has no panes, so dockview's own content quadrants had nothing to
 * mean: every one of them tore the tab out into a floating window at the drop
 * point, which left the new window lying *over* the one it was dropped on. What
 * a user aiming at a window's left edge is asking for is the thing every tiling
 * desktop does — the two windows side by side — so the edges now resize the
 * window underneath as well: the tab takes half of it, the window keeps the
 * other half, and neither hides the other.
 *
 * This is deliberately *not* the desktop's Aero snap. The desktop's zones split
 * the SCREEN and are a drag-with-the-pointer gesture behind two taskbar
 * toggles; this splits one WINDOW, is a drop on that window, and is always on.
 * Only the centre quadrant keeps the old tear-out.
 *
 * Pure and DOM-free, like `snap.ts` and `windowSnap.ts`: the hook hands in the
 * box it read off the window underneath and gets back the two boxes to apply.
 */

/** Both halves of a split, and a name for the one the drag is pointing at. */
export interface TabSplit {
  /** Where the dragged tab's new window goes. */
  readonly tab: Box;
  /** Where the window that was dropped on is pushed, so it leaves that room. */
  readonly under: Box;
  /**
   * `tab:<position>@<box>`; stable between frames, different for every
   * quadrant and every target window.
   *
   * The dwell in `snapDwell.ts` tells one target from another by this string
   * and nothing else, so it has to name both halves of the question: aiming at
   * a different edge, or at a different window, is aiming at something else.
   */
  readonly key: string;
}

/** The four edges a split understands, and which way each one cuts. */
const AXIS = {
  left: "x",
  right: "x",
  top: "y",
  bottom: "y",
} as const;

/** Whether the tab takes the near half (left/top) or the far one. */
const TAKES_NEAR = { left: true, top: true, right: false, bottom: false } as const;

type SplitPosition = keyof typeof AXIS;

function isSplitPosition(position: string): position is SplitPosition {
  return position in AXIS;
}

/**
 * The two boxes a drop on `position` produces, or `null` for a drop that is not
 * a split.
 *
 * The near half always rounds DOWN and the far half takes whatever is left, the
 * same discipline as `snapBox`: on an odd width the two still cover the target
 * exactly, with no seam of wallpaper between them and no overlapping pixel
 * column. Which half the *tab* gets does not change that split point — only
 * which side of it each window ends up on — so the same edge always cuts in the
 * same place whichever way it is approached.
 *
 * Both halves have to stay usable windows: if either would be narrower (or
 * shorter) than `MIN_WINDOW_EXTENT` the split is refused outright, and the drop
 * falls back to today's tear-out. Squeezing the window underneath down to a
 * title bar is not a gesture anyone asks for, and a preview promising it would
 * be a promise we should not keep.
 */
export function splitFor(target: Box, position: string): TabSplit | null {
  if (!isSplitPosition(position)) return null;
  const axis = AXIS[position];
  const extent = axis === "x" ? target.width : target.height;
  const start = axis === "x" ? target.x : target.y;
  if (!Number.isFinite(extent) || !Number.isFinite(start)) return null;
  const near = Math.floor(extent / 2);
  const far = extent - near;
  if (near < MIN_WINDOW_EXTENT || far < MIN_WINDOW_EXTENT) return null;
  const nearBox = boxOn(target, axis, start, near);
  const farBox = boxOn(target, axis, start + near, far);
  const takesNear = TAKES_NEAR[position];
  return {
    tab: takesNear ? nearBox : farBox,
    under: takesNear ? farBox : nearBox,
    key: keyOf(position, target),
  };
}

/** `target` with one axis replaced, which is all a half ever changes. */
function boxOn(target: Box, axis: "x" | "y", start: number, extent: number): Box {
  return axis === "x"
    ? { x: start, y: target.y, width: extent, height: target.height }
    : { x: target.x, y: start, width: target.width, height: extent };
}

/** See `TabSplit.key`. The box identifies the window without holding on to it. */
function keyOf(position: SplitPosition, target: Box): string {
  return `tab:${position}@${target.x},${target.y},${target.width},${target.height}`;
}

/** What the hook knows about a tab drag hovering a window, in plain values. */
export interface TabSplitDrop {
  /** dockview's drop location kind: 'tab' | 'header_space' | 'content' | 'edge'. */
  readonly kind: string;
  /** Quadrant of the window underneath: 'center' or one of the four edges. */
  readonly position: string;
  /** The box of the window underneath, or `null` when it could not be read. */
  readonly target: Box | null;
  /** True when the tab is being dragged over the very window it lives in. */
  readonly sameWindow: boolean;
}

/**
 * Whether this hover splits a window, and how — the whole decision, in one
 * pure function.
 *
 * Four things disqualify a split, and each of them leaves the drop exactly as
 * it behaves today:
 *
 * - Anything but a `content` drop. A tab bar and the header's void space really
 *   do stack the two windows into one frame, and the layout's outer `edge`
 *   belongs to the grid we do not use.
 * - The tab's own window. dockview merely reorders the tabs, and halving a
 *   window around a tab that never leaves it would be nonsense.
 * - A window whose box we could not read, which is a window we cannot resize.
 * - The centre quadrant, which keeps the tear-out-under-the-pointer that is the
 *   only other way to un-stack a tab.
 */
export function tabSplitFor(drop: TabSplitDrop): TabSplit | null {
  if (drop.kind !== "content") return null;
  if (drop.sameWindow || !drop.target) return null;
  return splitFor(drop.target, drop.position);
}
