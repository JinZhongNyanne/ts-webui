import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shallowRef } from "vue";
import type { Box } from "./box";
import { usableDesktop, type DesktopSize } from "./box";
import { dragSnapFor, NO_DRAG_SNAP } from "./dragSnap";
import type { PanelDragData } from "./floatDrop";
import { snapBox } from "./snap";
import { DWELL_MS } from "./snapDwell";
import type { SnapDwelling } from "./snapFeedback";
import { splitFor } from "./tabSplit";
import { useTabDrop } from "./useTabDrop";

/**
 * A tab drag is native HTML5 drag-and-drop, so there is no pointer to fake and
 * no DOM in this suite: the hook is driven by handing its own handlers the
 * shapes dockview hands them — an overlay event per `dragover`, and the dock
 * root's own listeners for everything that happens off a window.
 */

/** The window underneath, as its overlay serialises it. */
const UNDER: Box = { x: 100, y: 50, width: 800, height: 600 };
const OTHER: Box = { x: 40, y: 40, width: 500, height: 400 };

const DOCK_ID = "dock";
/** The size the fake dock's grid measures, and the desktop that makes. */
const HOST = { left: 0, top: 0, width: 1200, height: 800 };
const DESKTOP = usableDesktop(HOST.width, HOST.height) as DesktopSize;

let clock: number;
let timers: { fn: () => void; delay: number }[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (event: any) => void;
let rootListeners: Map<string, Set<Listener>>;

beforeEach(() => {
  clock = 1000;
  timers = [];
  rootListeners = new Map();
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  vi.stubGlobal("window", {
    setTimeout: (fn: () => void, delay: number) => timers.push({ fn, delay }),
    clearTimeout: (id: number) => {
      if (timers[id - 1]) timers[id - 1] = { fn: () => void 0, delay: 0 };
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Runs whatever the hook deferred, as the browser would after the delay. */
function runTimers(): void {
  const due = timers;
  timers = [];
  for (const timer of due) timer.fn();
}

interface DockOptions {
  /** The box each window's overlay reports, by window index. */
  readonly boxes?: readonly (Box | null)[];
}

/**
 * A dock with two windows: `chat` in window 0 — where the dragged tab lives —
 * and `tree` plus `info` stacked in window 1, the one being dropped on.
 */
function fakeDock(options: DockOptions = {}) {
  const boxes = options.boxes ?? [OTHER, UNDER];
  const windows = [["chat"], ["tree", "info"]];
  const groups = windows.map((_, index) => ({ id: `group-${index}` }));
  const panels = windows.flatMap((ids, index) => ids.map((id) => ({ id, group: groups[index] })));
  const floatingGroups = groups.map((group, index) => ({
    group,
    overlay: {
      element: { parentElement: { getBoundingClientRect: () => ({ width: 0, height: 0 }) } },
      toJSON: () => {
        const box = boxes[index];
        return box ? { left: box.x, top: box.y, width: box.width, height: box.height } : null;
      },
    },
    position: () => void 0,
  }));
  let overlay: Listener | null = null;
  const api = {
    id: DOCK_ID,
    panels,
    getPanel: (id: string) => panels.find((panel) => panel.id === id),
    component: { floatingGroups, onDidEndFloatingGroupDrag: () => ({ dispose: () => void 0 }) },
    onWillShowOverlay: (handler: Listener) => {
      overlay = handler;
      return { dispose: () => (overlay = null) };
    },
  };
  const root = {
    querySelector: () => null,
    getBoundingClientRect: () => HOST,
    addEventListener: (type: string, listener: Listener) => {
      const set = rootListeners.get(type) ?? new Set<Listener>();
      set.add(listener);
      rootListeners.set(type, set);
    },
    removeEventListener: (type: string, listener: Listener) => {
      rootListeners.get(type)?.delete(listener);
    },
  };
  return {
    api,
    root: root as unknown as HTMLElement,
    groups,
    fireOverlay: (event: Record<string, unknown>) => overlay?.(event),
    fireOnRoot: (type: string, event: Record<string, unknown>) => {
      for (const listener of [...(rootListeners.get(type) ?? [])]) listener(event);
    },
  };
}

interface Harness {
  readonly preview: ReturnType<typeof shallowRef<Box | null>>;
  readonly dwelling: ReturnType<typeof shallowRef<SnapDwelling | null>>;
  readonly dock: ReturnType<typeof fakeDock>;
  readonly drop: ReturnType<typeof useTabDrop>;
  readonly handle: { dispose(): void };
  /** One `dragover` frame over a window, overlay event and all. */
  hover(over?: Record<string, unknown>): void;
}

interface InstallOptions extends DockOptions {
  readonly minimized?: readonly string[];
  /** The two taskbar switches; both off unless a test is about them. */
  readonly toEdges?: boolean;
  readonly toWindows?: boolean;
  /** The drag in flight, as dockview's store would report it off a window. */
  readonly dragging?: PanelDragData;
  /** The box each panel's own window last had. */
  readonly remembered?: Readonly<Record<string, Box>>;
}

/** The drag payload for a tab of this dock. */
const tabOf = (panelId: string, groupId: string): PanelDragData => ({
  viewId: DOCK_ID,
  groupId,
  panelId,
});

/** A hook installed on a fresh fake dock, with nothing minimised. */
function installed(options: InstallOptions = {}): Harness {
  const preview = shallowRef<Box | null>(null);
  const dwelling = shallowRef<SnapDwelling | null>(null);
  const dock = fakeDock(options);
  const minimized = options.minimized ?? [];
  const drop = useTabDrop(preview, dwelling, (id) => minimized.includes(id), {
    modes: () => ({ toEdges: options.toEdges ?? false, toWindows: options.toWindows ?? false }),
    readDrag: () => options.dragging ?? tabOf("chat", "group-0"),
    remembered: (id) => options.remembered?.[id] ?? null,
  });
  const handle = drop.install(dock.api, dock.root);
  const hover = (over: Record<string, unknown> = {}): void => {
    const native = { clientX: 120, clientY: 300, ...((over.nativeEvent as object) ?? {}) };
    const event = {
      kind: "content",
      position: "left",
      group: dock.groups[1],
      getData: () => ({ viewId: DOCK_ID, groupId: "group-0", panelId: "chat" }),
      ...over,
      nativeEvent: native,
    };
    // Every `dragover` reaches dockview's drop target first and the dock root
    // after, which is how the hook tells a window hover from a desktop one.
    dock.fireOverlay(event);
    dock.fireOnRoot("dragover", native);
  };
  return { preview, dwelling, dock, drop, handle, hover };
}

describe("useTabDrop", () => {
  it("shows nothing on the frame the drag first reaches the edge", () => {
    const { preview, drop, hover } = installed();
    hover();
    expect(preview.value).toBeNull();
    expect(drop.armed()).toBeNull();
  });

  /*
   * A tab drag gets the same two-state feedback a window drag does: an outline
   * of the half while the drag has to keep resting there, and only then the
   * solid preview that means a release would commit it. dockview's own instant
   * edge highlight — which said "release now" from the first frame — is off; see
   * `dropOverlay.css`.
   */
  it("outlines the half it is waiting on, while arming nothing", () => {
    const { preview, dwelling, drop, hover } = installed();
    hover();
    expect(dwelling.value).toEqual({ box: splitFor(UNDER, "left")?.tab, since: clock });
    expect(preview.value).toBeNull();
    expect(drop.armed()).toBeNull();
  });

  it("gives the outline up to the solid preview once the wait is served", () => {
    const { preview, dwelling, hover } = installed();
    hover();
    clock += DWELL_MS;
    hover();
    expect(dwelling.value).toBeNull();
    expect(preview.value).toEqual(splitFor(UNDER, "left")?.tab);
  });

  it("takes the outline down when the drag leaves every window", () => {
    const { dwelling, dock, hover } = installed();
    hover();
    expect(dwelling.value).not.toBeNull();
    dock.fireOnRoot("dragover", { clientX: 10, clientY: 10 });
    expect(dwelling.value).toBeNull();
  });

  it("outlines nothing for a window whose box cannot be read", () => {
    // No box, no promise — before the wait as well as after it.
    const { dwelling, preview, hover } = installed({ boxes: [OTHER, null] });
    hover();
    expect(dwelling.value).toBeNull();
    expect(preview.value).toBeNull();
  });

  it("previews the tab's half once the drag has rested there", () => {
    const { preview, hover } = installed();
    hover();
    clock += DWELL_MS;
    hover();
    expect(preview.value).toEqual(splitFor(UNDER, "left")?.tab);
  });

  it("arms the split the drop will commit, naming the window underneath", () => {
    const { dock, drop, hover } = installed();
    hover();
    clock += DWELL_MS;
    hover();
    const armed = drop.armed();
    expect(armed?.group).toBe(dock.groups[1]);
    expect(armed?.split).toEqual(splitFor(UNDER, "left"));
  });

  it("offers the split only for the window the drag rested on", () => {
    const { dock, drop, hover } = installed();
    hover();
    clock += DWELL_MS;
    hover();
    expect(drop.armedFor(dock.groups[1])).toEqual(splitFor(UNDER, "left"));
    expect(drop.armedFor(dock.groups[0])).toBeNull();
    expect(drop.armedFor(undefined)).toBeNull();
  });

  it("arms each edge of the window it is over", () => {
    const { drop, hover } = installed();
    hover({ position: "bottom" });
    clock += DWELL_MS;
    hover({ position: "bottom" });
    expect(drop.armed()?.split).toEqual(splitFor(UNDER, "bottom"));
  });

  // A hand held still on a stationary tab produces no further `dragover` in
  // some browsers, so the dwell has to be able to serve itself.
  it("serves the dwell from a timer when the drag events stop repeating", () => {
    const { preview, drop, hover } = installed();
    hover();
    expect(timers.length).toBe(1);
    clock += DWELL_MS;
    runTimers();
    expect(preview.value).toEqual(splitFor(UNDER, "left")?.tab);
    expect(drop.armed()).not.toBeNull();
  });

  // The dwell is served once per drag, not once per target: having waited out
  // half a second on one edge, the user is plainly aiming, and the next edge
  // arms straight away. The hook needs nothing for this: it asks `dwell()` and
  // obeys the answer.
  it("carries a served dwell over to another edge", () => {
    const { drop, hover } = installed();
    hover();
    clock += DWELL_MS;
    hover();
    clock += 20;
    hover({ position: "right", nativeEvent: { clientX: 800, clientY: 300 } });
    expect(drop.armed()?.split).toEqual(splitFor(UNDER, "right"));
  });

  it("keeps the centre a tear-out, however long the drag rests on it", () => {
    const { preview, drop, hover } = installed();
    hover({ position: "center" });
    clock += DWELL_MS;
    hover({ position: "center" });
    expect(preview.value).toBeNull();
    expect(drop.armed()).toBeNull();
  });

  it("leaves a drop on the tab bar to dockview", () => {
    const { preview, hover } = installed();
    hover({ kind: "tab" });
    clock += DWELL_MS;
    hover({ kind: "tab" });
    expect(preview.value).toBeNull();
  });

  it("does nothing over the window the dragged tab already lives in", () => {
    const { preview, dock, hover } = installed();
    const over = { group: dock.groups[0] };
    hover(over);
    clock += DWELL_MS;
    hover(over);
    expect(preview.value).toBeNull();
  });

  it("ignores a drag that did not come from this dock", () => {
    const { preview, hover } = installed();
    const foreign = { getData: () => ({ viewId: "elsewhere", groupId: "g", panelId: "chat" }) };
    hover(foreign);
    clock += DWELL_MS;
    hover(foreign);
    expect(preview.value).toBeNull();
  });

  it("ignores a whole-window drag, which dockview moves itself", () => {
    const { preview, hover } = installed();
    const group = { getData: () => ({ viewId: DOCK_ID, groupId: "group-0", panelId: null }) };
    hover(group);
    clock += DWELL_MS;
    hover(group);
    expect(preview.value).toBeNull();
  });

  // An invisible window is nothing to split: the preview would promise a window
  // where there is only wallpaper.
  it("refuses to split a minimised window", () => {
    const { preview, hover } = installed({ minimized: ["tree", "info"] });
    hover();
    clock += DWELL_MS;
    hover();
    expect(preview.value).toBeNull();
  });

  it("splits a window one of whose tabs is still on the desktop", () => {
    const { preview, hover } = installed({ minimized: ["info"] });
    hover();
    clock += DWELL_MS;
    hover();
    expect(preview.value).not.toBeNull();
  });

  it("refuses a window whose box it cannot read", () => {
    const { preview, hover } = installed({ boxes: [OTHER, null] });
    hover();
    clock += DWELL_MS;
    hover();
    expect(preview.value).toBeNull();
  });

  it("refuses a window too small to halve", () => {
    const tiny: Box = { x: 0, y: 0, width: 200, height: 600 };
    const { preview, hover } = installed({ boxes: [OTHER, tiny] });
    hover();
    clock += DWELL_MS;
    hover();
    expect(preview.value).toBeNull();
  });

  it("clears the preview when the drag moves onto the empty desktop", () => {
    const { preview, dock, drop, hover } = installed();
    hover();
    clock += DWELL_MS;
    hover();
    dock.fireOnRoot("dragover", { clientX: 900, clientY: 700 });
    expect(preview.value).toBeNull();
    expect(drop.armed()).toBeNull();
  });

  it("forgets everything once the drag is over", () => {
    const { preview, dock, drop, hover } = installed();
    hover();
    clock += DWELL_MS;
    hover();
    dock.fireOnRoot("dragend", {});
    expect(preview.value).toBeNull();
    expect(drop.armed()).toBeNull();
  });

  // The drop reads `armed()` while dockview's own `drop` is still bubbling, so
  // the reset has to wait for the event to reach the root.
  it("still knows what was armed when the drop bubbles up", () => {
    const { dock, drop, hover } = installed();
    hover();
    clock += DWELL_MS;
    hover();
    expect(drop.armed()).not.toBeNull();
    dock.fireOnRoot("drop", {});
    expect(drop.armed()).toBeNull();
  });

  // A window drag's own preview belongs to `useDesktop`; a tab drag that armed
  // nothing must not wipe it.
  it("never clears a preview it did not put up", () => {
    const { preview, dock, hover } = installed();
    const mine: Box = { x: 0, y: 0, width: 600, height: 800 };
    preview.value = mine;
    hover({ position: "center" });
    dock.fireOnRoot("dragover", { clientX: 900, clientY: 700 });
    expect(preview.value).toBe(mine);
  });

  // The dock lives under a `v-if` on the connection state and on the mobile
  // breakpoint, so `onReady` runs again after every reconnect and every
  // breakpoint crossing — on a *new* element, with the same hook. The listeners
  // die with the old element, but the hook's own state does not: a stale
  // ownership of the shared preview would let a later tab drag clear a
  // rectangle a *window* drag had put up, which is the one thing sharing that
  // ref is meant to prevent.
  it("lets go of what it owned when it is installed again", () => {
    const { preview, drop, hover } = installed();
    hover();
    clock += DWELL_MS;
    hover();
    expect(preview.value).not.toBeNull();

    const second = fakeDock();
    drop.install(second.api, second.root);

    expect(preview.value).toBeNull();
    // Only the new dock's listeners are left; the old element's went with it.
    expect([...(rootListeners.get("dragover") ?? [])].length).toBe(1);
    // A window drag's preview is now the only thing on screen, and a frame over
    // the empty desktop is no reason to take it down.
    const mine: Box = { x: 0, y: 0, width: 600, height: 800 };
    preview.value = mine;
    second.fireOnRoot("dragover", { clientX: 900, clientY: 700 });
    expect(preview.value).toBe(mine);
  });

  it("stops listening once disposed", () => {
    const { preview, handle, hover } = installed();
    handle.dispose();
    expect([...(rootListeners.get("dragover") ?? [])].length).toBe(0);
    hover();
    clock += DWELL_MS;
    hover();
    expect(preview.value).toBeNull();
  });
});

/*
 * A tab dragged anywhere a release would land a window — the empty desktop, or
 * the centre of a window, which tears out — now snaps exactly as a window
 * dragged by its tab bar does, through the same decision (`dragSnap.ts`).
 */
describe("useTabDrop's desktop snapping", () => {
  /** The desktop surface, as a `dragover` target's `closest` finds it. */
  const ON_DESKTOP = {
    closest: (selector: string) => (selector.includes("desktop") ? {} : null),
  };

  /** One `dragover` over the empty desktop at a client point. */
  function overDesktop(dock: ReturnType<typeof fakeDock>, clientX: number, clientY: number) {
    dock.fireOnRoot("dragover", { target: ON_DESKTOP, clientX, clientY });
  }

  /** Two frames at the same place, half a second apart: a served dwell. */
  function rest(dock: ReturnType<typeof fakeDock>, clientX: number, clientY: number) {
    overDesktop(dock, clientX, clientY);
    clock += DWELL_MS;
    overDesktop(dock, clientX, clientY);
  }

  it("outlines the half a tab at the screen's edge would take, then promises it", () => {
    const { preview, dwelling, dock, drop } = installed({ toEdges: true });
    overDesktop(dock, 5, 400);
    expect(dwelling.value).toEqual({ box: snapBox("left", DESKTOP), since: clock });
    expect(preview.value).toBeNull();
    expect(drop.landingFor("chat")).toBeNull();
    clock += DWELL_MS;
    overDesktop(dock, 5, 400);
    expect(dwelling.value).toBeNull();
    expect(preview.value).toEqual(snapBox("left", DESKTOP));
    expect(drop.landingFor("chat")).toEqual(snapBox("left", DESKTOP));
  });

  it("serves the wait from a timer when the drag holds still", () => {
    const { preview, dock } = installed({ toEdges: true });
    overDesktop(dock, 5, 400);
    clock += DWELL_MS;
    runTimers();
    expect(preview.value).toEqual(snapBox("left", DESKTOP));
  });

  it("offers no zone while screen-edge snapping is off", () => {
    const { preview, dwelling, dock, drop } = installed({ toEdges: false });
    rest(dock, 5, 400);
    expect(dwelling.value).toBeNull();
    expect(preview.value).toBeNull();
    expect(drop.landingFor("chat")).toBeNull();
  });

  it("offers nothing under the free-drag modifier", () => {
    const { preview, dock } = installed({ toEdges: true });
    const alt = { target: ON_DESKTOP, clientX: 5, clientY: 400, altKey: true };
    dock.fireOnRoot("dragover", alt);
    clock += DWELL_MS;
    dock.fireOnRoot("dragover", alt);
    expect(preview.value).toBeNull();
  });

  /*
   * A lone tab's window is MOVED by the drop, keeping its size, to the box
   * `landingBoxFor` puts under the pointer — so that is the box lined up, and
   * the window being moved is no neighbour of its own.
   */
  it("lines a moved window up with its neighbour, shadowing where it will land", () => {
    const current: Box = { x: 700, y: 500, width: 300, height: 200 };
    const neighbour: Box = { x: 600, y: 100, width: 400, height: 400 };
    const { preview, dwelling, dock, drop } = installed({
      toWindows: true,
      boxes: [current, neighbour],
    });
    // The window-to-be would sit at x 295..595, 5px short of the neighbour.
    const clientX = 445;
    const clientY = 116;
    const expected = dragSnapFor({
      pointer: { x: clientX, y: clientY },
      box: { x: 295, y: 100, width: 300, height: 200 },
      others: [neighbour],
      desktop: DESKTOP,
      toEdges: false,
      toWindows: true,
      suspended: false,
      holdTop: false,
      current: NO_DRAG_SNAP,
    });
    expect(expected.window).not.toBeNull();
    overDesktop(dock, clientX, clientY);
    expect(dwelling.value?.box).toEqual(expected.box);
    clock += DWELL_MS;
    overDesktop(dock, clientX, clientY);
    expect(preview.value).toEqual(expected.box);
    expect(drop.landingFor("chat")).toEqual(expected.box);
  });

  // A torn-out tab leaves its source window where it is, so that window is
  // one of the neighbours; and the new window comes out at the size its own
  // window last had.
  it("lines a torn-out tab up at the size the tear-out gives it", () => {
    const source: Box = { x: 600, y: 100, width: 400, height: 400 };
    const elsewhere: Box = { x: 0, y: 600, width: 200, height: 150 };
    const remembered: Box = { x: 0, y: 0, width: 300, height: 200 };
    const { preview, dock, drop } = installed({
      toWindows: true,
      boxes: [elsewhere, source],
      dragging: tabOf("tree", "group-1"),
      remembered: { tree: remembered },
    });
    const expected = dragSnapFor({
      pointer: { x: 445, y: 116 },
      box: { x: 295, y: 100, width: 300, height: 200 },
      others: [elsewhere, source],
      desktop: DESKTOP,
      toEdges: false,
      toWindows: true,
      suspended: false,
      holdTop: false,
      current: NO_DRAG_SNAP,
    });
    expect(expected.window).not.toBeNull();
    rest(dock, 445, 116);
    expect(preview.value).toEqual(expected.box);
    expect(drop.landingFor("tree")).toEqual(expected.box);
  });

  it("names only the tab whose drag armed it", () => {
    const { dock, drop } = installed({ toEdges: true });
    rest(dock, 5, 400);
    expect(drop.landingFor("chat")).not.toBeNull();
    expect(drop.landingFor("tree")).toBeNull();
  });

  it("forgets a desktop snap when the drag moves somewhere a release lands nothing", () => {
    const { preview, dock, drop } = installed({ toEdges: true });
    rest(dock, 5, 400);
    dock.fireOnRoot("dragover", { target: { closest: () => null }, clientX: 5, clientY: 400 });
    expect(preview.value).toBeNull();
    expect(drop.landingFor("chat")).toBeNull();
  });

  it("ignores a drag over the desktop that is not this dock's tab", () => {
    const { preview, dock } = installed({
      toEdges: true,
      dragging: { viewId: "elsewhere", groupId: "g", panelId: "chat" },
    });
    rest(dock, 5, 400);
    expect(preview.value).toBeNull();
  });

  // Dropping on a window's centre tears out — a release that lands a window,
  // so it snaps like one dropped on the desktop.
  it("snaps a tab over another window's centre", () => {
    const flush: Box = { x: 0, y: 0, width: 800, height: 600 };
    const { preview, drop, hover } = installed({ toEdges: true, boxes: [OTHER, flush] });
    const centre = { position: "center", nativeEvent: { clientX: 5, clientY: 300 } };
    hover(centre);
    clock += DWELL_MS;
    hover(centre);
    expect(preview.value).toEqual(snapBox("left", DESKTOP));
    expect(drop.landingFor("chat")).toEqual(snapBox("left", DESKTOP));
  });

  // The split is aimed at one window and outranks the desktop's zones, even
  // with the pointer inside a zone's band.
  it("lets a split over a window's edge win over a screen-edge zone", () => {
    const flush: Box = { x: 0, y: 0, width: 800, height: 600 };
    const { preview, drop, hover } = installed({ toEdges: true, boxes: [OTHER, flush] });
    const edge = { nativeEvent: { clientX: 5, clientY: 300 } };
    hover(edge);
    clock += DWELL_MS;
    hover(edge);
    expect(preview.value).toEqual(splitFor(flush, "left")?.tab);
    expect(drop.landingFor("chat")).toBeNull();
  });

  it("never snaps a tab over a tab bar, which joins the window instead", () => {
    const { preview, drop, hover } = installed({ toEdges: true });
    const bar = { kind: "tab", nativeEvent: { clientX: 5, clientY: 300 } };
    hover(bar);
    clock += DWELL_MS;
    hover(bar);
    expect(preview.value).toBeNull();
    expect(drop.landingFor("chat")).toBeNull();
  });

  it("forgets everything once the drag is over", () => {
    const { preview, dock, drop } = installed({ toEdges: true });
    rest(dock, 5, 400);
    dock.fireOnRoot("dragend", {});
    expect(preview.value).toBeNull();
    expect(drop.landingFor("chat")).toBeNull();
  });
});
