import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DockviewApi } from "dockview-vue";
import {
  applyMinimized,
  installDesktopFloatOnDrop,
  installFloatOnDrop,
  MINIMIZED_CLASS,
  minimizeWindow,
  moveWindow,
  openWindow,
  raiseWindow,
  toggleMaximizeWindow,
  unminimizeWindow,
  visibleFloatWindows,
} from "./dockWindows";
import { publishWindowStates } from "./maximizedWindows";
import { isMaximized, isMinimized, NO_WINDOWS, setMaximized, setMinimized } from "./windowState";
import type { Box } from "./box";
import { splitFor } from "./tabSplit";

const BOX = { x: 0, y: 0, width: 400, height: 300 };

/**
 * A stand-in for a live dockview with just the parts these functions touch.
 *
 * There is no DOM in this suite, so `applyMinimized` finds no overlay element
 * and only the state itself is observable — which is what is asserted here;
 * the class it toggles is covered by `dockviewInternals.test.ts`.
 */
function fakeApi(ids: readonly string[], activeId: string | null = null) {
  const setActive = vi.fn();
  const addPanel = vi.fn();
  const panels = ids.map((id) => ({ id, group: null, api: { setActive: () => setActive(id) } }));
  const api = {
    panels,
    activePanel: panels.find((p) => p.id === activeId),
    getPanel: (id: string) => panels.find((p) => p.id === id),
    addPanel: (options: { id: string }) => {
      addPanel(options);
      return { id: options.id, api: { setActive: () => setActive(options.id) } };
    },
  };
  return { api: api as unknown as DockviewApi, setActive, addPanel };
}

describe("openWindow", () => {
  it("activates the window it opened", () => {
    const { api, setActive } = fakeApi([]);
    openWindow(api, "chat:server", { component: "chat", title: "Server", box: BOX });
    expect(setActive).toHaveBeenCalledWith("chat:server");
  });

  it("leaves a background window unactivated, so nothing hears the user switched to it", () => {
    const { api, setActive, addPanel } = fakeApi([]);
    openWindow(api, "chat:channel:1", { component: "chat", title: "a", box: BOX }, false);
    expect(addPanel).toHaveBeenCalled();
    expect(setActive).not.toHaveBeenCalled();
  });
});

describe("raiseWindow", () => {
  it("brings a window that is not in front to the front", () => {
    const { api, setActive } = fakeApi(["tree", "chat:server"], "tree");
    raiseWindow(api, "chat:server");
    expect(setActive).toHaveBeenCalledWith("chat:server");
  });

  // Raising moves the window's DOM, which loses anything typed in that frame.
  it("leaves the window that is already in front alone", () => {
    const { api, setActive } = fakeApi(["tree", "chat:server"], "chat:server");
    raiseWindow(api, "chat:server");
    expect(setActive).not.toHaveBeenCalled();
  });

  it("activates a window it would otherwise skip when the caller forces it", () => {
    const { api, setActive } = fakeApi(["chat:server"], "chat:server");
    raiseWindow(api, "chat:server", true);
    expect(setActive).toHaveBeenCalledWith("chat:server");
  });

  it("does nothing for a window that is not open", () => {
    const { api, setActive } = fakeApi(["tree"], "tree");
    raiseWindow(api, "gone");
    expect(setActive).not.toHaveBeenCalled();
  });
});

describe("unminimizeWindow", () => {
  it("clears the minimised state without raising anything", () => {
    const { api, setActive } = fakeApi(["chat:server"], "chat:server");
    const states = setMinimized(NO_WINDOWS, "chat:server", true);
    const next = unminimizeWindow(api, "chat:server", states);
    expect(isMinimized(next, "chat:server")).toBe(false);
    expect(setActive).not.toHaveBeenCalled();
  });

  it("returns the states untouched for a window that is not open", () => {
    const { api } = fakeApi(["tree"]);
    const states = setMinimized(NO_WINDOWS, "gone", true);
    expect(unminimizeWindow(api, "gone", states)).toBe(states);
  });
});

/* ------------------------- windows with real groups ------------------------ */

/** dockview's anchored box: width/height plus one horizontal and one vertical edge. */
interface Anchored {
  width: number;
  height: number;
  top?: number;
  left?: number;
  bottom?: number;
  right?: number;
}

const CONTAINER = { width: 1000, height: 600 };
const DESKTOP = { width: 1000, height: 600 };
const TOP_LEFT: Anchored = { left: 120, top: 80, width: 400, height: 300 };

interface FloatDockOptions {
  /** The anchored box each window's overlay reports, by window index. */
  readonly boxes?: readonly (Anchored | null)[];
  /** False makes every `position` call fail, as a degraded adapter does. */
  readonly canPosition?: boolean;
}

/**
 * A stand-in dockview with real groups: one per window, shared by the panel
 * ids stacked in it, plus the `component.floatingGroups` the adapter reads.
 */
function fakeFloatDock(windows: readonly (readonly string[])[], options: FloatDockOptions = {}) {
  const setActive = vi.fn();
  const positions: { window: number; bounds: Record<string, number> }[] = [];
  const groups = windows.map((_, index) => ({ index, element: {} }));
  const panels = windows.flatMap((ids, index) =>
    ids.map((id) => ({ id, group: groups[index], api: { setActive: () => setActive(id) } })),
  );
  const floatingGroups = groups.map((group, index) => ({
    group,
    overlay: {
      element: { parentElement: { getBoundingClientRect: () => CONTAINER } },
      toJSON: () => (options.boxes ? options.boxes[index] : TOP_LEFT),
    },
    position: (bounds: Record<string, number>) => {
      if (options.canPosition === false) throw new Error("dockview would not");
      positions.push({ window: index, bounds });
    },
  }));
  const api = {
    panels,
    activePanel: undefined,
    getPanel: (id: string) => panels.find((p) => p.id === id),
    component: {
      floatingGroups,
      onDidEndFloatingGroupDrag: () => ({ dispose: () => void 0 }),
    },
  };
  return { api: api as unknown as DockviewApi, positions, setActive };
}

describe("moveWindow", () => {
  it("moves and resizes the window in one call", () => {
    const { api, positions } = fakeFloatDock([["tree"]]);
    expect(moveWindow(api, "tree", { x: 0, y: 0, width: 500, height: 600 })).toBe(true);
    expect(positions).toEqual([
      { window: 0, bounds: { top: 0, left: 0, width: 500, height: 600 } },
    ]);
  });

  it("moves the window its panel is in, not the first one", () => {
    const { api, positions } = fakeFloatDock([["tree"], ["music"]]);
    moveWindow(api, "music", { x: 10, y: 20, width: 300, height: 200 });
    expect(positions[0]?.window).toBe(1);
  });

  it("reports failure for a window that is not open", () => {
    const { api, positions } = fakeFloatDock([["tree"]]);
    expect(moveWindow(api, "gone", { x: 0, y: 0, width: 10, height: 10 })).toBe(false);
    expect(positions).toEqual([]);
  });

  it("reports failure when dockview will not move it", () => {
    const { api } = fakeFloatDock([["tree"]], { canPosition: false });
    expect(moveWindow(api, "tree", { x: 0, y: 0, width: 10, height: 10 })).toBe(false);
  });
});

/**
 * The one answer to "what else is on this desktop?".
 *
 * Both gestures that reckon with the other windows read it — a drag lines up
 * against them and fills the gaps between them, a seam resize pushes them
 * about — so what it leaves out is what neither of them may touch.
 */
describe("visibleFloatWindows", () => {
  const BOXES: readonly Anchored[] = [
    { left: 0, top: 0, width: 400, height: 300 },
    { left: 400, top: 0, width: 300, height: 200 },
    { left: 0, top: 300, width: 200, height: 100 },
  ];
  /** Three windows, the middle one holding two stacked tabs. */
  const threeWindows = () =>
    fakeFloatDock([["tree"], ["chat", "info"], ["music"]], { boxes: BOXES });
  /** Nothing is minimised. */
  const showing = () => false;

  afterEach(() => publishWindowStates(NO_WINDOWS));

  it("names one entry per window, by its first tab, with the box it is in", () => {
    const { api } = threeWindows();
    expect(visibleFloatWindows(api, null, showing)).toEqual([
      { id: "tree", box: { x: 0, y: 0, width: 400, height: 300 } },
      { id: "chat", box: { x: 400, y: 0, width: 300, height: 200 } },
      { id: "music", box: { x: 0, y: 300, width: 200, height: 100 } },
    ]);
  });

  it("leaves out the window the gesture is about", () => {
    const { api } = threeWindows();
    const dragged = api.panels.find((p) => p.id === "chat")?.group;
    expect(visibleFloatWindows(api, dragged, showing).map((w) => w.id)).toEqual(["tree", "music"]);
  });

  it("leaves out a window whose every tab is minimised", () => {
    const { api } = threeWindows();
    const away = (id: string) => id === "chat" || id === "info";
    expect(visibleFloatWindows(api, null, away).map((w) => w.id)).toEqual(["tree", "music"]);
  });

  it("keeps a window with one tab still on the desktop", () => {
    // Minimising is a property of the window, so a group showing either of its
    // tabs is still somewhere the user can see.
    const { api } = threeWindows();
    const away = (id: string) => id === "info";
    expect(visibleFloatWindows(api, null, away).map((w) => w.id)).toEqual([
      "tree",
      "chat",
      "music",
    ]);
  });

  it("leaves out a maximised window, whose box is the whole desktop", () => {
    const { api } = threeWindows();
    publishWindowStates(
      setMaximized(NO_WINDOWS, "music", { x: 0, y: 300, width: 200, height: 100 }),
    );
    expect(visibleFloatWindows(api, null, showing).map((w) => w.id)).toEqual(["tree", "chat"]);
  });
});

describe("toggleMaximizeWindow", () => {
  it("fills the desktop and comes back to the exact box it started from", () => {
    const { api, positions } = fakeFloatDock([["tree"]]);
    const max = toggleMaximizeWindow(api, "tree", DESKTOP, NO_WINDOWS);

    expect(isMaximized(max, "tree")).toBe(true);
    expect(positions[0]?.bounds).toEqual({ top: 0, left: 0, width: 1000, height: 600 });

    const back = toggleMaximizeWindow(api, "tree", DESKTOP, max);
    expect(isMaximized(back, "tree")).toBe(false);
    expect(positions[1]?.bounds).toEqual({ top: 80, left: 120, width: 400, height: 300 });
  });

  // The case C1 was about: a window dragged into the lower right re-anchors,
  // and reading only `left`/`top` used to lose it and strand it full-screen.
  it("restores a bottom-right-anchored window to where it really was", () => {
    const anchored: Anchored = { right: 100, bottom: 50, width: 400, height: 300 };
    const { api, positions } = fakeFloatDock([["tree"]], { boxes: [anchored] });

    const max = toggleMaximizeWindow(api, "tree", DESKTOP, NO_WINDOWS);
    expect(isMaximized(max, "tree")).toBe(true);

    const back = toggleMaximizeWindow(api, "tree", DESKTOP, max);
    expect(isMaximized(back, "tree")).toBe(false);
    // 1000 - 100 - 400 = 500 across, 600 - 50 - 300 = 250 down.
    expect(positions[1]?.bounds).toEqual({ top: 250, left: 500, width: 400, height: 300 });
  });

  // Maximising into a state it cannot undo is what made the button a permanent
  // no-op: the window filled the desktop while the state called it un-maximised.
  it("refuses to maximise a window whose box it cannot read", () => {
    const { api, positions } = fakeFloatDock([["tree"]], { boxes: [null] });
    const next = toggleMaximizeWindow(api, "tree", DESKTOP, NO_WINDOWS);

    expect(next).toBe(NO_WINDOWS);
    expect(positions).toEqual([]);
  });

  it("stays maximised when dockview will not put the window back", () => {
    const { api } = fakeFloatDock([["tree"]]);
    const max = toggleMaximizeWindow(api, "tree", DESKTOP, NO_WINDOWS);

    const stuck = fakeFloatDock([["tree"]], { canPosition: false });
    const next = toggleMaximizeWindow(stuck.api, "tree", DESKTOP, max);
    expect(isMaximized(next, "tree")).toBe(true);
  });

  it("brings the window it maximised to the front", () => {
    const { api, setActive } = fakeFloatDock([["tree"]]);
    toggleMaximizeWindow(api, "tree", DESKTOP, NO_WINDOWS);
    expect(setActive).toHaveBeenCalledWith("tree");
  });
});

/**
 * Minimising is a property of the window, not of the tab in front of it.
 * Stacked tabs share one overlay, so anything else leaves the pair split: one
 * tab hidden, the other's taskbar button unable to bring the window back.
 */
describe("minimising a window of stacked tabs", () => {
  it("puts every tab of the window away together", () => {
    const { api } = fakeFloatDock([["tree", "info"]]);
    const next = minimizeWindow(api, "info", NO_WINDOWS);

    expect(isMinimized(next, "info")).toBe(true);
    expect(isMinimized(next, "tree")).toBe(true);
  });

  it("leaves the other windows alone", () => {
    const { api } = fakeFloatDock([["tree", "info"], ["music"]]);
    const next = minimizeWindow(api, "info", NO_WINDOWS);

    expect(isMinimized(next, "music")).toBe(false);
  });

  it("brings the whole window back from either tab's taskbar button", () => {
    const { api } = fakeFloatDock([["tree", "info"]]);
    const away = minimizeWindow(api, "info", NO_WINDOWS);
    const back = unminimizeWindow(api, "tree", away);

    expect(isMinimized(back, "tree")).toBe(false);
    expect(isMinimized(back, "info")).toBe(false);
  });
});

/**
 * The class itself, which needs `HTMLElement` to exist. There is no DOM in
 * this suite, so the element is a fake object and the global is stubbed —
 * `overlayElementOf` only ever does an `instanceof` and a `closest`.
 */
describe("applyMinimized", () => {
  class FakeElement {
    readonly classes = new Set<string>();
    readonly overlay = {
      classList: {
        toggle: (name: string, on: boolean) =>
          on ? this.classes.add(name) : this.classes.delete(name),
      },
    };
    closest(selector: string) {
      return selector === ".dv-resize-container" ? this.overlay : null;
    }
  }

  /** A dock whose groups carry fake elements, so the class is observable. */
  function painted(windows: readonly (readonly string[])[]) {
    const elements = windows.map(() => new FakeElement());
    const groups = windows.map((_, index) => ({ element: elements[index] }));
    const panels = windows.flatMap((ids, index) => ids.map((id) => ({ id, group: groups[index] })));
    return { api: { panels } as unknown as DockviewApi, elements };
  }

  beforeEach(() => vi.stubGlobal("HTMLElement", FakeElement));
  afterEach(() => vi.unstubAllGlobals());

  it("hides a window once every tab in it is minimised", () => {
    const { api, elements } = painted([["tree", "info"]]);
    applyMinimized(api, setMinimized(setMinimized(NO_WINDOWS, "tree", true), "info", true));
    expect(elements[0].classes.has(MINIMIZED_CLASS)).toBe(true);
  });

  // Hiding on one tab's state would take the other tab off the desktop with it.
  it("leaves a window on the desktop while one of its tabs is not minimised", () => {
    const { api, elements } = painted([["tree", "info"]]);
    applyMinimized(api, setMinimized(NO_WINDOWS, "info", true));
    expect(elements[0].classes.has(MINIMIZED_CLASS)).toBe(false);
  });

  it("hides only the window that is minimised", () => {
    const { api, elements } = painted([["tree"], ["music"]]);
    applyMinimized(api, setMinimized(NO_WINDOWS, "music", true));
    expect(elements[0].classes.has(MINIMIZED_CLASS)).toBe(false);
    expect(elements[1].classes.has(MINIMIZED_CLASS)).toBe(true);
  });

  it("brings a hidden window back when the class is no longer wanted", () => {
    const { api, elements } = painted([["tree"]]);
    applyMinimized(api, setMinimized(NO_WINDOWS, "tree", true));
    applyMinimized(api, NO_WINDOWS);
    expect(elements[0].classes.has(MINIMIZED_CLASS)).toBe(false);
  });
});

/* ------------------------- a tab dropped on a window ----------------------- */

/**
 * `installFloatOnDrop`, with and without an armed split.
 *
 * The drop itself is dockview's `onWillDrop`, so the event is a plain object of
 * the shape dockview hands over. There is no DOM: the dock root only has to
 * answer `querySelector` and `getBoundingClientRect` for the tear-out's maths.
 */
describe("installFloatOnDrop", () => {
  const DOCK_ID = "dock";
  const UNDER_BOX = { x: 100, y: 50, width: 800, height: 600 };

  /** Everything the two paths do, in the order they did it. */
  type Step =
    | { readonly did: "moveTo"; readonly panelId: string; readonly box: Box }
    | { readonly did: "float"; readonly item: string; readonly box: Box }
    | { readonly did: "activate"; readonly panelId: string };

  /**
   * A dock of two windows — the dragged tab's, and the one under the pointer —
   * whose every move is recorded on one list so the ORDER is assertable.
   */
  function fakeDropDock(windows: readonly (readonly string[])[]) {
    const steps: Step[] = [];
    const groups = windows.map((_, index) => ({ id: `group-${index}`, index }));
    const panels = windows.flatMap((ids, index) =>
      ids.map((id) => ({
        id,
        group: groups[index],
        api: { setActive: () => steps.push({ did: "activate", panelId: id }) },
      })),
    );
    let willDrop: ((event: Record<string, unknown>) => void) | null = null;
    const api = {
      id: DOCK_ID,
      panels,
      groups,
      getPanel: (id: string) => panels.find((p) => p.id === id),
      addFloatingGroup: (item: { id: string }, box: Box) =>
        steps.push({ did: "float", item: item.id, box }),
      onWillDrop: (handler: (event: Record<string, unknown>) => void) => {
        willDrop = handler;
        return { dispose: () => (willDrop = null) };
      },
    };
    const rootListeners = new Map<string, (event: unknown) => void>();
    const root = {
      querySelector: () => null,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
      addEventListener: (type: string, listener: (event: unknown) => void) =>
        rootListeners.set(type, listener),
      removeEventListener: (type: string) => rootListeners.delete(type),
    } as unknown as HTMLElement;
    return {
      api: api as unknown as DockviewApi,
      root,
      groups,
      steps,
      /** A native drop on the empty desktop, at a client point. */
      dropOnDesktop: (clientX: number, clientY: number) =>
        rootListeners.get("drop")?.({
          target: { closest: (selector: string) => (selector.includes("desktop") ? {} : null) },
          clientX,
          clientY,
          preventDefault: () => void 0,
        }),
      drop: (over: Record<string, unknown> = {}) =>
        willDrop?.({
          kind: "content",
          position: "left",
          group: groups[1],
          getData: () => ({ viewId: DOCK_ID, groupId: "group-0", panelId: "chat" }),
          nativeEvent: { clientX: 400, clientY: 300 },
          preventDefault: () => void 0,
          ...over,
        }),
    };
  }

  /** A splitter that arms the left half of the window under the pointer. */
  function splitter(dock: ReturnType<typeof fakeDropDock>, armedGroup: unknown) {
    const split = splitFor(UNDER_BOX, "left");
    if (!split) throw new Error("the fixture must be splittable");
    return {
      split,
      onDrop: {
        armed: (group: unknown) => (group === armedGroup ? split : null),
        moveTo: (panelId: string, box: Box) => dock.steps.push({ did: "moveTo", panelId, box }),
      },
    };
  }

  it("shrinks the window underneath before the tab floats over it", () => {
    const dock = fakeDropDock([["chat", "peers"], ["tree"]]);
    const { split, onDrop } = splitter(dock, dock.groups[1]);
    installFloatOnDrop(dock.api, () => dock.root, undefined, onDrop);
    dock.drop();

    expect(dock.steps).toEqual([
      { did: "moveTo", panelId: "tree", box: split.under },
      { did: "float", item: "chat", box: split.tab },
      { did: "activate", panelId: "chat" },
    ]);
  });

  // A tab alone in its window is the window: tearing it out would destroy and
  // rebuild the very thing being dragged. See commit c40b76b.
  it("moves the dragged tab's own window instead of tearing it out", () => {
    const dock = fakeDropDock([["chat"], ["tree"]]);
    const { split, onDrop } = splitter(dock, dock.groups[1]);
    installFloatOnDrop(dock.api, () => dock.root, undefined, onDrop);
    dock.drop();

    expect(dock.steps).toEqual([
      { did: "moveTo", panelId: "tree", box: split.under },
      { did: "moveTo", panelId: "chat", box: split.tab },
    ]);
  });

  it("leaves the tear-out at the pointer alone when nothing is armed", () => {
    const dock = fakeDropDock([["chat", "peers"], ["tree"]]);
    const { onDrop } = splitter(dock, dock.groups[1]);
    installFloatOnDrop(dock.api, () => dock.root, undefined, {
      ...onDrop,
      armed: () => null,
    });
    dock.drop();

    expect(dock.steps.map((step) => step.did)).toEqual(["float", "activate"]);
    // Centred on the pointer, its tab bar just under it: the box `tearOutBox` gives.
    expect(dock.steps[0]).toEqual({
      did: "float",
      item: "chat",
      box: { x: 170, y: 284, width: 460, height: 340 },
    });
  });

  it("tears out as before when no splitter is wired in at all", () => {
    const dock = fakeDropDock([["chat", "peers"], ["tree"]]);
    installFloatOnDrop(dock.api, () => dock.root);
    dock.drop();
    expect(dock.steps.map((step) => step.did)).toEqual(["float", "activate"]);
  });

  it("ignores a split armed for some other window", () => {
    const dock = fakeDropDock([["chat", "peers"], ["tree"]]);
    const { onDrop } = splitter(dock, dock.groups[0]);
    installFloatOnDrop(dock.api, () => dock.root, undefined, onDrop);
    dock.drop();
    expect(dock.steps.map((step) => step.did)).toEqual(["float", "activate"]);
  });

  it("leaves a drop on a tab bar to dockview, split or no split", () => {
    const dock = fakeDropDock([["chat", "peers"], ["tree"]]);
    const { onDrop } = splitter(dock, dock.groups[1]);
    installFloatOnDrop(dock.api, () => dock.root, undefined, onDrop);
    dock.drop({ kind: "tab" });
    expect(dock.steps).toEqual([]);
  });
  /*
   * A tab drag now snaps like a window drag (`useTabDrop`, `dragSnap.ts`): the
   * box a desktop snap armed is where the window lands, whichever of the two
   * drop paths the release took.
   */
  const SNAPPED: Box = { x: 0, y: 0, width: 600, height: 800 };

  /** A splitter with nothing split, and `SNAPPED` armed for `chat`. */
  function snapper(dock: ReturnType<typeof fakeDropDock>) {
    return {
      armed: () => null,
      landing: (panelId: string) => (panelId === "chat" ? SNAPPED : null),
      moveTo: (panelId: string, box: Box) => dock.steps.push({ did: "moveTo", panelId, box }),
    };
  }

  // Torn out at the pointer first and then moved, so the snap is settled the
  // way any move is — a top-edge snap is recorded as maximised, with the
  // pointer's box to come back to.
  it("tears a stacked tab out into the box a desktop snap armed", () => {
    const dock = fakeDropDock([["chat", "peers"], ["tree"]]);
    installFloatOnDrop(dock.api, () => dock.root, undefined, snapper(dock));
    dock.drop({ position: "center" });
    expect(dock.steps).toEqual([
      { did: "float", item: "chat", box: { x: 170, y: 284, width: 460, height: 340 } },
      { did: "activate", panelId: "chat" },
      { did: "moveTo", panelId: "chat", box: SNAPPED },
    ]);
  });

  it("moves a lone tab's window into the box a desktop snap armed", () => {
    const dock = fakeDropDock([["chat"], ["tree"]]);
    installFloatOnDrop(dock.api, () => dock.root, undefined, snapper(dock));
    dock.drop({ position: "center" });
    expect(dock.steps).toEqual([{ did: "moveTo", panelId: "chat", box: SNAPPED }]);
  });

  // The same reasoning as the split's: a lone tab's window is moved, never
  // rebuilt, wherever on another window it is let go.
  it("moves a lone tab's window to the pointer when nothing is armed", () => {
    const dock = fakeDropDock([["chat"], ["tree"]]);
    installFloatOnDrop(dock.api, () => dock.root, undefined, {
      ...snapper(dock),
      landing: () => null,
    });
    dock.drop({ position: "center" });
    expect(dock.steps).toEqual([
      { did: "moveTo", panelId: "chat", box: { x: 170, y: 284, width: 460, height: 340 } },
    ]);
  });

  it("lets an armed split win over a desktop snap", () => {
    const dock = fakeDropDock([["chat", "peers"], ["tree"]]);
    const { split, onDrop } = splitter(dock, dock.groups[1]);
    installFloatOnDrop(dock.api, () => dock.root, undefined, {
      ...onDrop,
      landing: snapper(dock).landing,
    });
    dock.drop();
    expect(dock.steps[1]).toEqual({ did: "float", item: "chat", box: split.tab });
  });

  it("tears a stacked tab out onto the desktop into the armed box", () => {
    const dock = fakeDropDock([["chat", "peers"], ["tree"]]);
    const onDrop = snapper(dock);
    installDesktopFloatOnDrop(dock.api, () => dock.root, {
      readDrag: () => ({ viewId: DOCK_ID, groupId: "group-0", panelId: "chat" }),
      moveTo: onDrop.moveTo,
      landing: onDrop.landing,
    });
    dock.dropOnDesktop(400, 300);
    expect(dock.steps).toEqual([
      { did: "float", item: "chat", box: { x: 170, y: 284, width: 460, height: 340 } },
      { did: "activate", panelId: "chat" },
      { did: "moveTo", panelId: "chat", box: SNAPPED },
    ]);
  });

  it("moves a lone tab's window on the desktop into the armed box", () => {
    const dock = fakeDropDock([["chat"], ["tree"]]);
    const onDrop = snapper(dock);
    installDesktopFloatOnDrop(dock.api, () => dock.root, {
      readDrag: () => ({ viewId: DOCK_ID, groupId: "group-0", panelId: "chat" }),
      moveTo: onDrop.moveTo,
      landing: onDrop.landing,
    });
    dock.dropOnDesktop(400, 300);
    expect(dock.steps).toEqual([{ did: "moveTo", panelId: "chat", box: SNAPPED }]);
  });

  it("moves a lone tab's window to the pointer on the desktop when nothing is armed", () => {
    const dock = fakeDropDock([["chat"], ["tree"]]);
    installDesktopFloatOnDrop(dock.api, () => dock.root, {
      readDrag: () => ({ viewId: DOCK_ID, groupId: "group-0", panelId: "chat" }),
      moveTo: snapper(dock).moveTo,
    });
    dock.dropOnDesktop(400, 300);
    expect(dock.steps).toEqual([
      { did: "moveTo", panelId: "chat", box: { x: 170, y: 284, width: 460, height: 340 } },
    ]);
  });
});
