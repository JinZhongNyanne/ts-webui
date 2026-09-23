import { getPanelData } from "dockview-vue";
import type { DockviewApi, IDockviewPanel } from "dockview-vue";
import type { Box, DesktopSize } from "./box";
import {
  desktopDropFor,
  floatTargetForDrop,
  landingBoxFor,
  tearOutBox,
  type DesktopDrop,
  type FloatTarget,
  type PanelDragData,
} from "./floatDrop";
import { contentOverlayOf, floatingWindows, overlayElementOf } from "./dockviewInternals";
import { anyMaximized } from "./maximizedWindows";
import type { TabSplit } from "./tabSplit";
import { isMaximized, setMaximized, setMinimized, stateOf, type WindowStates } from "./windowState";

/**
 * The dockview-facing half of the desktop: opening a window, raising it,
 * minimising it, maximising it. The rules themselves are pure and live in
 * `placement.ts`, `snap.ts` and `windowState.ts`; this file only applies them
 * to a live `DockviewApi`.
 */

/** Marks a minimised window. See `overlayElementOf` for why it is not `setVisible`. */
export const MINIMIZED_CLASS = "dv-window-minimized";

/** How to create a window that is not in the layout yet. */
export interface WindowSpec {
  readonly component: string;
  readonly title: string;
  readonly params?: Record<string, unknown>;
  readonly box: Box;
}

/**
 * Opens a window as a floating group at `spec.box`.
 *
 * dockview does not make a panel added this way active, so opening is normally
 * followed by an explicit activate — which is also what raises the window above
 * its siblings. A window opened in the background must *not* be activated:
 * activating it tells the rest of the app the user switched to it.
 */
export function openWindow(
  api: DockviewApi,
  panelId: string,
  spec: WindowSpec,
  activate = true,
): IDockviewPanel | null {
  // Adding a panel whose id is taken throws, so an already-open window is only raised.
  if (api.getPanel(panelId)) return api.getPanel(panelId) ?? null;
  const panel = api.addPanel({
    id: panelId,
    component: spec.component,
    title: spec.title,
    params: spec.params,
    floating: {
      x: spec.box.x,
      y: spec.box.y,
      width: spec.box.width,
      height: spec.box.height,
    },
  });
  if (activate) panel.api.setActive();
  return panel;
}

/**
 * The ids of every panel sharing a window with `panelId`, itself included.
 *
 * Minimising is a property of the *window*, not of a tab: stacked tabs share
 * one dockview group and therefore one overlay, so there is only one thing to
 * hide. Keying the state per panel but hiding per group is what let a stacked
 * pair end up half-minimised, with one of the two taskbar buttons unable to
 * bring the window back. Every panel in the group is moved together instead.
 *
 * A panel with no group (nothing is laid out yet) is its own window.
 */
function windowPanelIds(api: DockviewApi, panelId: string): readonly string[] {
  const group = api.getPanel(panelId)?.group;
  if (!group) return [panelId];
  const ids = api.panels.filter((p) => p.group === group).map((p) => p.id);
  return ids.length > 0 ? ids : [panelId];
}

/** The same minimised flag across a whole window, as a new state map. */
function setWindowMinimized(
  states: WindowStates,
  panelIds: readonly string[],
  minimized: boolean,
): WindowStates {
  return panelIds.reduce((acc, id) => setMinimized(acc, id, minimized), states);
}

/**
 * Un-minimises a window, without touching which one is in front.
 *
 * Raising is a separate step (`raiseWindow`) because activating a panel tells
 * the rest of the app the user switched to it, and it must only hear that once
 * this state — "no longer minimised" — is the state it will read.
 */
export function unminimizeWindow(
  api: DockviewApi,
  panelId: string,
  states: WindowStates,
): WindowStates {
  if (!api.getPanel(panelId)) return states;
  const next = setWindowMinimized(states, windowPanelIds(api, panelId), false);
  applyMinimized(api, next);
  return next;
}

/**
 * Brings a window to the front.
 *
 * dockview raises a floating window by moving its element to the end of the
 * dock, which tears the window's DOM out and puts it back — losing a keystroke
 * typed in that same frame — so a window that is already in front is left alone.
 *
 * `force` activates it anyway. Activating is also how the rest of the app hears
 * which window the user is in, and a *minimised* window can still be dockview's
 * active panel, so a window coming back from the taskbar has to be announced
 * even though dockview already calls it active. The caller decides; see
 * `useDesktop`'s `reveal`.
 */
export function raiseWindow(api: DockviewApi, panelId: string, force = false): void {
  const panel = api.getPanel(panelId);
  if (!panel) return;
  if (!force && api.activePanel?.id === panelId) return;
  panel.api.setActive();
}

/** Hides a window, leaving its taskbar button behind. */
export function minimizeWindow(
  api: DockviewApi,
  panelId: string,
  states: WindowStates,
): WindowStates {
  if (!api.getPanel(panelId)) return states;
  const next = setWindowMinimized(states, windowPanelIds(api, panelId), true);
  applyMinimized(api, next);
  return next;
}

/** One floating window a gesture has to reckon with: which window, and where. */
export interface FloatWindow {
  /** The id of its first tab, because a window is a group and any panel names it. */
  readonly id: string;
  readonly box: Box;
}

/**
 * The other floating windows that are actually on the desktop, one entry each.
 *
 * Two gestures ask this, and they have to ask it the same way or they would
 * disagree about what is on the desktop: a drag lines its window up against
 * these and fills the gaps between them (`useDesktop`), and a seam resize pushes
 * the ones on the seam about (`useSnapGroups`). One helper rather than a
 * collection each, which is how the two drifted apart before.
 *
 * - `dragged`, the window the gesture is about, is left out for the obvious
 *   reason that its own edges are always exactly zero away from themselves.
 * - A window whose every tab is minimised is left out: it is not where its box
 *   says it is, and as far as the user is concerned it is not on the desktop.
 *   One still showing any tab is, which is the rule `applyMinimized` hides a
 *   window by.
 * - A maximised window is left out because its box is the whole desktop.
 *   Aligning to it would be aligning to the desktop's own edges, there is no
 *   gap beside it to fill, and pushing it off a seam would either crush it or
 *   quietly un-maximise it.
 *
 * `isMinimized` is asked per panel, because that is how the state is keyed;
 * whether a window counts as away is decided here.
 */
export function visibleFloatWindows(
  api: DockviewApi,
  dragged: unknown,
  isMinimized: (panelId: string) => boolean,
): readonly FloatWindow[] {
  const windows = floatingWindows(api);
  const found: FloatWindow[] = [];
  const seen = new Set<unknown>();
  for (const panel of api.panels) {
    const group = panel.group;
    if (!group || group === dragged || seen.has(group)) continue;
    seen.add(group);
    const ids = api.panels.filter((p) => p.group === group).map((p) => p.id);
    const first = ids[0];
    if (first === undefined) continue;
    if (ids.every((id) => isMinimized(id))) continue;
    if (anyMaximized(ids)) continue;
    const box = windows.boxOf(group);
    if (box) found.push({ id: first, box });
  }
  return found;
}

/** Moves and resizes a window. Returns false when dockview would not let us. */
export function moveWindow(api: DockviewApi, panelId: string, box: Box): boolean {
  const group = api.getPanel(panelId)?.group;
  if (!group) return false;
  return floatingWindows(api).position(group, box);
}

/**
 * Fills the desktop with the window, or puts it back where it was.
 *
 * The box to come back to is ours to remember: dockview's own `maximize()`
 * returns without doing anything for a floating group.
 *
 * Nothing is recorded that cannot later be undone. A maximise whose current
 * box we cannot read is refused outright rather than performed against a
 * `null` restore — that combination leaves a full-screen window that the state
 * calls un-maximised, so the button becomes a permanent no-op and the desktop
 * saves it that way. The same goes the other way: the restore box is only
 * cleared once dockview has actually put the window back.
 */
export function toggleMaximizeWindow(
  api: DockviewApi,
  panelId: string,
  desktop: DesktopSize,
  states: WindowStates,
): WindowStates {
  const panel = api.getPanel(panelId);
  const group = panel?.group;
  if (!panel || !group) return states;
  const windows = floatingWindows(api);
  if (isMaximized(states, panelId)) {
    const restore = stateOf(states, panelId).restore;
    // Keep the window maximised when the move failed: a cleared restore box
    // would strand it full-screen with nothing left to come back to.
    if (!restore || !windows.position(group, restore)) return states;
    return setMaximized(states, panelId, null);
  }
  const current = windows.boxOf(group);
  if (!current) return states;
  const full = { x: 0, y: 0, width: desktop.width, height: desktop.height };
  if (!windows.position(group, full)) return states;
  panel.api.setActive();
  return setMaximized(states, panelId, current);
}

/**
 * Puts the minimised class on exactly the windows that are minimised.
 *
 * The class lives on the overlay, which a whole group shares, so a window is
 * hidden only when *every* panel in it is minimised. `minimizeWindow` already
 * moves a group's panels together, so this only ever has to reconcile state
 * that came from somewhere else — a restored layout, or a tab dragged into
 * another window — and it errs towards showing the window rather than hiding
 * a tab the user can no longer reach.
 */
export function applyMinimized(api: DockviewApi, states: WindowStates): void {
  const hidden = new Map<object, boolean>();
  for (const panel of api.panels) {
    const group = panel.group as object | null | undefined;
    if (!group) continue;
    const minimized = stateOf(states, panel.id).minimized;
    hidden.set(group, (hidden.get(group) ?? true) && minimized);
  }
  // The content is not inside the frame any more — `defaultRenderer: 'always'`
  // renders every panel into one shared overlay on the dock's shell — so the
  // window's own verdict has to be carried to each of its panels' content
  // overlays as well, or a minimised window leaves its contents on the desktop.
  // See `contentOverlayOf`.
  for (const panel of api.panels) {
    const group = panel.group as object | null | undefined;
    const minimized = group ? (hidden.get(group) ?? false) : false;
    const content = contentOverlayOf(panel);
    if (!content) continue;
    content.classList.toggle(MINIMIZED_CLASS, minimized);
    content.inert = minimized;
  }
  for (const [group, minimized] of hidden) {
    const element = overlayElementOf(group as { element?: unknown });
    if (!element) continue;
    element.classList.toggle(MINIMIZED_CLASS, minimized);
    // The class paints nothing, but a hidden window must also be unreachable,
    // and CSS cannot promise that: `visibility` is inherited, so a descendant
    // that sets `visibility: visible` (dockview's own stylesheet does, for the
    // active tab's close button) becomes focusable again inside a window the
    // user cannot see. `inert` is not inherited-and-overridable — it applies to
    // the subtree with no way out — and it costs no layout box.
    element.inert = minimized;
  }
}

/** What can be floated: whatever `addFloatingGroup` takes, a panel or a group. */
type Floatable = Parameters<DockviewApi["addFloatingGroup"]>[0];

/** The thing a `FloatTarget` names, or undefined if it is gone. */
function floatItem(api: DockviewApi, target: FloatTarget): Floatable | undefined {
  return target.type === "panel"
    ? api.getPanel(target.panelId)
    : api.groups.find((g) => g.id === target.groupId);
}

/**
 * Floats `target` as its own window at a client point, using the dock's own
 * box maths so a tear-out lands exactly where a centre-drop would.
 *
 * `root` is the dock's root; floating windows are positioned inside its
 * `.dv-dockview` grid, so the point is measured against that.
 */
function floatAtPoint(
  api: DockviewApi,
  root: HTMLElement,
  target: FloatTarget,
  clientX: number,
  clientY: number,
  remembered: RememberedBox,
): void {
  const item = floatItem(api, target);
  if (!item) return;
  // Every tear-out lands under the pointer. A tab that had its own window
  // before it was stacked comes back at that window's SIZE; one that never did
  // gets the default float size.
  const { x, y, width, height } = pointBox(
    root,
    clientX,
    clientY,
    target.type === "panel" ? remembered(target.panelId) : null,
  );
  api.addFloatingGroup(item, { x, y, width, height });
  if (target.type === "panel") api.getPanel(target.panelId)?.api.setActive();
}

/**
 * The box a panel's own window last had, or `null` for one that never had a
 * window of its own. Supplied by the desktop, which is what remembers it.
 */
export type RememberedBox = (panelId: string) => Box | null;

/** A tear-out that knows nothing, for callers with no memory to offer. */
const FORGETS: RememberedBox = () => null;

/**
 * How a drop that splits the window underneath is wired to the rest of the
 * shell. Supplied by `useTabDrop`, which is what watches the drag; see there
 * for why a tab drag needs its own tracking at all.
 */
export interface SplitOnDrop {
  /**
   * The split armed for that window, or `null` — because the drag never rested
   * long enough, or because this quadrant is not a split at all.
   */
  armed(group: unknown): TabSplit | null;
  /**
   * Puts an existing window in a box, as `DesktopDropOptions.moveTo` does: a
   * window that moves has to be recorded, saved, and have its maximised state
   * settled, none of which a bare reposition does.
   */
  moveTo(panelId: string, box: Box): void;
  /**
   * The box a desktop snap — a screen-edge zone or a window-to-window snap —
   * armed for that tab's window, or `null`. Also `useTabDrop`'s, which is what
   * watched the drag; absent, a drop never snaps.
   */
  landing?(panelId: string): Box | null;
}

/**
 * Commits an armed split, or reports that it could not.
 *
 * The window underneath moves FIRST, for two reasons. It is the one being taken
 * something away from, so it must not be seen to jump *after* the new window has
 * appeared beside it; and moving a window raises it, which would otherwise put
 * the window underneath on top of the tab the user just dropped. Floating the
 * tab second, and activating it, leaves the new window in front — where the
 * thing you just dragged belongs.
 *
 * A tab alone in its window is moved rather than floated: it already *is* a
 * window, and tearing it out would destroy and rebuild the very thing being
 * dragged, reloading everything inside it (commit c40b76b).
 *
 * Only a single tab can split a window. A whole window dragged by its header
 * space is a move gesture of its own, and `useTabDrop` never arms for one.
 */
function splitOnto(
  api: DockviewApi,
  target: FloatTarget,
  split: TabSplit,
  onDrop: SplitOnDrop,
  group: unknown,
): boolean {
  if (target.type !== "panel") return false;
  const item = floatItem(api, target);
  if (!item) return false;
  const underId = underPanelId(api, group);
  if (!underId) return false;
  onDrop.moveTo(underId, split.under);
  // The tab keeps its window when it is the window: see above.
  if (windowPanelIds(api, target.panelId).length <= 1) {
    onDrop.moveTo(target.panelId, split.tab);
    return true;
  }
  api.addFloatingGroup(item, split.tab);
  api.getPanel(target.panelId)?.api.setActive();
  return true;
}

/**
 * Which panel of the window underneath is moved on its behalf.
 *
 * Moving is per panel because the state it settles — "is this window still
 * maximised?" — is recorded per panel, so the tab in FRONT is the one to name:
 * it is the tab whose title bar carries the maximise button the user pressed.
 * A window with no panels at all cannot be moved, and the split is refused
 * rather than half-applied.
 */
function underPanelId(api: DockviewApi, group: unknown): string | null {
  const active = (group as { activePanel?: { id?: unknown } } | null)?.activePanel?.id;
  if (typeof active === "string") return active;
  return api.panels.find((panel) => (panel.group as unknown) === group)?.id ?? null;
}

/**
 * Makes a tab dropped on a window's content tear out into its own window
 * instead of joining that window. `dockElement` is the dock's root.
 *
 * With no grid to dock into, this and the desktop below are the only ways to
 * un-stack a tab.
 *
 * With a `splitOnDrop` whose dwell has been served, the drop does more than tear
 * out: the tab becomes a window filling half of the window it was dropped on,
 * and that window shrinks into the other half, so the two sit side by side
 * instead of overlapping. Everything else — the centre quadrant, a drag the
 * dwell never armed, a window too small to halve — tears out at the pointer
 * exactly as before.
 */
export function installFloatOnDrop(
  api: DockviewApi,
  dockElement: () => HTMLElement | null,
  remembered: RememberedBox = FORGETS,
  splitOnDrop?: SplitOnDrop,
): { dispose(): void } {
  return api.onWillDrop((event) => {
    const target = floatTargetForDrop(
      { kind: event.kind, position: event.position, data: event.getData() },
      api.id,
    );
    const root = dockElement();
    if (!target || !root || !floatItem(api, target)) return;
    event.preventDefault();
    // A split is aimed at the one window under the pointer, so it outranks a
    // desktop snap; see `useTabDrop` for the whole order.
    const split = splitOnDrop?.armed(event.group) ?? null;
    if (split && splitOnDrop && splitOnto(api, target, split, splitOnDrop, event.group)) return;
    if (target.type === "panel" && splitOnDrop) {
      const { clientX, clientY } = event.nativeEvent;
      const landing = tabLandingAt(api, root, target.panelId, clientX, clientY, remembered);
      const snapped = splitOnDrop.landing?.(target.panelId) ?? null;
      if (landing && landTab(api, landing, snapped, splitOnDrop.moveTo)) return;
    }
    floatAtPoint(
      api,
      root,
      target,
      event.nativeEvent.clientX,
      event.nativeEvent.clientY,
      remembered,
    );
  });
}

/** How a desktop drop is wired to the rest of the shell. */
export interface DesktopDropOptions {
  /** Reads the in-flight drag; injectable for tests, dockview's own store in production. */
  readonly readDrag?: () => PanelDragData;
  /** The box a panel's own window last had; see `RememberedBox`. */
  readonly remembered?: RememberedBox;
  /**
   * Puts an existing window in a box, the way picking a Snap Layouts tile
   * does. Supplied by the desktop, because a window that moves has to be
   * recorded and saved, not merely repositioned.
   */
  readonly moveTo?: (panelId: string, box: Box) => void;
  /** The box a desktop snap armed for that tab's window; see `SplitOnDrop.landing`. */
  readonly landing?: (panelId: string) => Box | null;
}

/**
 * The box a window of `preferred` size takes when dropped at a client point,
 * measured against the element dockview positions floats inside.
 */
function pointBox(root: HTMLElement, clientX: number, clientY: number, preferred: Box | null): Box {
  const host = root.querySelector<HTMLElement>(".dv-dockview") ?? root;
  const rect = host.getBoundingClientRect();
  return tearOutBox(preferred, clientX - rect.left, clientY - rect.top, rect.width, rect.height);
}

/** The desktop surface, which dockview renders in its watermark slot. */
const DESKTOP_SELECTOR = "[data-testid=desktop]";

/**
 * Whether an event target is on the empty desktop behind the windows — the one
 * place `installDesktopFloatOnDrop` takes a drop.
 *
 * Exported because the tab drag asks it too, to know whether a `dragover` no
 * window announced is still over somewhere a release would land a window. Duck
 * typed, as `useDesktop`'s click targets are, so the question needs no DOM.
 */
export function overDesktop(target: unknown): boolean {
  const node = target as { closest?: unknown } | null;
  if (!node || typeof node.closest !== "function") return false;
  return !!(node as { closest(selector: string): unknown }).closest(DESKTOP_SELECTOR);
}

/** The rectangle floating windows are positioned in, in client coordinates. */
export interface HostRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Where the grid dockview positions floats inside is on screen, or `null` for a
 * root that cannot say.
 *
 * Every tab-drop box is measured against this and nothing else, so the hover
 * and the release — and the pointer and the windows' own boxes — share one
 * origin.
 */
export function hostRectOf(root: HTMLElement): HostRect | null {
  const host = root.querySelector?.<HTMLElement>(".dv-dockview") ?? root;
  if (typeof host.getBoundingClientRect !== "function") return null;
  const { left, top, width, height } = host.getBoundingClientRect();
  return { left, top, width, height };
}

/** The window a tab drop leaves behind, before any snap: see `landingBoxFor`. */
export interface TabLanding {
  readonly panelId: string;
  /** `move` for a tab alone in its window, `tear` for one that shares it. */
  readonly type: DesktopDrop["type"];
  /** Where an unsnapped release puts it, relative to the host. */
  readonly box: Box;
  /**
   * The window being moved, which is therefore not a neighbour to line up with,
   * or `null` for a tear-out, whose source window stays where it is.
   */
  readonly moving: unknown;
  /** The host the box is measured in. */
  readonly host: HostRect;
}

/**
 * The window a release of `panelId`'s tab at a client point would leave, or
 * `null` when the dock cannot be measured or the panel is gone.
 *
 * Asked by both the drop and, frame by frame, the drag (`useTabDrop`), which is
 * the point: one answer, so a window-to-window snap lines up the very box the
 * release would otherwise put down.
 */
export function tabLandingAt(
  api: DockviewApi,
  root: HTMLElement,
  panelId: string,
  clientX: number,
  clientY: number,
  remembered: RememberedBox,
): TabLanding | null {
  const host = hostRectOf(root);
  const group = api.getPanel(panelId)?.group;
  if (!host || !group) return null;
  const type = windowPanelIds(api, panelId).length <= 1 ? "move" : "tear";
  const current = floatingWindows(api).boxOf(group);
  const box = landingBoxFor(
    type,
    { current, remembered: remembered(panelId) },
    clientX - host.left,
    clientY - host.top,
    host.width,
    host.height,
  );
  return { panelId, type, box, moving: type === "move" ? group : null, host };
}

/**
 * Puts a dropped tab's window down: in `snapped` if a desktop snap armed one,
 * otherwise where `landing` says. False when nothing could be done, so the
 * caller can fall back.
 *
 * A tab alone in its window moves that window rather than rebuilding it, on
 * every surface, for the reason `splitOnto` gives (commit c40b76b).
 *
 * A torn-out tab is floated at the pointer FIRST and only then moved into the
 * snapped box, rather than floated straight into it. The move is what records a
 * window's new box — above all, a snap to the top edge fills the desktop and
 * has to be recorded as maximised, with somewhere to come back to — and the box
 * it comes back to is the one it would have had unsnapped, just as a window
 * dragged by its tab bar comes back to where it was before the drag. Both
 * happen in the same task, so nothing is painted in between.
 */
function landTab(
  api: DockviewApi,
  landing: TabLanding,
  snapped: Box | null,
  moveTo: ((panelId: string, box: Box) => void) | undefined,
): boolean {
  if (!moveTo) return false;
  if (landing.type === "move") {
    moveTo(landing.panelId, snapped ?? landing.box);
    return true;
  }
  const item = api.getPanel(landing.panelId);
  if (!item) return false;
  api.addFloatingGroup(item, landing.box);
  item.api.setActive();
  if (snapped) moveTo(landing.panelId, snapped);
  return true;
}

/**
 * Makes a tab dropped on the empty desktop land there.
 *
 * A tab that shares its window tears out into a window of its own at the drop
 * point; a tab that is alone in its window moves that window there instead,
 * which is what `options.moveTo` is for. Without a `moveTo` the desktop has no
 * way to record a move, so that gesture is refused outright — visibly, by the
 * browser's own "cannot drop here" cursor — rather than accepted and dropped
 * on the floor.
 *
 * dockview has no drop target of its own behind the windows — the root one is
 * off, deliberately, so nothing can dock into the grid and bury the icons — so
 * the desktop's own `dragover`/`drop` are handled here. They are delegated from
 * the dock's root, the way the window controls are, because dockview builds and
 * rebuilds the watermark itself.
 *
 * A drag is only taken when `getPanelData()` says it is *this* dock's panel
 * drag; anything else (a file from the OS above all) is left alone — not even
 * `dragover` is prevented, so the browser goes on treating the desktop as a
 * surface that does not accept it.
 *
 * `options.readDrag` is injectable for tests; production reads dockview's own
 * store.
 */
export function installDesktopFloatOnDrop(
  api: DockviewApi,
  dockElement: () => HTMLElement | null,
  options: DesktopDropOptions = {},
): { dispose(): void } {
  const root = dockElement();
  if (!root) return { dispose: () => undefined };
  const readDrag = options.readDrag ?? getPanelData;
  const remembered = options.remembered ?? FORGETS;
  const moveTo = options.moveTo;

  /** What this drag would do, or null to let the browser have it. */
  const dropFor = (event: DragEvent): DesktopDrop | null => {
    if (!overDesktop(event.target)) return null;
    const data = readDrag();
    const panelId = data?.panelId;
    const alone = !panelId || windowPanelIds(api, panelId).length <= 1;
    const drop = desktopDropFor({ data, alone }, api.id);
    return drop?.type === "move" && !moveTo ? null : drop;
  };

  const onDragOver = (event: DragEvent): void => {
    if (!dropFor(event)) return;
    // Only a prevented `dragover` makes a surface droppable at all.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  };
  const onDrop = (event: DragEvent): void => {
    const drop = dropFor(event);
    if (!drop) return;
    event.preventDefault();
    const landing = tabLandingAt(api, root, drop.panelId, event.clientX, event.clientY, remembered);
    // A tab alone in its window moves the window itself — keeping its size —
    // and a stacked one tears out; either way into the box a desktop snap
    // armed, if the drag armed one. Moving is the desktop's job — it has to
    // record the new box and save the layout, which a bare reposition does
    // not — so it is handed back rather than done here.
    const snapped = options.landing?.(drop.panelId) ?? null;
    if (landing && landTab(api, landing, snapped, moveTo)) return;
    if (drop.type === "tear") {
      const target: FloatTarget = { type: "panel", panelId: drop.panelId };
      floatAtPoint(api, root, target, event.clientX, event.clientY, remembered);
    }
  };

  root.addEventListener("dragover", onDragOver);
  // In the capture phase, so the drop is decided before anything bubbling to the
  // root reacts to it — `useTabDrop` forgets what it armed on this very event,
  // and must not get there first. Nothing inside the dock is robbed of it: the
  // desktop surface has no drop target of dockview's.
  root.addEventListener("drop", onDrop, true);
  return {
    dispose: () => {
      root.removeEventListener("dragover", onDragOver);
      root.removeEventListener("drop", onDrop, true);
    },
  };
}
