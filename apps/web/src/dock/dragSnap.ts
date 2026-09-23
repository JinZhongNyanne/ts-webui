import type { Box, DesktopSize } from "./box";
import { snapBox, snapZoneFor, type SnapPointer, type SnapZone } from "./snap";
import { windowSnapFor, type WindowSnap } from "./windowSnap";

/**
 * The one decision every drag on this desktop asks: given where the pointer is
 * and the box the window would take if it were let go right now, which snap —
 * if any — is on offer, and what box would it leave the window in?
 *
 * Two kinds of drag ask it, and they used to get two different answers. A
 * window dragged by the blank strip of its tab bar is a pointer drag that
 * dockview moves frame by frame (`useDesktop`'s `dragTransform`); a window
 * dragged by its TAB — which is what people actually grab — is a native HTML5
 * drag that dockview never moves at all until the drop (`useTabDrop`). The
 * decision lived inline in the first, so the second learnt none of it: no
 * zones, no window-to-window snapping, just a window landing wherever it fell.
 * It lives here now, and both call it, so the two can never disagree about
 * what a drag at a given place means. How the caller *measures* the place is
 * still its own business — the pointer events of the one, the `dragover`s of
 * the other — and so is waiting out the dwell (`snapDwell.ts`), since each
 * keeps its own clock.
 *
 * The precedence, and why:
 *
 * - **A screen-edge zone beats a window-to-window snap.** It is the larger and
 *   more deliberate gesture — the pointer has been taken all the way to the
 *   edge of the screen and is being shown half the desktop — whereas a window
 *   snap is a few pixels' correction to a free drag. Letting the nudge move a
 *   window that is about to be resized into a half would only make the preview
 *   and the window disagree.
 * - **The free-drag modifier suspends both**, which is what it is for.
 * - **Each is offered only while its taskbar switch is on** (`snapMode.ts`),
 *   and the caller reads the switches per frame so a flip mid-session applies
 *   at once.
 *
 * What a tab drag adds on top — a split of the window under the pointer, or a
 * tab bar to join — is decided before this is ever asked; see `useTabDrop`.
 *
 * Pure and DOM-free, like the two rules it composes.
 */

export interface DragSnapInput {
  /**
   * The pointer, in desktop coordinates, or `null` when it is not known. No
   * pointer arms no zone rather than one guessed from the window's box, which
   * would be a different gesture and the user's to ask for.
   */
  readonly pointer: SnapPointer | null;
  /** The box the window would take if it were dropped this frame, unsnapped. */
  readonly box: Box;
  /** The other visible windows it could line up with; see `visibleFloatWindows`. */
  readonly others: readonly Box[];
  readonly desktop: DesktopSize;
  /** The screen-edge switch, as it stands this frame. */
  readonly toEdges: boolean;
  /** The window-to-window switch, as it stands this frame. */
  readonly toWindows: boolean;
  /** True while the user holds the modifier that drags freely. */
  readonly suspended: boolean;
  /**
   * True while the top zone must stay armed whatever the pointer says: it is
   * over the Snap Layouts flyout, which hangs from the top edge and so draws the
   * pointer out of the edge band on the way to one of its tiles. The caller is
   * the one that can hit-test the flyout; it never sets this under the
   * free-drag modifier.
   */
  readonly holdTop: boolean;
  /** Last frame's answer, which gives each rule its hysteresis. */
  readonly current: DragSnap;
}

/** What a drag at this place is offered. Immutable; each frame gets a new one. */
export interface DragSnap {
  /** The screen-edge zone armed, or `null`. */
  readonly zone: SnapZone | null;
  /** The window-to-window snap, or `null`. Never set alongside a zone. */
  readonly window: WindowSnap | null;
  /**
   * A name for the target, for the dwell to tell one target from the next, or
   * `null` when there is nothing to wait for.
   */
  readonly target: string | null;
  /**
   * The box a release would leave the window in: the zone's, the gap-filling
   * box, or — for a window snap that fills nothing — the snapped position
   * itself.
   *
   * That last one used to be `null`, on the grounds that a snap which only
   * *moves* the window has nothing to preview. But a window that jumps into line
   * with no shadow first is exactly the unannounced snap the dwell was brought in
   * to prevent, and for a tab drag the window is not even under the pointer to
   * be seen jumping: the shadow is the only way to know where it will land.
   */
  readonly box: Box | null;
}

/** Nothing on offer: a drag in open desktop, or no drag at all. */
export const NO_DRAG_SNAP: DragSnap = Object.freeze({
  zone: null,
  window: null,
  target: null,
  box: null,
});

/** The screen-edge zone this frame arms, before window snapping has its say. */
function zoneFor(input: DragSnapInput): SnapZone | null {
  if (input.holdTop) return "top";
  if (!input.toEdges || !input.pointer) return null;
  return snapZoneFor({
    pointer: input.pointer,
    desktop: input.desktop,
    current: input.current.zone,
    suspended: input.suspended,
  });
}

/** What this frame of a drag is offered; see the module note for the precedence. */
export function dragSnapFor(input: DragSnapInput): DragSnap {
  const zone = zoneFor(input);
  if (zone) {
    return { zone, window: null, target: `zone:${zone}`, box: snapBox(zone, input.desktop) };
  }
  const window = input.toWindows
    ? windowSnapFor({
        box: input.box,
        others: input.others,
        current: input.current.window,
        suspended: input.suspended,
        desktop: input.desktop,
      })
    : null;
  if (!window) return NO_DRAG_SNAP;
  return { zone: null, window, target: `window:${window.key}`, box: window.fill ?? window.box };
}
