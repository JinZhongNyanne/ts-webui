import { computed, shallowRef, type ComputedRef, type ShallowRef } from "vue";
import type { DockviewApi, FloatingGroupDragContext } from "dockview-vue";
import { usableDesktop, type Box, type DesktopSize } from "./box";
import { cascadeBox } from "./placement";
import { snapBox, type SnapPointer, type SnapZone } from "./snap";
import { snapToEdges, snapToWindows } from "./snapMode";
import { dragSnapFor, NO_DRAG_SNAP, type DragSnap } from "./dragSnap";
import { dwell, DWELL_MS, NO_DWELL, type DwellState } from "./snapDwell";
import { dwellingFor, type SnapDwelling } from "./snapFeedback";
import { layoutZoneBoxFor } from "./layouts";
import { layoutTileAt, overLayoutPanel } from "./snapLayoutTile";
import { taskbarButtons, taskbarAction, type TaskbarButton } from "./taskbar";
import {
  floatBoxOf,
  forgetWindow,
  isMinimized as isWindowMinimized,
  NO_WINDOWS,
  rememberFloats,
  setMinimized,
  parseStates,
  pruneStates,
  serializeStates,
  setMaximized,
  settleDrag,
  stateOf,
  toggleShowDesktop,
  type FloatSighting,
  type WindowStates,
} from "./windowState";
import {
  applyMinimized,
  minimizeWindow,
  moveWindow,
  openWindow,
  raiseWindow,
  unminimizeWindow,
  toggleMaximizeWindow,
  visibleFloatWindows,
} from "./dockWindows";
import { floatingWindows } from "./dockviewInternals";
import { publishWindowStates } from "./maximizedWindows";
import {
  maximizeTargetFor,
  GROUP_SELECTOR,
  NO_MAXIMIZE_SELECTOR,
  TITLE_BAR_SELECTOR,
} from "./titleBarMaximize";
import { refitStates } from "./refit";
import { watchDesktopResize } from "./desktopResize";

/**
 * The desktop's state: which windows are minimised or maximised, what the
 * taskbar shows, the snap preview, and where all of it is saved.
 *
 * `App.vue` keeps only the shell and hands store signals in; everything that
 * talks to dockview lives here or in `dockWindows.ts`.
 */

/** Where dockview's own layout is saved. v4: floating windows, not a grid. */
export const LAYOUT_KEY = "jinz.dock.layout.v4";
/** Minimised / maximised state, which dockview does not serialise for floats. */
export const WINDOW_STATE_KEY = "jinz.dock.windows.v1";
/** Keys of the docked shell, deleted on first run of the desktop. */
const RETIRED_KEYS = ["jinz.dock.layout.v3", "jinz.dock.videoSeen", "jinz.dock.musicSeen"];
/** How long after a change the layout is written. */
const SAVE_DELAY_MS = 400;
/** The CSS selector of the dock's root element. */
const DOCK_SELECTOR = ".dock";

/**
 * dockview's proposed rectangle as the desktop's own `Box`.
 *
 * dockview speaks `left`/`top`, every box on this desktop speaks `x`/`y`; the
 * two are translated in one place so no snap rule has to know both spellings.
 */
function proposedBox(proposed: FloatingGroupDragContext["proposed"]): Box {
  return {
    x: proposed.left,
    y: proposed.top,
    width: proposed.width,
    height: proposed.height,
  };
}

/**
 * Just enough of an element to ask what a click landed inside.
 *
 * Duck-typed rather than `instanceof Element`: asking is the only thing done
 * with an event target here, so the capability is what is checked — which also
 * keeps the gesture testable without a DOM, like the rest of this file.
 */
interface ClickedElement {
  closest(selector: string): unknown;
}

function clickedElement(target: unknown): ClickedElement | null {
  const element = target as ClickedElement | null;
  return element && typeof element.closest === "function" ? element : null;
}

export interface WindowSpec2 {
  readonly component: string;
  readonly title: string;
  readonly params?: Record<string, unknown>;
}

/** How to open a window. */
export interface OpenOptions {
  /**
   * Opens it minimised, without activating it.
   *
   * Activating is what tells the rest of the app the user switched to this
   * window, so a background open must skip it: otherwise the app answers by
   * bringing the window it was just told about to the front, and the window
   * the user never asked for lands on the desktop anyway.
   */
  readonly background?: boolean;
}

export interface Desktop {
  readonly api: ShallowRef<DockviewApi | null>;
  readonly buttons: ComputedRef<readonly TaskbarButton[]>;
  readonly snapPreview: ShallowRef<Box | null>;
  /**
   * The box a drag is *waiting* on, outlined rather than promised.
   *
   * Kept apart from `snapPreview` because the two say different things, and the
   * whole point of this pair is that the user can tell them apart: this one is
   * "keep holding and this will happen", `snapPreview` is "let go and this
   * happens". See `snapFeedback.ts`.
   */
  readonly snapDwelling: ShallowRef<SnapDwelling | null>;
  /**
   * True while a drag has the pointer at the top edge, which is when the Snap
   * Layouts flyout drops down from the top of the desktop.
   */
  readonly layoutsOnDrag: ShallowRef<boolean>;
  readonly dragTransform: (
    context: FloatingGroupDragContext,
  ) => { top: number; left: number } | void;
  attach(api: DockviewApi): void;
  openWindow(panelId: string, spec: WindowSpec2, options?: OpenOptions): void;
  clickTaskbar(button: TaskbarButton): void;
  /** Whether that window is currently minimised. */
  isMinimized(panelId: string): boolean;
  /**
   * The box that panel's own window last had, or `null` if it never had one.
   * What a tear-out puts the tab back into; see `tearOutBox`.
   */
  floatBoxOf(panelId: string): Box | null;
  reveal(panelId: string): void;
  minimize(panelId: string): void;
  /**
   * The taskbar's "minimise all": puts every window away, or brings back the
   * ones this same button put away.
   */
  toggleShowDesktop(): void;
  toggleMaximize(panelId: string): void;
  /**
   * Puts a window in a box and brings it to the front, as picking a Snap
   * Layouts tile does.
   */
  snapTo(panelId: string, box: Box): void;
  /**
   * Puts a window in a box and leaves both the window order and the saving
   * alone: one frame of a gesture that is still in flight.
   *
   * What a seam resize moves the neighbours of the window being resized with
   * (`useSnapGroups.ts`). `snapTo` raises, and raising means `setActive`, which
   * is also how the rest of the app hears which window the user is in — so a
   * neighbour raised here would jump in front of the window still under the
   * pointer and, every frame, announce a switch the user never made: a chat
   * marked read, the header controls re-aimed. With two windows on the seam the
   * two would take turns at it.
   *
   * The save is the gesture's to ask for when it ends, for a plainer reason: a
   * save per frame per neighbour only ever pushes the debounced write further
   * out, so it would be the one frame that never comes that finally wrote.
   */
  moveWindow(panelId: string, box: Box): void;
  forget(panelId: string): void;
  resetDesktop(build: (api: DockviewApi) => void): void;
  saveLayout(): void;
  desktopSize(): DesktopSize | null;
  nextCascade(): number;
}

export function useDesktop(): Desktop {
  const api = shallowRef<DockviewApi | null>(null);
  const states = shallowRef<WindowStates>(NO_WINDOWS);
  /** Bumped by dockview's events so the taskbar recomputes. */
  const layoutTick = shallowRef(0);
  const snapPreview = shallowRef<Box | null>(null);
  const snapDwelling = shallowRef<SnapDwelling | null>(null);
  const layoutsOnDrag = shallowRef(false);
  /** The zone the drop will commit: armed only once the dwell has been served. */
  let armed: SnapZone | null = null;
  let armedGroup: unknown = null;
  /**
   * What the snap rules point at this frame, dwell or no dwell.
   *
   * Kept apart from `armed` because they are two different questions. This
   * feeds each rule its own hysteresis, so a target does not slip away while the
   * half second is still running; `armed` is what a release acts on, and stays
   * empty until the wait is over.
   */
  let candidate: DragSnap = NO_DRAG_SNAP;
  /**
   * The gap-filling box a release would commit, and whose window it is for.
   *
   * A window snap moves the dragged window every frame, but a window dropped
   * *between* others is also resized to fill the space — and that cannot happen
   * mid-drag: dockview's `Overlay.setupDrag` takes only a top-left back from the
   * transform hook and keeps the size it started with. So the fill is shown as a
   * preview while the drag lasts and applied when the window is let go, exactly
   * as the screen-edge zones do. The group is recorded with it because a release
   * is only a release of the window that armed it.
   */
  let armedFill: { group: unknown; box: Box } | null = null;
  /** How long the drag has rested on whatever it is pointing at; see `snapDwell.ts`. */
  let dwelling: DwellState = NO_DWELL;
  /**
   * The other visible windows' boxes, taken once at the start of a drag.
   *
   * Deliberately not dockview's own `context.others`: that includes minimised
   * windows, which are invisible and so nothing a user could mean to line up
   * with. Nothing but the dragged window moves during a move drag, so one
   * snapshot per drag is both correct and one DOM read instead of sixty a
   * second.
   */
  let dragOthers: readonly Box[] | null = null;
  /** The pending re-run of the current frame; see `armDwellTimer`. */
  let dwellTimer: number | null = null;
  /** The cursor in desktop coordinates while a drag is under way; see `trackPointer`. */
  let pointer: SnapPointer | null = null;
  /**
   * The last cursor position seen, in *viewport* coordinates, kept past the
   * end of the drag.
   *
   * The drop has to know which Snap Layouts tile the pointer was over, and the
   * only way to ask is to hit-test the document at that point — which needs
   * viewport coordinates, and needs them *after* `pointerup` has already torn
   * the live tracking down. Unlike `pointer` this is therefore never cleared
   * on release, only replaced by the next press or move.
   */
  let lastClient: { x: number; y: number } | null = null;
  /** Removes the pointer listeners; see `trackPointer`. */
  let stopTrackingPointer: (() => void) | null = null;
  /** Stops following the desktop's size; see `watchDesktopResize`. */
  let stopWatchingSize: (() => void) | null = null;
  let opened = 0;
  /**
   * The windows the taskbar's "minimise all" put away, so the next press can
   * bring back those and only those. Not persisted: after a reload the desktop
   * is whatever the user left, and a button remembering a click from a
   * previous session would restore windows out of nowhere.
   */
  let showDesktopMinimized: readonly string[] = [];
  let savingTimer: number | null = null;
  /** One title-change subscription per live panel; see `syncTitleWatchers`. */
  const titleSubs = new Map<string, { dispose(): void }>();
  /**
   * The box the dragged window had when the drag began, and whose group it is.
   *
   * A drag to the top edge maximises, and a maximised window has to remember
   * the box to come back to — which is the box it had *before* the drag, not
   * the one it ends the drag in. dockview moves the window as the pointer
   * moves, so by the time the drag ends that box is gone; it is captured on
   * the first frame of the drag instead. Cleared on every press, so a new
   * drag never inherits the previous one's box.
   */
  let dragFrom: { group: unknown; box: Box } | null = null;

  /** The one place window state is replaced, so the header controls hear it. */
  function setStates(next: WindowStates): void {
    states.value = next;
    publishWindowStates(next);
  }

  const buttons = computed(() => {
    void layoutTick.value;
    const live = api.value;
    if (!live) return [];
    const panels = live.panels.map((p) => ({ id: p.id, title: p.title ?? p.id }));
    const activeId = live.activePanel?.id ?? null;
    return taskbarButtons(panels, activeId, states.value);
  });

  function desktopSize(): DesktopSize | null {
    const root = document.querySelector<HTMLElement>(DOCK_SELECTOR);
    if (!root) return null;
    return usableDesktop(root.clientWidth, root.clientHeight);
  }

  function nextCascade(): number {
    return opened++;
  }

  /**
   * Where each panel's own window is right now, for a later tear-out.
   *
   * Only a panel *alone* in a floating group has a window of its own; a
   * stacked tab reports `null`, which `rememberFloats` reads as "leave what
   * you remembered alone". A maximised window reports the box it will come
   * back to rather than the whole desktop, which is not a box anyone wants a
   * torn-out tab to be restored to.
   */
  function floatSightings(live: DockviewApi): readonly FloatSighting[] {
    const windows = floatingWindows(live);
    return live.panels.map((panel) => {
      const group = panel.group;
      const alone = !!group && live.panels.filter((p) => p.group === group).length === 1;
      const state = stateOf(states.value, panel.id);
      if (!alone) return { panelId: panel.id, box: null };
      return { panelId: panel.id, box: state.restore ?? windows.boxOf(group) };
    });
  }

  function saveLayout(): void {
    const live = api.value;
    if (!live) return;
    if (savingTimer !== null) window.clearTimeout(savingTimer);
    savingTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(live.toJSON()));
        const pruned = pruneStates(
          rememberFloats(states.value, floatSightings(live)),
          live.panels.map((p) => p.id),
        );
        setStates(pruned);
        localStorage.setItem(WINDOW_STATE_KEY, serializeStates(pruned));
      } catch {
        /* ignore quota errors */
      }
    }, SAVE_DELAY_MS);
  }

  /** Runs an operation that returns the next window state, then saves. */
  function apply(next: (live: DockviewApi) => WindowStates): void {
    const live = api.value;
    if (!live) return;
    setStates(next(live));
    layoutTick.value++;
    saveLayout();
  }

  /**
   * Keeps one title-change subscription per live panel.
   *
   * `api.panels` is not reactive and a title changes without any layout
   * event, so a panel's taskbar button (chat titles carry live unread
   * counts) would otherwise go stale. Panels come and go, so this is
   * reconciled on every add/remove/layout event rather than wired once.
   */
  function syncTitleWatchers(live: DockviewApi): void {
    const resync = () => void layoutTick.value++;
    const liveIds = new Set(live.panels.map((p) => p.id));
    for (const [id, sub] of titleSubs) {
      if (!liveIds.has(id)) {
        sub.dispose();
        titleSubs.delete(id);
      }
    }
    for (const panel of live.panels) {
      if (titleSubs.has(panel.id)) continue;
      titleSubs.set(panel.id, panel.api.onDidTitleChange(resync));
    }
  }

  function attach(live: DockviewApi): void {
    api.value = live;
    trackPointer();
    watchTitleBarDoubleClicks(live);
    // A second `attach` must not leave the first run's watcher behind.
    stopWatchingSize?.();
    const root = document.querySelector<HTMLElement>(DOCK_SELECTOR);
    stopWatchingSize = root
      ? watchDesktopResize(live, root, (from, to) => {
          // The windows have moved; a maximised one's way back has to follow.
          setStates(refitStates(states.value, from, to));
          layoutTick.value++;
          saveLayout();
        })
      : null;
    for (const key of RETIRED_KEYS) localStorage.removeItem(key);
    setStates(parseStates(localStorage.getItem(WINDOW_STATE_KEY)));
    // `api.panels` is a plain array, not reactive, so the taskbar only
    // recomputes because dockview's own events bump this counter.
    const resync = () => void layoutTick.value++;
    const resyncAndWatch = () => {
      resync();
      syncTitleWatchers(live);
    };
    live.onDidAddPanel(resyncAndWatch);
    live.onDidRemovePanel(resyncAndWatch);
    live.onDidActivePanelChange(resync);
    // A restore recreates every window, so the minimised windows loaded above
    // have to be hidden again: dockview serialises the layout, not our state.
    live.onDidLayoutFromJSON(() => {
      resyncAndWatch();
      applyMinimized(live, states.value);
    });
    live.onDidLayoutChange(resync);
    // Cover panels already present when attach runs, e.g. a restored layout.
    syncTitleWatchers(live);
    // A snap is committed when the float's drag ends. The same event fires
    // after a *resize* drag, so it only acts when a zone was actually armed.
    floatingWindows(live).onDragEnd((group) => {
      const zone = armed;
      const sameGroup = group === armedGroup;
      // Which tile the release landed on has to be read before the flyout is
      // taken down, but the flyout only disappears on the next render, so
      // reading it here — before clearing the flag — is safe either way.
      const tile = zone === "top" && layoutsOnDrag.value ? draggedTile() : null;
      const started = dragFrom;
      const before = started && started.group === group ? started.box : null;
      const fill = armedFill;
      dragFrom = null;
      // Everything the drag learned goes at once, the zone included; each of
      // the branches below acts on the copies taken above.
      forgetDrag();
      layoutsOnDrag.value = false;
      snapPreview.value = null;
      snapDwelling.value = null;
      const size = desktopSize();
      const panel = live.panels.find((p) => p.group === group);
      if (!size || !panel) return;
      if (zone && sameGroup) {
        // A release actually over one of the flyout's tiles snaps to that
        // region; a release at the top edge but anywhere else is the plain Aero
        // Snap gesture and still fills the desktop.
        const box =
          (tile && layoutZoneBoxFor(tile.layoutId, tile.zoneId, size)) || snapBox(zone, size);
        snapToBox(live, panel.id, box, before);
        return;
      }
      // Otherwise the window may have been dropped into a gap between other
      // windows, and filling it is a resize the drag itself could not perform.
      if (fill && fill.group === group) {
        snapToBox(live, panel.id, fill.box, before);
        return;
      }
      // A drag that armed nothing still decides one thing: a window dragged
      // off the top edge no longer fills the desktop, so it is not maximised
      // any more. The same event fires after a *resize* drag, which settles
      // the same way.
      const landed = floatingWindows(live).boxOf(group);
      if (landed) settle(panel.id, landed, size, before);
    });
  }

  /**
   * The window an event landed in, as the id of its front tab.
   *
   * Deliberately *not* `api.activePanel`, for the reason `App.vue`'s
   * `controlTarget` gives: dockview activates a group from `pointerdown` on its
   * tab container, so relying on which panel is active makes the gesture act on
   * whichever window a browser's focus handling happened to leave in front.
   * Walking up to the group's own element makes the target the window the user
   * really clicked, everywhere.
   */
  function windowPanelOf(live: DockviewApi, groupElement: unknown): string | null {
    if (!groupElement) return null;
    const panel = live.panels.find((p) => p.group?.element === groupElement);
    return panel?.group?.activePanel?.id ?? panel?.id ?? null;
  }

  /**
   * Windows' oldest window gesture: double-click the title bar — here the tab
   * bar — to maximise, and again to put the window back.
   *
   * Delegated from the dock element, exactly as `App.vue` delegates the window
   * controls, and for the same reason: dockview builds the tab bars itself, so
   * nothing in them can be bound from a template. What the double-click means is
   * `titleBarMaximize.ts`'s to say, and the answer goes to the same
   * `toggleMaximize` the maximise button and the top-edge drag use — one restore
   * box, one published state, and so the right glyph on that button afterwards.
   *
   * Only `dblclick` is listened for, so the single-click gestures the tab bar
   * already carries — dragging the window by its void space, dragging a tab out
   * — are untouched.
   */
  function watchTitleBarDoubleClicks(live: DockviewApi): void {
    const root = document.querySelector<HTMLElement>(DOCK_SELECTOR);
    if (!root) return;
    root.addEventListener("dblclick", (event: Event) => {
      const clicked = clickedElement(event.target);
      if (!clicked) return;
      const panelId = maximizeTargetFor({
        inTitleBar: !!clicked.closest(TITLE_BAR_SELECTOR),
        onControl: !!clicked.closest(NO_MAXIMIZE_SELECTOR),
        panelId: windowPanelOf(live, clicked.closest(GROUP_SELECTOR)),
      });
      if (panelId) toggleMaximize(panelId);
    });
  }

  /**
   * Maximises a window, or puts it back in the box it came from — the one
   * transition the maximise button, the top-edge drag and the tab bar's
   * double-click all share.
   */
  function toggleMaximize(panelId: string): void {
    const size = desktopSize();
    if (!size) return;
    apply((live) => toggleMaximizeWindow(live, panelId, size, states.value));
  }

  /**
   * Keeps `pointer` — the cursor in desktop coordinates — fresh while, and only
   * while, a pointer button is held.
   *
   * dockview's `FloatingGroupDragContext` carries no pointer coordinates (see
   * `node_modules/dockview-core/dist/cjs/dockview/options.d.ts`), and the snap
   * rule now needs them, so they are read from the events themselves. Scope:
   * one always-registered `pointerdown` listener, which is what turns the
   * per-move listener on; the per-move listener exists only between a press and
   * its release, so nothing runs while the desktop is idle. It is torn down on
   * `pointerup`, on `pointercancel` (touch interruptions, a browser taking the
   * gesture over) and on window `blur`; and, because a mouse released outside
   * the page fires none of those, also on the first move that arrives with no
   * button held. Listeners are registered in the capture phase so the position
   * is already updated by the time dockview's own move handling calls
   * `dragTransform` for the same event.
   */
  function trackPointer(): void {
    // A second `attach` must not leave the first run's listener behind.
    stopTrackingPointer?.();

    /**
     * The dock's viewport origin, read once per press. The desktop does not
     * move or scroll during a drag, so re-measuring on every move would only
     * add a forced layout to each frame.
     */
    let origin: { x: number; y: number } | null = null;

    const stopDrag = (): void => {
      origin = null;
      pointer = null;
      // A dwell that has not been served by now never will be: the window has
      // been let go, and a timer firing after that would snap a drag that is
      // already over.
      clearDwellTimer();
      // …and an outline still filling up is a promise about a drag that no
      // longer exists, so it goes with it. The armed preview is taken down by
      // the drop instead, which needs it to decide what the release meant.
      snapDwelling.value = null;
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", stopDrag, true);
      window.removeEventListener("pointercancel", stopDrag, true);
      window.removeEventListener("blur", stopDrag);
    };

    function onMove(event: PointerEvent): void {
      // A release outside the page never reaches us; the next move without a
      // button held is the first sign the drag is over.
      if (event.buttons === 0 || !origin) {
        stopDrag();
        return;
      }
      pointer = { x: event.clientX - origin.x, y: event.clientY - origin.y };
      lastClient = { x: event.clientX, y: event.clientY };
    }

    const onDown = (event: PointerEvent): void => {
      const root = document.querySelector<HTMLElement>(DOCK_SELECTOR);
      if (!root) return;
      const rect = root.getBoundingClientRect();
      origin = { x: rect.left, y: rect.top };
      // A press starts a new drag: whatever box the previous one recorded is
      // not this window's, and must not become its restore box, and no wait it
      // had served carries over into this one.
      dragFrom = null;
      forgetDrag();
      pointer = { x: event.clientX - origin.x, y: event.clientY - origin.y };
      lastClient = { x: event.clientX, y: event.clientY };
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", stopDrag, true);
      window.addEventListener("pointercancel", stopDrag, true);
      window.addEventListener("blur", stopDrag);
    };

    window.addEventListener("pointerdown", onDown, true);
    stopTrackingPointer = () => {
      stopDrag();
      window.removeEventListener("pointerdown", onDown, true);
    };
  }

  /**
   * Everything one drag learned, thrown away.
   *
   * Called from both ends of a gesture — the press that starts one and the
   * release that finishes it — so a wait served, a zone held or a neighbour
   * lined up against can never be inherited by the next drag.
   *
   * The armed zone has to be among them, and the press is the end that matters:
   * a mouse released outside the page fires no `pointerup` and no `blur`, so
   * dockview never announces that drag's end and nothing commits the zone. Left
   * behind, it would snap the user's *next* gesture — another drag, or a plain
   * resize — to an edge they aimed at long before, throwing away what they had
   * just done.
   */
  function forgetDrag(): void {
    clearDwellTimer();
    armed = null;
    armedGroup = null;
    candidate = NO_DRAG_SNAP;
    armedFill = null;
    dwelling = NO_DWELL;
    dragOthers = null;
  }

  /**
   * The boxes of the windows a drag could line up against.
   *
   * Which windows those are is `visibleFloatWindows`' to say, and deliberately
   * not this file's: the seam resize reckons with the same set, and when each
   * kept its own list they disagreed — a drag would line itself up against a
   * *maximised* window, whose box is the whole desktop. Only the boxes are
   * wanted here, since a drag never has to name what it aligned to.
   */
  function otherFloatBoxes(live: DockviewApi, dragged: unknown): readonly Box[] {
    return visibleFloatWindows(live, dragged, (id) => isWindowMinimized(states.value, id)).map(
      (entry) => entry.box,
    );
  }

  function clearDwellTimer(): void {
    if (dwellTimer === null) return;
    window.clearTimeout(dwellTimer);
    dwellTimer = null;
  }

  /**
   * Re-runs a frame once its dwell would be over.
   *
   * A hand that stops moving stops the frames too: dockview calls the transform
   * only on a pointer move, so a drag parked exactly where the user wants it —
   * the very gesture the dwell is there to recognise — would sit out a half
   * second that never arrived. This is the one clock in the whole gesture; the
   * decision itself still takes a timestamp and knows nothing about timers.
   *
   * At most one is ever pending: every frame replaces it, and the end of the
   * press drops it, so nothing can arm a zone after the window has been let go.
   * The re-run's answer has to be applied here, too — dockview is not asking
   * this time, so there is nobody to return a top-left to.
   */
  function armDwellTimer(context: FloatingGroupDragContext, state: DwellState): void {
    const remaining = Math.max(1, DWELL_MS - (Date.now() - state.since));
    dwellTimer = window.setTimeout(() => {
      dwellTimer = null;
      const nudge = dragTransform(context);
      const live = api.value;
      if (!nudge || !live) return;
      const { width, height } = context.proposed;
      floatingWindows(live).position(context.group, {
        x: nudge.left,
        y: nudge.top,
        width,
        height,
      });
    }, remaining);
  }

  /**
   * dockview's per-frame hook while a floating window is dragged.
   *
   * Two independent gestures live here, each with a switch of its own in the
   * taskbar (`snapMode.ts`), read per frame rather than captured at drag start
   * so a switch flipped mid-session always applies:
   *
   * - **the screen's edges**, Windows 11's Aero Snap, armed by the CURSOR and
   *   not by the dragged window's edges. `FloatingGroupDragContext` carries no
   *   pointer coordinates, hence `trackPointer` above. The box is applied on
   *   release, so the window follows the pointer until it is dropped, as
   *   Windows does.
   * - **the other windows' edges**, which moves the window into line this
   *   frame, by the top-left returned from here — and, if that puts it in a
   *   pocket, fills the pocket on release.
   *
   * Which of them a frame is offered, and what box it would leave the window in,
   * is `dragSnap.ts`'s decision — the very one a window dragged by its *tab*
   * asks (`useTabDrop`), so the two drags cannot disagree. What is left here is
   * what only a pointer drag has: the flyout the top edge opens, and a window
   * that can be moved mid-drag.
   *
   * Neither fires until the drag has rested at its target for half a second
   * (`snapDwell.ts`), and both show the same two-state shadow while it does: an
   * outline of the box while waiting, the solid preview once armed. The rest is
   * measured on the proposed box's corner, which follows the pointer one-to-one
   * and, unlike the pointer, is there in every frame whether or not a press was
   * seen.
   */
  function dragTransform(context: FloatingGroupDragContext): { top: number; left: number } | void {
    const { group, container, modifiers } = context;
    const proposed = proposedBox(context.proposed);
    // The first frame of this drag is the last moment the window is still
    // where it started; a top-edge drop maximises and needs that box to
    // restore to. `trackPointer` clears this on every press.
    if (!dragFrom) {
      const box = floatingWindows(api.value).boxOf(group);
      if (box) dragFrom = { group, box };
    }
    if (!dragOthers) dragOthers = api.value ? otherFloatBoxes(api.value, group) : [];
    // Reaching down from the top edge to aim at a tile takes the pointer out
    // of the edge band, which would disarm the gesture and pull the panel out
    // from under the cursor. While the pointer is over the panel the top edge
    // therefore stays armed — except under the free-drag modifier, which means
    // "no snapping at all".
    const holding = !modifiers.altKey && layoutsOnDrag.value && overPanel();
    const snap = dragSnapFor({
      pointer,
      box: proposed,
      others: dragOthers,
      desktop: container,
      toEdges: snapToEdges(),
      toWindows: snapToWindows(),
      suspended: modifiers.altKey,
      holdTop: holding,
      current: candidate,
    });
    candidate = snap;
    const waited = dwell(dwelling, {
      target: snap.target,
      at: { x: proposed.x, y: proposed.y },
      now: Date.now(),
    });
    dwelling = waited.state;
    armed = waited.ready ? snap.zone : null;
    armedGroup = armed ? group : null;
    // The top edge is the one gesture that also opens the Snap Layouts flyout,
    // so the user can aim at a region of the desktop mid-drag instead of only
    // filling it. Every other zone keeps the plain preview.
    layoutsOnDrag.value = armed === "top";
    const tile = armed === "top" ? draggedTile() : null;
    const tileBox = tile ? layoutZoneBoxFor(tile.layoutId, tile.zoneId, container) : null;
    // The resize a window snap cannot perform mid-drag: the box it would grow or
    // shrink into to fill the gap the window has been put in. Re-decided every
    // frame, so a drag that moves on from the gap leaves nothing armed behind it.
    const fill = waited.ready && snap.window ? snap.window.fill : null;
    armedFill = fill ? { group, box: fill } : null;
    /*
     * The rectangle this frame is about, whether or not the wait is over.
     *
     * Both states are painted from this one box, deliberately: the outline shown
     * during the half second and the preview shown after it are the same promise
     * at two strengths, so what the user watches is one rectangle firming up
     * rather than one offer replaced by another. Every target has one now — a
     * window snap that fills nothing promises the lined-up position itself.
     */
    const promised = tileBox ?? snap.box;
    snapPreview.value = waited.ready ? promised : null;
    snapDwelling.value = dwellingFor(promised, waited);
    clearDwellTimer();
    if (snap.target && !waited.ready) armDwellTimer(context, waited.state);
    if (waited.ready && snap.window) return { top: snap.window.box.y, left: snap.window.box.x };
  }

  /**
   * The flyout tile the cursor is over right now, or `null`.
   *
   * Only meaningful while the flyout is up; the caller checks that.
   */
  function draggedTile() {
    return lastClient ? layoutTileAt(lastClient.x, lastClient.y) : null;
  }

  /** Whether the cursor is over the flyout itself, tile or not. */
  function overPanel(): boolean {
    return !!lastClient && overLayoutPanel(lastClient.x, lastClient.y);
  }

  /**
   * Moves a window into a box and forgets any maximised state it had.
   *
   * A snapped window is no longer maximised — leaving the flag set would make
   * its maximise button restore it to a box the user has since moved away
   * from — and the move itself fires no layout event, so the save is explicit.
   *
   * `save` is false for one frame of a gesture still in flight, which saves once
   * when it ends; see the desktop's `moveWindow`.
   */
  function snapToBox(
    live: DockviewApi,
    panelId: string,
    box: Box,
    before?: Box | null,
    save = true,
  ): void {
    const size = desktopSize();
    const group = live.getPanel(panelId)?.group;
    const from = before !== undefined ? before : group ? floatingWindows(live).boxOf(group) : null;
    if (!moveWindow(live, panelId, box)) return;
    // With no measurable desktop nothing can be called maximised, so the safe
    // reading of a move is "not maximised any more".
    if (size) settle(panelId, box, size, from, save);
    else {
      setStates(setMaximized(states.value, panelId, null));
      layoutTick.value++;
      if (save) saveLayout();
    }
  }

  /**
   * Records what landing in `box` means for the window's maximised state.
   *
   * `save` is false for one frame of a gesture that will save when it ends; see
   * the desktop's `moveWindow`.
   */
  function settle(
    panelId: string,
    box: Box,
    size: DesktopSize,
    before: Box | null,
    save = true,
  ): void {
    setStates(settleDrag(states.value, panelId, { box, desktop: size, before }));
    layoutTick.value++;
    if (save) saveLayout();
  }

  return {
    api,
    buttons,
    snapPreview,
    snapDwelling,
    layoutsOnDrag,
    dragTransform,
    attach,
    desktopSize,
    nextCascade,
    saveLayout,
    openWindow(panelId, spec, options) {
      const live = api.value;
      if (!live) return;
      const background = options?.background === true;
      if (live.getPanel(panelId)) {
        if (!background) this.reveal(panelId);
        return;
      }
      const size = desktopSize();
      if (!size) return;
      openWindow(live, panelId, { ...spec, box: cascadeBox(nextCascade(), size) }, !background);
      apply((api2) => {
        // Minimising is part of the same step as opening: a background window
        // must never be painted on the desktop, not even for one frame.
        const next = background ? setMinimized(states.value, panelId, true) : states.value;
        applyMinimized(api2, next);
        return next;
      });
    },
    isMinimized(panelId) {
      return isWindowMinimized(states.value, panelId);
    },
    floatBoxOf(panelId) {
      return floatBoxOf(states.value, panelId);
    },
    clickTaskbar(button) {
      if (taskbarAction(button) === "minimize") this.minimize(button.panelId);
      else this.reveal(button.panelId);
    },
    reveal(panelId) {
      const live = api.value;
      if (!live) return;
      // A minimised window can be the one dockview calls active, and then
      // raising it would be skipped as a no-op — leaving the window in front
      // while the rest of the app still believes the user is elsewhere. Coming
      // back from the taskbar therefore always activates, which is what carries
      // that news; only a window that was already visible is left alone.
      const wasMinimized = isWindowMinimized(states.value, panelId);
      // State first, then raise: activating the panel notifies the app
      // synchronously, and what it asks is whether this window is minimised.
      apply(() => unminimizeWindow(live, panelId, states.value));
      raiseWindow(live, panelId, wasMinimized);
    },
    minimize(panelId) {
      apply((live) => minimizeWindow(live, panelId, states.value));
    },
    toggleShowDesktop() {
      apply((live) => {
        const result = toggleShowDesktop(
          states.value,
          live.panels.map((p) => p.id),
          showDesktopMinimized,
        );
        showDesktopMinimized = result.minimized;
        applyMinimized(live, result.states);
        return result.states;
      });
    },
    toggleMaximize,
    snapTo(panelId, box) {
      const live = api.value;
      if (!live) return;
      snapToBox(live, panelId, box);
      raiseWindow(live, panelId);
    },
    moveWindow(panelId, box) {
      const live = api.value;
      if (!live) return;
      snapToBox(live, panelId, box, undefined, false);
    },
    forget(panelId) {
      apply(() => forgetWindow(states.value, panelId));
    },
    resetDesktop(build) {
      const live = api.value;
      if (!live) return;
      localStorage.removeItem(LAYOUT_KEY);
      localStorage.removeItem(WINDOW_STATE_KEY);
      setStates(NO_WINDOWS);
      opened = 0;
      live.clear();
      build(live);
      saveLayout();
    },
  };
}
