import type { ShallowRef } from "vue";
import { getPanelData, type DockviewApi } from "dockview-vue";
import { usableDesktop, type Box } from "./box";
import { floatingWindows } from "./dockviewInternals";
import { overDesktop, tabLandingAt, visibleFloatWindows, type RememberedBox } from "./dockWindows";
import { dragSnapFor, NO_DRAG_SNAP, type DragSnap } from "./dragSnap";
import { desktopDropFor, floatTargetForDrop, type PanelDragData } from "./floatDrop";
import { DWELL_MS, dwell, NO_DWELL, type DwellState } from "./snapDwell";
import { dwellingFor, type SnapDwelling } from "./snapFeedback";
import { snapToEdges, snapToWindows } from "./snapMode";
import { tabSplitFor, type TabSplit } from "./tabSplit";

/**
 * The live half of a tab drag: watching it frame by frame, deciding what a
 * release there would do, waiting out the dwell, and showing the outline and
 * then the preview of the box that would result.
 *
 * A tab drag can aim at three kinds of thing, and they are tried in this order:
 *
 * 1. **A tab bar** (or the header's void space) joins the window — dockview's
 *    own stacking. Nothing here snaps it: the window it would join is the
 *    target, and no box of ours means anything.
 * 2. **A window's edge** splits that window (`tabSplit.ts`). This outranks the
 *    desktop's own snaps because it is aimed at one particular window, the one
 *    under the pointer — which is also why it wins over a window-to-window snap
 *    to that very window: lining up beside a window and taking half of it are
 *    both on offer there, and the one the user pointed *into* is the split.
 *    It wins over a screen-edge zone too, even when the window is flush with the
 *    screen's edge: a split is always on, the zones are a switch, and the split
 *    is the gesture that answers the window actually under the pointer.
 * 3. **Anywhere else a release lands a window** — the empty desktop, or a
 *    window's centre (which tears out) — gets the desktop's own snaps, the
 *    screen-edge zones and window-to-window alignment, through `dragSnap.ts`:
 *    the same decision, with the same precedence and the same switches, that a
 *    window dragged by its tab bar gets. The dragged box is the window-to-be,
 *    sized and placed exactly as the drop would place it (`tabLandingAt`),
 *    because a tab drag moves nothing until it is let go.
 *
 * The Snap Layouts flyout is the one thing a tab drag does not get: it is
 * hit-tested with pointer coordinates that a native drag does not deliver, so
 * the top edge simply fills the desktop.
 *
 * Why this is its own hook rather than part of `useDesktop`'s drag tracking:
 * **a tab drag is native HTML5 drag-and-drop, and a window drag is not.** While
 * Chromium is running a native drag it fires no `pointermove` and no
 * `pointerup` at all, so the cursor `useDesktop` tracks stands still at
 * wherever the drag began, and `useDesktop`'s whole transform hook is never
 * called. The only per-frame positions a tab drag offers are dockview's own
 * `onWillShowOverlay`, which fires for each `dragover` over a window's drop
 * target and carries both the quadrant it resolved and the native event's
 * client point, and the `dragover`s that reach the dock root from the desktop
 * behind the windows.
 *
 * That same cadence is the clock. `dragover` repeats roughly every 50ms while a
 * drag is held over a target — even a perfectly stationary one, in Chromium and
 * Firefox — so the dwell in `snapDwell.ts` can be driven from `Date.now()` on
 * each event, exactly as the window drag drives it from its own frames. A timer
 * is armed as well, because that repeat is not something the specification
 * promises: without it, a browser that fires `dragover` only on movement would
 * let a drag rest on an edge forever and never arm anything.
 *
 * Nothing here calls `preventDefault()` on the overlay event. That would cancel
 * dockview's drop along with its highlight, and the drop is what we want — it is
 * `dockWindows`' `onWillDrop` and desktop drop that turn it into a split or a
 * snapped window.
 */

/** A point for a frame whose position could not be read; it arms nothing. */
const NOWHERE = { x: 0, y: 0 };

/** What a release would commit: the window to shrink, and the two boxes. */
export interface ArmedTabSplit {
  /** dockview's group for the window underneath; `dockWindows` resolves its panels. */
  readonly group: unknown;
  readonly split: TabSplit;
}

/** The two taskbar switches, as they stand this frame; see `snapMode.ts`. */
export interface SnapModes {
  readonly toEdges: boolean;
  readonly toWindows: boolean;
}

/** What the desktop snapping needs from the rest of the shell. */
export interface TabDropOptions {
  /** The switches, read per frame. The taskbar's own, unless a test says otherwise. */
  readonly modes?: () => SnapModes;
  /** The drag in flight, for a `dragover` no window announced. dockview's store by default. */
  readonly readDrag?: () => PanelDragData;
  /** The box a panel's own window last had, which a tear-out comes back at. */
  readonly remembered?: RememberedBox;
}

/** The parts of a live dockview this hook reads. Deliberately minimal. */
interface TabDropApi {
  readonly id: string;
  readonly panels: readonly { readonly id: string; readonly group?: unknown }[];
  onWillShowOverlay(handler: (event: OverlayEvent) => void): { dispose(): void };
}

/** The part of a native drag event a frame is read from. */
interface NativeDrag {
  readonly clientX?: number;
  readonly clientY?: number;
  readonly altKey?: boolean;
  readonly target?: unknown;
}

/** dockview's `DockviewWillShowOverlayLocationEvent`, as much of it as we use. */
interface OverlayEvent {
  readonly kind: string;
  readonly position: string;
  readonly group?: unknown;
  readonly nativeEvent?: NativeDrag;
  getData(): PanelDragData;
}

/**
 * What one frame of the drag is aiming at: a window to split, or a window to
 * land — and what the desktop's snaps offer where it would land.
 */
type Aim =
  | { readonly kind: "split"; readonly group: unknown; readonly split: TabSplit }
  | { readonly kind: "land"; readonly panelId: string; readonly snap: DragSnap };

/** One frame: the native event it came from, where it was, and what it aims at. */
interface Frame {
  readonly native: unknown;
  readonly at: { readonly x: number; readonly y: number } | null;
  readonly aim: Aim | null;
}

export interface TabDrop {
  /**
   * Starts watching a live dock. `root` is the dock's root element.
   *
   * Installing again takes the previous installation down first, because that
   * is what the app does: the dock sits under a `v-if` on the connection state
   * and on the mobile breakpoint, so a reconnect or a breakpoint crossing builds
   * a new dock and calls this again with the same hook. The caller should still
   * hold the disposer for unmount; this only makes sure the *state* of a dock
   * that no longer exists — above all which rectangle on screen is ours — cannot
   * outlive it.
   */
  install(api: unknown, root: HTMLElement): { dispose(): void };
  /** The split a release would commit right now, or `null`. */
  armed(): ArmedTabSplit | null;
  /**
   * The split armed for that particular window, or `null` — which is exactly
   * what `dockWindows`' `SplitOnDrop.armed` asks. It lives here so the identity
   * check sits next to the state it guards rather than in the wiring: a drop on
   * a window other than the one the drag rested on must tear out, not split
   * something the user never aimed at.
   */
  armedFor(group: unknown): TabSplit | null;
  /**
   * The box a desktop snap armed for that tab's window, or `null` — what
   * `SplitOnDrop.landing` asks. Named by panel for the same reason `armedFor`
   * names its window: only the drag that armed it may commit it.
   */
  landingFor(panelId: string): Box | null;
}

/**
 * Whether the api and root handed in are the shapes we need.
 *
 * A dockview upgrade that renames `onWillShowOverlay` must cost the desktop
 * this one gesture, not the whole drag: the hook installs nothing and every
 * drop goes on tearing out under the pointer, which is what it did before.
 */
function usable(api: unknown, root: unknown): api is TabDropApi {
  const candidate = api as TabDropApi | null | undefined;
  if (!candidate || typeof candidate.onWillShowOverlay !== "function") return false;
  if (typeof candidate.id !== "string") return false;
  if (!Array.isArray(candidate.panels)) return false;
  return !!root && typeof (root as HTMLElement).addEventListener === "function";
}

/** Where the drag is, in client coordinates, or `null` if we cannot tell. */
function pointOf(native: NativeDrag | undefined): { x: number; y: number } | null {
  const x = native?.clientX;
  const y = native?.clientY;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/** The dwell's name for what a frame aims at, or `null` for nothing to wait on. */
function targetOf(aim: Aim | null): string | null {
  if (!aim) return null;
  return aim.kind === "split" ? aim.split.key : aim.snap.target;
}

/** The box a frame promises: the tab's half of a split, or where it would land. */
function promisedOf(aim: Aim | null): Box | null {
  if (!aim) return null;
  return aim.kind === "split" ? aim.split.tab : aim.snap.box;
}

/**
 * Watches a tab drag and arms what a release would commit.
 *
 * `preview` is the desktop's own snap preview, shared so that a tab drag and a
 * window drag cannot paint two rectangles at once. It is only ever cleared by
 * this hook when this hook is what set it — a window drag's preview is none of
 * its business.
 *
 * `pending` is the other half of that shared feedback: the outline shown while
 * the drag still has to keep resting on the edge. A tab drag needs it more than
 * a window drag does, because it is the case the user complained about —
 * dockview used to paint its own edge highlight the instant the pointer crossed
 * into a quadrant, at full strength, which promised a split that was still half
 * a second away. That highlight is now off (`dropOverlay.css`) and this is what
 * replaces it, on exactly the same terms as a window drag's.
 *
 * `isMinimized` answers for a single panel; a window counts as away only when
 * every tab in it does, the same rule `applyMinimized` hides one by.
 */
export function useTabDrop(
  preview: ShallowRef<Box | null>,
  pending: ShallowRef<SnapDwelling | null>,
  isMinimized: (panelId: string) => boolean,
  options: TabDropOptions = {},
): TabDrop {
  const readModes =
    options.modes ?? ((): SnapModes => ({ toEdges: snapToEdges(), toWindows: snapToWindows() }));
  const readDrag = options.readDrag ?? getPanelData;
  const remembered: RememberedBox = options.remembered ?? (() => null);
  /** How long the drag has rested on whatever it is pointing at. */
  let dwelling: DwellState = NO_DWELL;
  /** What a release would commit, once the dwell has been served. */
  let armed: Aim | null = null;
  /** Last frame's desktop snap, which gives the snap rules their hysteresis. */
  let landSnap: DragSnap = NO_DRAG_SNAP;
  /** True while the rectangle on screen — outline or preview — is ours to clear. */
  let owned = false;
  /** The pending re-run for a browser that stopped repeating `dragover`. */
  let timer: number | null = null;
  /**
   * The last frame decided, so the timer can re-decide it.
   *
   * Also how a hover is told from a drag over the empty desktop: the same
   * native event reaches dockview's drop target first and the dock root after,
   * so a `dragover` at the root whose native event is this frame's has already
   * been decided.
   */
  let frame: Frame | null = null;
  /** The installation in force, so a second `install` can take the first down. */
  let installed: { dispose(): void } | null = null;

  /**
   * Puts up whichever of the two states this frame calls for, or takes both
   * down.
   *
   * They are set together because they are one piece of feedback in two phases:
   * at most one of them is ever a box, and a frame that has neither is a frame
   * with nothing to say.
   */
  function show(armedBox: Box | null, waiting: SnapDwelling | null): void {
    if (armedBox || waiting) {
      preview.value = armedBox;
      pending.value = waiting;
      owned = true;
      return;
    }
    if (!owned) return;
    preview.value = null;
    pending.value = null;
    owned = false;
  }

  function clearTimer(): void {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  }

  /** Forgets the wait and takes down anything it put up. */
  function forget(): void {
    clearTimer();
    dwelling = NO_DWELL;
    armed = null;
    landSnap = NO_DRAG_SNAP;
    frame = null;
    show(null, null);
  }

  /** Whether every tab of that window is minimised, and so invisible. */
  function windowAway(api: TabDropApi, group: unknown): boolean {
    const ids = api.panels.filter((panel) => panel.group === group).map((panel) => panel.id);
    return ids.length > 0 && ids.every((id) => isMinimized(id));
  }

  /**
   * The split this hover would make, or `null`.
   *
   * Every refusal here is a refusal to *split*: the drop falls through to a
   * landing, snapped or not, exactly as it would anywhere else.
   */
  function splitUnder(api: TabDropApi, event: OverlayEvent, data: PanelDragData): TabSplit | null {
    const group = event.group;
    if (!group || windowAway(api, group)) return null;
    const target = floatingWindows(api).boxOf(group);
    return tabSplitFor({
      kind: event.kind,
      position: event.position,
      target,
      sameWindow: !!data && data.groupId === (group as { id?: unknown }).id,
    });
  }

  /**
   * What the desktop's snaps offer a release of `panelId`'s tab at this point,
   * or `null` when the dock cannot be measured.
   *
   * The dragged box is the window the release would leave (`tabLandingAt`),
   * and its neighbours are the visible windows other than the one being moved —
   * a torn-out tab's source window stays put, and is one of them.
   */
  function landAim(
    api: TabDropApi,
    root: HTMLElement,
    panelId: string,
    native: NativeDrag | undefined,
  ): Aim | null {
    const at = pointOf(native);
    if (!at) return null;
    const live = api as unknown as DockviewApi;
    const landing = tabLandingAt(live, root, panelId, at.x, at.y, remembered);
    const desktop = landing && usableDesktop(landing.host.width, landing.host.height);
    if (!landing || !desktop) return null;
    const modes = readModes();
    const snap = dragSnapFor({
      pointer: { x: at.x - landing.host.left, y: at.y - landing.host.top },
      box: landing.box,
      others: visibleFloatWindows(live, landing.moving, isMinimized).map((entry) => entry.box),
      desktop,
      toEdges: modes.toEdges,
      toWindows: modes.toWindows,
      suspended: native?.altKey === true,
      holdTop: false,
      current: landSnap,
    });
    return { kind: "land", panelId, snap };
  }

  /** What a hover over a window's drop target aims at; see the order at the top. */
  function aimOver(api: TabDropApi, root: HTMLElement, event: OverlayEvent): Aim | null {
    const data = event.getData();
    const dragged = floatTargetForDrop(
      { kind: event.kind, position: event.position, data },
      api.id,
    );
    // A tab bar joins, a foreign drag is not ours, and a tab-group chip cannot
    // become one window: none of them is aiming at anything of ours. A whole
    // window dragged by its header is already a move gesture of its own.
    if (!dragged || dragged.type !== "panel") return null;
    const split = splitUnder(api, event, data);
    if (split) return { kind: "split", group: event.group, split };
    return landAim(api, root, dragged.panelId, event.nativeEvent);
  }

  /**
   * What a `dragover` no window announced aims at: a landing, if it is over the
   * empty desktop with this dock's tab — the one place such a drop is taken —
   * and nothing otherwise.
   */
  function aimOverDesktop(api: TabDropApi, root: HTMLElement, native: NativeDrag): Aim | null {
    if (!overDesktop(native.target)) return null;
    const drop = desktopDropFor({ data: readDrag(), alone: false }, api.id);
    return drop ? landAim(api, root, drop.panelId, native) : null;
  }

  /** One decision: this frame's aim, put through the dwell. */
  function decide(current: Frame, now: number): void {
    // A frame whose position could not be read arms no target and so promises
    // nothing either way; `at` is what says whether there is a target at all.
    const target = current.at ? targetOf(current.aim) : null;
    const waited = dwell(dwelling, { target, at: current.at ?? NOWHERE, now });
    dwelling = waited.state;
    landSnap = current.aim?.kind === "land" ? current.aim.snap : NO_DRAG_SNAP;
    armed = waited.ready && target ? current.aim : null;
    const promised = current.at ? promisedOf(current.aim) : null;
    show(armed ? promised : null, dwellingFor(promised, waited));
    clearTimer();
    // A stationary drag may produce no further event, so the wait finishes
    // itself; see the note at the top of this file.
    if (target && !waited.ready) {
      const remaining = Math.max(1, DWELL_MS - (now - waited.state.since));
      timer = window.setTimeout(() => {
        timer = null;
        if (frame === current) decide(current, Date.now());
      }, remaining);
    }
  }

  return {
    armed: () => (armed?.kind === "split" ? { group: armed.group, split: armed.split } : null),
    armedFor: (group) => (armed?.kind === "split" && armed.group === group ? armed.split : null),
    landingFor: (panelId) =>
      armed?.kind === "land" && armed.panelId === panelId ? armed.snap.box : null,
    install(api, root) {
      // Whatever was installed before belongs to a dock that has gone.
      installed?.dispose();
      installed = null;
      if (!usable(api, root)) return { dispose: () => undefined };
      const overlay = api.onWillShowOverlay((event) => {
        const aim = aimOver(api, root, event);
        const native = event.nativeEvent ?? null;
        // One `dragover` can resolve to more than one drop target (a group's
        // content and, were the root target ever switched on, the layout's
        // edge). The one that offered a split has the better claim on the
        // frame: a second opinion on the very same native event must not
        // disarm it.
        if (aim?.kind !== "split" && frame?.native === native && frame.aim?.kind === "split") {
          return;
        }
        frame = { native, at: pointOf(event.nativeEvent), aim };
        decide(frame, Date.now());
      });
      // The same native `dragover` that reached a window's drop target bubbles
      // up to here and has been decided already. One that did not was over the
      // desktop — where a release lands a window, and so may snap — or over
      // nothing that takes a drop at all, which ends the wait.
      const onDragOver = (event: Event): void => {
        if (frame && frame.native === event) return;
        const native = event as unknown as NativeDrag;
        const aim = aimOverDesktop(api, root, native);
        if (!aim) {
          forget();
          return;
        }
        frame = { native: event, at: pointOf(native), aim };
        decide(frame, Date.now());
      };
      const onDragEnd = (): void => forget();
      root.addEventListener("dragover", onDragOver);
      root.addEventListener("dragend", onDragEnd);
      root.addEventListener("drop", onDragEnd);
      const handle = {
        dispose: () => {
          if (installed === handle) installed = null;
          overlay.dispose();
          root.removeEventListener("dragover", onDragOver);
          root.removeEventListener("dragend", onDragEnd);
          root.removeEventListener("drop", onDragEnd);
          forget();
        },
      };
      installed = handle;
      return handle;
    },
  };
}
