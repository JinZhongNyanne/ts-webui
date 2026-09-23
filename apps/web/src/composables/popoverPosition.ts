/**
 * Where a popover has to sit once it has been teleported to `<body>`.
 *
 * Panels live inside dock windows, which clip their content and are themselves
 * blurred (a `backdrop-filter` ancestor becomes the containing block of even a
 * fixed child, see styles/base.css), so a popover anchored inside one is cut
 * off at the window's edge. The fix is to take the popover out of the window
 * and place it against the viewport — which means working out here what the
 * absolute offsets used to do in CSS.
 *
 * Pure on purpose: it takes boxes and returns a point, so the flipping can be
 * tested without a browser. The push back inside the viewport is `clampAxis`,
 * the context menu's own, rather than a second copy of it; only the flip is
 * different, because a popover flips to the other side of its trigger's box
 * where the menu flips around a click point.
 */
import { clampAxis, EDGE_MARGIN } from "../stores/contextMenuGeometry";

/** A trigger's box on screen, as `getBoundingClientRect` gives it. */
export interface TriggerBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * The space a popover may occupy, in the coordinates a `position: fixed` box is
 * laid out in.
 *
 * It is not always the window: a phone's on-screen keyboard shrinks the *visual*
 * viewport and leaves the layout viewport exactly as it was, and a pinch-zoomed
 * page shifts the visible box sideways as well. `left` and `top` are therefore
 * the visible box's own origin, and default to the window's when nothing has
 * moved.
 */
export interface ViewportBox extends Size {
  readonly left?: number;
  readonly top?: number;
}

/** Viewport coordinates for a `position: fixed` popover. */
export interface Position {
  readonly left: number;
  readonly top: number;
}

/**
 * Which edges line up: `start` puts the popover's left edge on the trigger's
 * (the soundboard tile, the chat composer), `end` its right edge on the
 * trigger's right (a control at the end of the status bar).
 */
export type PopoverAlign = "start" | "end";

/** Gap left between the trigger and the popover; what the old CSS offsets were. */
export const POPOVER_GAP = 8;

/**
 * The layer teleported popovers live on: the app's "floats above the dock" step,
 * shared with `.log-float` in App.vue. Above every dock window, because the
 * shell isolates `.dock-wrap` into its own stacking context, and below the
 * mobile sheets (60) and the dialogs (70) — a confirmation opened from inside a
 * popover must still cover it.
 */
export const POPOVER_LAYER = 50;

/**
 * Places `panel` above `trigger`, flipped below it when there is no room above
 * and then pushed inside the viewport on both axes.
 *
 * Above is the preference because every popover here hangs off a control at the
 * bottom of its panel; a popover that fits on neither side stays above, where
 * its own header is what the clamp keeps on screen.
 */
export function anchorAbove(
  trigger: TriggerBox,
  panel: Size,
  viewport: ViewportBox,
  align: PopoverAlign = "start",
): Position {
  const originX = viewport.left ?? 0;
  const originY = viewport.top ?? 0;
  const left = align === "end" ? trigger.x + trigger.width - panel.width : trigger.x;
  const above = trigger.y - POPOVER_GAP - panel.height;
  const below = trigger.y + trigger.height + POPOVER_GAP;
  const fitsAbove = above - originY >= EDGE_MARGIN;
  const fitsBelow = below + panel.height <= originY + viewport.height - EDGE_MARGIN;
  const top = fitsAbove || !fitsBelow ? above : below;
  // Clamped inside the visible box and then put back where it sits on the page.
  return {
    left: clampAxis(left - originX, panel.width, viewport.width) + originX,
    top: clampAxis(top - originY, panel.height, viewport.height) + originY,
  };
}

/**
 * The largest a popover may draw itself, so that one too big for the space
 * scrolls its own body instead of running off the screen. It is the visible box
 * less the edge margin twice — the clamps above can only slide a popover, and a
 * sticker grid is easily taller than a phone with its keyboard up.
 */
export function popoverLimits(viewport: Size): { maxWidth: number; maxHeight: number } {
  return {
    maxWidth: Math.max(0, viewport.width - EDGE_MARGIN * 2),
    maxHeight: Math.max(0, viewport.height - EDGE_MARGIN * 2),
  };
}
