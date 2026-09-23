import type { DockviewApi } from "dockview-vue";
import { MIN_WINDOW_EXTENT, type Box, type DesktopSize } from "./box";
import { visibleFloatWindows } from "./dockWindows";
import { floatingWindows, RESIZE_HANDLE_SELECTOR } from "./dockviewInternals";
import { resizeSnapFor } from "./resizeSnap";
import { snapToEdges, snapToWindows } from "./snapMode";
import {
  clampToDesktop,
  clampToLimits,
  followResize,
  linksFor,
  resizeEdgesOf,
  seamLimitsFor,
  type Edge,
  type Link,
  type SeamLimits,
  type Sibling,
} from "./snapGroup";

/**
 * Resizing one window of a snap group resizes the windows snapped to it, the way
 * Windows 11 does: the shared edge between windows parked side by side is a
 * seam, and dragging it makes the windows on one side grow by exactly what the
 * ones on the other give up. Every window with an edge on that seam line moves,
 * including any sitting alongside the dragged window on its own side — see
 * `snapGroup.ts`, which is where the seam is worked out.
 *
 * Everything DOM-ish about the gesture lives here; the geometry is
 * `snapGroup.ts` and the reach into dockview is `dockviewInternals.ts`.
 *
 * **Why a capture-phase press rather than a dockview event.** dockview has no
 * hook for a resize: `Overlay.setupResize` owns the whole gesture and only
 * announces the result, through `onDidChange` on each frame and `onDidChangeEnd`
 * on release. So the group has to be worked out from the one thing that happens
 * before the gesture starts — the `pointerdown` on the handle — and capture
 * phase is how we see that press before the overlay's own handler consumes it.
 * The links are computed once, there and then, and held for the drag: a group
 * that could shift underfoot mid-gesture would have windows jumping about as the
 * arithmetic changed its mind.
 *
 * **Why the drag is held back at the minimum, and why that is safe.** A snap
 * group must never be dragged into an overlap, so when any window on the seam
 * has nothing left to give, the dragged edge stops too: the frame's box is clamped
 * to the limit worked out at `pointerdown` and written straight back to
 * dockview's overlay inside the same tick.
 *
 * That sounds like fighting the library, and it would be if `Overlay.setupResize`
 * measured the window it is resizing on every move. It does not. It captures a
 * `startPosition` — the pointer position and the overlay's size — on the *first*
 * pointermove of the gesture, and every later frame derives its box from that
 * snapshot plus the current pointer, never from the element's present rect. So
 * writing a smaller box back mid-gesture cannot feed into dockview's next frame:
 * it recomputes the same unclamped box from the same snapshot, we clamp it to the
 * same limit, and the window sits still while the pointer runs on. The clamp is
 * therefore idempotent rather than a tug of war, and it disappears the moment the
 * pointer comes back inside the limit.
 *
 * Two things that would break this, and are the things to check on a dockview
 * upgrade: `setupResize` re-reading `getBoundingClientRect` per move (the clamp
 * would then compound, and the window would creep), and the resize frames
 * arriving asynchronously (the write-back would land a frame late and judder).
 *
 * **Snapping while resizing.** The same press also makes the dragged edges snap,
 * the way the user asked for it: "calculate the snap position and wait until
 * release, then resize". Each frame works out where the edges would snap
 * (`resizeSnap.ts`, which is where the rules and the reasoning live) and paints
 * that box as the desktop's snap preview; the edge itself goes on following the
 * pointer, and the box is written back once, on `pointerup`, followed by the
 * windows on any seam and a single save. A release with nothing in reach writes
 * nothing at all, so the window is exactly where dockview's own gesture left it.
 *
 * There is no dwell. A move drag waits half a second before a snap arms
 * (`snapDwell.ts`) because a window passing *over* a target on its way somewhere
 * else must not be caught by it; a resized edge is aimed, not carried, and a user
 * who stops it 5px short of a neighbour and lets go has meant the neighbour. A
 * wait would make exactly that — drag near, let go — do nothing, which is the
 * opposite of what was asked for. So the preview appears the moment an edge is
 * in reach, is withdrawn the moment it leaves, and is only ever on screen while
 * a release would commit it — which keeps `snap-preview` meaning what it means
 * everywhere else on this desktop: let go, and this happens.
 *
 * **Seams come first.** An edge that is on a seam at `pointerdown` belongs to the
 * seam for the whole gesture and never snaps. The order within a frame is: the
 * seam clamp, then the neighbours, then the snap of whichever edges are *not* on
 * a seam, computed from the clamped box. Since only a seamed edge has limits and
 * a seamed edge never snaps, the snap cannot carry an edge past the clamp; and
 * it refuses any target that would leave the window under `MIN_WINDOW_EXTENT`,
 * so it cannot squeeze anything either. On release the neighbours are moved from
 * the committed box, which for a corner drag only differs from the last frame on
 * the free axis — the one no seam neighbour follows — so they land where the
 * last frame already put them.
 *
 * **When it is on.** Whenever the user has any snapping switched on
 * (`snapMode.ts`), because a snap group is exactly what those switches make —
 * two Aero halves being the canonical one. There is no third switch: a user who
 * has turned off all snapping wants windows that do not touch each other, and
 * that is the only case in which this does nothing.
 */

/**
 * What the hook needs of the desktop — a subset of `Desktop`, so the hook can be
 * tested without one and so it is obvious that nothing here reaches past the
 * desktop's public surface.
 */
export interface SnapGroupDesktop {
  readonly api: { readonly value: DockviewApi | null };
  /**
   * The desktop's one snap preview, which a resize paints its snapped box into.
   * The same rectangle a move drag uses, so a resize snap looks like every other
   * promise the desktop makes.
   */
  readonly snapPreview: { value: Box | null };
  isMinimized(panelId: string): boolean;
  desktopSize(): DesktopSize | null;
  moveWindow(panelId: string, box: Box): void;
  saveLayout(): void;
}

/** The element the press is listened for on; `window` in the app. */
export interface PressTarget {
  addEventListener(type: string, listener: (event: never) => void, options?: unknown): void;
  removeEventListener(type: string, listener: (event: never) => void, options?: unknown): void;
}

export interface SnapGroups {
  /** Starts watching for resize presses. Safe to call once. */
  install(target?: PressTarget): void;
  /** Stops watching and abandons any drag in flight. */
  dispose(): void;
}

/** The events that end a resize drag, including the ones that end it abnormally. */
const END_EVENTS = ["pointerup", "pointercancel", "blur"] as const;

/**
 * What one resize drag was found to be at `pointerdown`, held for its duration.
 *
 * Frozen for the gesture on purpose: links, sibling boxes and seam limits that
 * could change underfoot would have windows jumping about as the arithmetic
 * changed its mind mid-drag.
 */
interface ResizeDrag {
  readonly links: readonly Link[];
  readonly siblings: readonly Sibling[];
  /** How far each dragged edge may travel; an absent edge is unbounded. */
  readonly limits: SeamLimits;
  /** The edges the pressed handle drags. */
  readonly edges: readonly Edge[];
  /** The dragged edges that are on a seam, and so are the seam's and never snap. */
  readonly seams: readonly Edge[];
  /**
   * The desktop, measured once: it does not change size under a held pointer,
   * and one read per gesture is cheaper than one per frame.
   */
  readonly desktop: DesktopSize | null;
  /** The two switches as they were at the press, so a gesture obeys one rule. */
  readonly toWindows: boolean;
  readonly toEdges: boolean;
}

/** True when two boxes are the same rectangle, or both absent. */
function sameBox(a: Box | null, b: Box | null): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** An element-ish thing we can walk up from. Never assumes a live DOM. */
interface Selectable {
  closest(selector: string): unknown;
}

function selectable(value: unknown): Selectable | null {
  const node = value as Selectable | null | undefined;
  return typeof node?.closest === "function" ? node : null;
}

/** An element's class list as one string, however the host spells it. */
function classesOf(element: unknown): string {
  const node = element as { className?: unknown; getAttribute?: (name: string) => unknown };
  if (typeof node?.className === "string") return node.className;
  const attribute = typeof node?.getAttribute === "function" ? node.getAttribute("class") : null;
  return typeof attribute === "string" ? attribute : "";
}

export function useSnapGroups(desktop: SnapGroupDesktop): SnapGroups {
  /** Where the press and the end of the drag are listened for; set by `install`. */
  let pressTarget: PressTarget | null = null;
  /** Undone by `dispose`; one press listener for the desktop's whole life. */
  let uninstall: (() => void) | null = null;
  /** The drag in flight: what to unsubscribe, and what to stop doing. */
  let drag: (() => void) | null = null;
  /**
   * True while we are writing this frame's boxes back.
   *
   * Now load-bearing rather than defensive: holding the seam repositions the
   * *dragged* window, whose `onDidChange` is exactly the event we are inside, so
   * without this the first clamped frame would recurse until the stack gave out.
   * It covers the neighbours as well, for the day one of their events is
   * listened to too.
   */
  let applying = false;

  /**
   * Whether this hook put the preview up, so that it only ever takes down its
   * own: the rectangle is the desktop's, and a press must not wipe one a move
   * drag is showing.
   */
  let previewing = false;

  function preview(box: Box | null): void {
    if (!box && !previewing) return;
    previewing = box !== null;
    if (!sameBox(desktop.snapPreview.value, box)) desktop.snapPreview.value = box;
  }

  /** Moves the windows on the seam to the boxes worked out for them. */
  function moveAttached(moved: readonly Sibling[], size: DesktopSize | null): void {
    for (const sibling of moved) {
      // `moveWindow` rather than `snapTo`, for the same reason the dragged
      // window uses `position`: this is somebody else's gesture, and a
      // neighbour that followed a seam has asked to be neither raised nor
      // saved. Raising it would activate it — putting it in front of the
      // window still under the pointer and telling the app the user had
      // switched windows — on every frame, and the saving is done once when
      // the gesture ends.
      //
      // With no measurable desktop the derived box is still the best answer we
      // have — it came from live geometry — so it is applied unclamped rather
      // than the neighbour being left behind mid-drag.
      desktop.moveWindow(sibling.id, size ? clampToDesktop(sibling.box, size) : sibling.box);
    }
  }

  /**
   * One frame: holds the dragged window inside the seam's limits if it went past,
   * then puts every window attached to the seam where that seam leaves them.
   * Returns the box the dragged window is left in, or `null` for a frame there
   * was nothing to read of.
   *
   * Both halves are recomputed from the boxes captured at the start of the drag,
   * so a frame is idempotent: the same pointer position always means the same
   * boxes, however many frames dockview fires and however far past the limit the
   * pointer has run.
   */
  function holdSeam(
    windows: ReturnType<typeof floatingWindows>,
    group: unknown,
    { links, siblings, limits, desktop: size }: ResizeDrag,
  ): Box | null {
    const asked = windows.boxOf(group);
    if (!asked) return null;
    const after = clampToLimits(asked, limits, MIN_WINDOW_EXTENT);
    const moved = followResize(links, siblings, after, MIN_WINDOW_EXTENT);
    // Nothing to hold and no neighbour to move: a frame the group is indifferent
    // to, and `clampToLimits` hands back the very box it was given.
    if (after === asked && moved.length === 0) return asked;
    applying = true;
    try {
      // The dragged window first, so a neighbour never sees a frame in which the
      // seam has moved but the window it belongs to has not. `position` rather
      // than `snapTo`: this is dockview's own gesture still in flight, so there
      // is no maximised state to settle and nothing to save until it ends.
      if (after !== asked && !windows.position(group, after)) {
        // The overlay refused the write, so the seam cannot be held this frame.
        // The attached windows are left alone too rather than being moved to a
        // seam the dragged window is not actually at.
        return asked;
      }
      moveAttached(moved, size);
      return after;
    } finally {
      applying = false;
    }
  }

  /**
   * One frame of the gesture: the seam first, then the snap of the free edges
   * from wherever the seam left the window. Returns the box a release would
   * commit, or `null` when nothing is in reach — and `undefined` for the
   * re-entrant frame our own write-back fires, which is not a frame of the
   * user's at all and must not replace the answer the real one gave.
   */
  function frame(
    windows: ReturnType<typeof floatingWindows>,
    group: unknown,
    session: ResizeDrag,
  ): Box | null | undefined {
    if (applying) return undefined;
    const box = holdSeam(windows, group, session);
    const snapped = box
      ? resizeSnapFor({
          box,
          edges: session.edges,
          seams: session.seams,
          others: session.siblings.map((sibling) => sibling.box),
          desktop: session.desktop,
          toWindows: session.toWindows,
          toEdges: session.toEdges,
        })
      : null;
    preview(snapped);
    return snapped;
  }

  /**
   * The release: the snapped box written back once, then the windows on the
   * seam moved to match it. The seam's neighbours are worked out from the
   * committed box rather than left where the last frame put them, so a corner
   * snap that moved only the free axis still leaves every window consistent
   * with the box the dragged one actually took.
   */
  function commit(
    windows: ReturnType<typeof floatingWindows>,
    group: unknown,
    session: ResizeDrag,
    box: Box,
  ): void {
    applying = true;
    try {
      if (!windows.position(group, box)) return;
      moveAttached(
        followResize(session.links, session.siblings, box, MIN_WINDOW_EXTENT),
        session.desktop,
      );
    } finally {
      applying = false;
    }
  }

  /** Ends the drag in flight, if any. Idempotent. */
  function end(): void {
    const stop = drag;
    drag = null;
    if (stop) stop();
  }

  function onPointerDown(event: { target?: unknown }): void {
    // A previous drag whose release we somehow missed must not outlive this press.
    end();
    // All snapping off means the user wants windows that ignore each other.
    if (!snapToEdges() && !snapToWindows()) return;
    const live = desktop.api.value;
    if (!live) return;
    const pressed = selectable(event?.target);
    const handle = pressed && selectable(pressed.closest(RESIZE_HANDLE_SELECTOR));
    if (!handle) return;
    const edges = resizeEdgesOf(classesOf(handle));
    if (edges.length === 0) return;
    const windows = floatingWindows(live);
    if (!windows.available) return;
    const group = windows.groupOfElement(handle);
    if (!group) return;
    const dragged = windows.boxOf(group);
    if (!dragged) return;
    // The windows this resize may push about, which is the same set a drag lines
    // itself up against: `visibleFloatWindows` is where that rule lives, and a
    // `FloatWindow` is exactly the `Sibling` the seam arithmetic asks for.
    const siblings: readonly Sibling[] = visibleFloatWindows(live, group, (id) =>
      desktop.isMinimized(id),
    );
    const links = linksFor(dragged, edges, siblings);

    // Listened to even with nothing on the seam, because every resize may now
    // snap; a frame with no seam and nothing in reach costs a little arithmetic
    // and writes nothing.
    const session: ResizeDrag = {
      links,
      siblings,
      limits: seamLimitsFor(links, siblings, MIN_WINDOW_EXTENT, dragged),
      edges,
      seams: edges.filter((edge) => links.some((link) => link.edge === edge)),
      desktop: desktop.desktopSize(),
      toWindows: snapToWindows(),
      toEdges: snapToEdges(),
    };
    /** What a release would commit, as of the last frame of the user's. */
    let pending: Box | null = null;
    const sub = windows.onChange(group, () => {
      const answer = frame(windows, group, session);
      if (answer !== undefined) pending = answer;
    });
    const finish = (event: { type?: unknown }): void => {
      const snapped = pending;
      end();
      // Only a real release commits: a cancelled gesture, or the window losing
      // focus mid-drag, is not the user letting go over the preview.
      const released = event?.type === "pointerup";
      if (released && snapped) commit(windows, group, session, snapped);
      // One save for the whole gesture: the neighbours were moved frame by frame
      // without saving, and a snap is written above, so this is the only write
      // any of them gets. A plain resize that neither moved a seam nor snapped
      // is dockview's alone, and the desktop saves that one itself.
      if (links.length > 0 || (released && snapped)) desktop.saveLayout();
    };
    const listeners = END_EVENTS.map((type) => {
      const listener = finish as (event: never) => void;
      pressTarget?.addEventListener(type, listener);
      return () => pressTarget?.removeEventListener(type, listener);
    });
    drag = () => {
      sub.dispose();
      for (const remove of listeners) remove();
      preview(null);
    };
  }

  return {
    install(target) {
      if (uninstall) return;
      const resolved = target ?? (typeof window === "undefined" ? null : window);
      if (!resolved) return;
      pressTarget = resolved as PressTarget;
      const listener = onPointerDown as (event: never) => void;
      // Capture phase: dockview's handle listener is on the handle itself, so
      // this has to run on the way down to see the press at all.
      pressTarget.addEventListener("pointerdown", listener, true);
      uninstall = () => {
        pressTarget?.removeEventListener("pointerdown", listener, true);
        pressTarget = null;
      };
    },
    dispose() {
      end();
      const undo = uninstall;
      uninstall = null;
      if (undo) undo();
    },
  };
}
