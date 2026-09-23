import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DockviewApi } from "dockview-vue";
import { useDesktop } from "./useDesktop";
import { snapBox } from "./snap";
import {
  DEFAULT_SNAP_TO_EDGES,
  DEFAULT_SNAP_TO_WINDOWS,
  setSnapToEdges,
  setSnapToWindows,
} from "./snapMode";
import { DWELL_MS } from "./snapDwell";
import { anyMaximized, publishWindowStates } from "./maximizedWindows";
import { GROUP_SELECTOR, NO_MAXIMIZE_SELECTOR, TITLE_BAR_SELECTOR } from "./titleBarMaximize";
import { NO_WINDOWS } from "./windowState";

/**
 * The desktop composable against a stand-in dockview, in the fake-object style
 * of `dockviewInternals.test.ts` — no DOM library, only the handful of globals
 * and api members it really touches.
 *
 * What is under test is the window *bookkeeping*: which window is minimised,
 * what the taskbar says about it, and what the app is told when one comes back
 * from the taskbar. Nothing here paints anything, so `applyMinimized` finds no
 * overlay element and the CSS class it toggles is not observable — that half
 * lives in `dockviewInternals.test.ts`.
 */

interface FakeGroup {
  /** dockview's own element for the window, which is how one is identified. */
  element: object;
  activePanel: FakePanel;
}

interface FakePanel {
  id: string;
  title: string;
  group: FakeGroup | null;
  api: { setActive(): void; onDidTitleChange(): { dispose(): void } };
}

/** One floating window of the fake, shaped the way dockview's really is. */
interface FakeFloat {
  group: FakeGroup;
  box: { left: number; top: number; width: number; height: number };
}

/**
 * `floating: true` gives every panel a window of its own, with the internals
 * `dockviewInternals.ts` reaches for — which is what maximise and restore
 * really move. Off by default, so the bookkeeping tests keep the barest fake
 * they need.
 */
function fakeDock(options: { floating?: boolean } = {}) {
  const setActive = vi.fn();
  /** What `App.vue` hears: the id of every panel dockview calls active. */
  const announced: (string | undefined)[] = [];
  const activeHandlers: ((e: { panel?: { id: string } }) => void)[] = [];
  const panels: FakePanel[] = [];
  const floats: FakeFloat[] = [];
  /** What the desktop has registered for the end of a floating drag. */
  const dragEnds: ((group: unknown) => void)[] = [];
  const noSub = () => ({ dispose: () => void 0 });
  const api = {
    panels,
    activePanel: undefined as FakePanel | undefined,
    getPanel: (id: string) => panels.find((p) => p.id === id),
    addPanel: (spec: {
      id: string;
      title: string;
      floating?: { x: number; y: number; width: number; height: number };
    }) => {
      const panel: FakePanel = {
        id: spec.id,
        title: spec.title,
        group: null,
        api: {
          setActive() {
            setActive(spec.id);
            api.activePanel = panel;
            for (const handler of activeHandlers) handler({ panel });
          },
          onDidTitleChange: noSub,
        },
      };
      panels.push(panel);
      if (options.floating) {
        panel.group = { element: { name: spec.id }, activePanel: panel };
        const box = spec.floating ?? { x: 0, y: 0, width: 400, height: 300 };
        floats.push({
          group: panel.group,
          box: { left: box.x, top: box.y, width: box.width, height: box.height },
        });
      }
      return panel;
    },
    onDidAddPanel: noSub,
    onDidRemovePanel: noSub,
    onDidActivePanelChange: (handler: (e: { panel?: { id: string } }) => void) => {
      activeHandlers.push(handler);
      return { dispose: () => void 0 };
    },
    onDidLayoutFromJSON: noSub,
    onDidLayoutChange: noSub,
    toJSON: () => ({}),
    clear: () => void panels.splice(0, panels.length),
    // dockview's private floating-window internals; see `dockviewInternals.ts`.
    component: options.floating
      ? {
          // A getter, not a snapshot: windows are opened after the fake is
          // built, and dockview's own field grows with them too.
          get floatingGroups() {
            return floats.map((float) => ({
              group: float.group,
              overlay: { toJSON: () => ({ ...float.box }) },
              position: (bounds: { left: number; top: number; width: number; height: number }) => {
                float.box = { ...bounds };
              },
            }));
          },
          onDidEndFloatingGroupDrag: (handler: (group: unknown) => void) => {
            dragEnds.push(handler);
            return { dispose: () => void 0 };
          },
        }
      : undefined,
  };
  return {
    api: api as unknown as DockviewApi,
    raw: api,
    setActive,
    announced,
    activeHandlers,
    floats,
    /** Lets a floating window go, as dockview does when the pointer comes up. */
    endDrag: (group: unknown) => {
      for (const handler of [...dragEnds]) handler(group);
    },
  };
}

const SPEC = { component: "chat", title: "a channel" };

/** The dock's position in the viewport, so desktop coordinates are not viewport ones. */
const ORIGIN = { left: 40, top: 20 };

/**
 * The drag hook's clock, in milliseconds.
 *
 * Every snap now waits for the drag to rest at its target for half a second,
 * and `Date.now` is the only clock the hook reads — the decision itself takes a
 * timestamp (see `snapDwell.ts`), so this is all the time control the tests
 * need.
 */
let clock: number;

/**
 * What the desktop has deferred through `window.setTimeout`, in the order it
 * asked for them. The dwell re-arms itself through one of these — a hand held
 * still produces no further frames — so the tests have to be able to let one
 * fire.
 */
let timers: { fn: () => void; delay: number }[];

/** Runs every deferred callback, as the browser would once its delay had passed. */
function runTimers(): void {
  const due = timers;
  timers = [];
  for (const timer of due) timer.fn();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (event: any) => void;
/** What the desktop has registered on `window`, by event type. */
let listeners: Map<string, Set<Listener>>;
/** ...and what it has registered on the dock element. */
let dockListeners: Map<string, Set<Listener>>;

/** Dispatches an event at the window listeners, as the browser would. */
function fire(type: string, event: Record<string, unknown>): void {
  for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
}

/** Dispatches an event at the dock element's listeners. */
function fireOnDock(type: string, event: Record<string, unknown>): void {
  for (const listener of [...(dockListeners.get(type) ?? [])]) listener(event);
}

beforeEach(() => {
  // `desktopSize` measures the dock element; `saveLayout` defers through
  // `window.setTimeout` and writes to localStorage. None of that is the subject
  // here, so it is stubbed rather than simulated. The window's listener
  // registry is real enough to drive — the drag tests below need it.
  listeners = new Map();
  dockListeners = new Map();
  timers = [];
  clock = 0;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  vi.stubGlobal("document", {
    querySelector: () => ({
      clientWidth: 1200,
      clientHeight: 800,
      getBoundingClientRect: () => ({ left: ORIGIN.left, top: ORIGIN.top }),
      // The desktop delegates the double-click-to-maximise gesture from this
      // element, the way `App.vue` delegates the window controls.
      addEventListener: (type: string, listener: Listener) => {
        const set = dockListeners.get(type) ?? new Set<Listener>();
        set.add(listener);
        dockListeners.set(type, set);
      },
      removeEventListener: (type: string, listener: Listener) => {
        dockListeners.get(type)?.delete(listener);
      },
    }),
  });
  vi.stubGlobal("window", {
    setTimeout: (fn: () => void, delay: number) => timers.push({ fn, delay }),
    clearTimeout: (id: number) => {
      if (timers[id - 1]) timers[id - 1] = { fn: () => void 0, delay: 0 };
    },
    addEventListener: (type: string, listener: Listener) => {
      const set = listeners.get(type) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, listener: Listener) => {
      listeners.get(type)?.delete(listener);
    },
  });
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => void 0,
    removeItem: () => void 0,
  });
  // Most of the drag suites below are about the screen's edges, which are no
  // longer on by default; each suite about the other switch turns it on itself,
  // so every test states the gesture it is about rather than inheriting it.
  setSnapToEdges(true);
  setSnapToWindows(false);
});
afterEach(() => {
  setSnapToEdges(DEFAULT_SNAP_TO_EDGES);
  setSnapToWindows(DEFAULT_SNAP_TO_WINDOWS);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A desktop attached to a fresh fake dockview. */
function attached() {
  const dock = fakeDock();
  const desktop = useDesktop();
  desktop.attach(dock.api);
  // Stand in for App.vue's own subscription, which is what the fix protects.
  dock.raw.onDidActivePanelChange((e) => dock.announced.push(e.panel?.id));
  return { desktop, ...dock };
}

describe("opening a window in the background", () => {
  it("opens it minimised and never activates it", () => {
    const { desktop, setActive, announced } = attached();
    desktop.openWindow("chat:channel:1", SPEC, { background: true });

    expect(desktop.isMinimized("chat:channel:1")).toBe(true);
    expect(setActive).not.toHaveBeenCalled();
    expect(announced).toEqual([]);
  });

  it("shows it in the taskbar as minimised, and never as the window in front", () => {
    const { desktop } = attached();
    desktop.openWindow("chat:channel:1", SPEC, { background: true });

    const button = desktop.buttons.value.find((b) => b.panelId === "chat:channel:1");
    expect(button?.minimized).toBe(true);
    expect(button?.active).toBe(false);
  });

  it("opens a foreground window in front instead", () => {
    const { desktop, setActive } = attached();
    desktop.openWindow("chat:server", SPEC);

    expect(desktop.isMinimized("chat:server")).toBe(false);
    expect(setActive).toHaveBeenCalledWith("chat:server");
  });

  it("does not raise an already-open window when it is asked for in the background", () => {
    const { desktop, setActive } = attached();
    desktop.openWindow("chat:channel:1", SPEC, { background: true });
    desktop.openWindow("chat:channel:1", SPEC, { background: true });

    expect(desktop.isMinimized("chat:channel:1")).toBe(true);
    expect(setActive).not.toHaveBeenCalled();
  });
});

describe("revealing a window", () => {
  it("activates a minimised window even though dockview already calls it active", () => {
    const { desktop, setActive, announced } = attached();
    // Opened in front, so dockview's active panel is this one, then put away.
    desktop.openWindow("chat:channel:1", SPEC);
    desktop.minimize("chat:channel:1");
    setActive.mockClear();
    announced.length = 0;

    desktop.reveal("chat:channel:1");

    expect(desktop.isMinimized("chat:channel:1")).toBe(false);
    // Without this the app would never hear about it: the window would be in
    // front while the store still pointed at another conversation.
    expect(setActive).toHaveBeenCalledWith("chat:channel:1");
    expect(announced).toEqual(["chat:channel:1"]);
  });

  it("tells the app the window is no longer minimised before it announces it", () => {
    const { desktop, activeHandlers } = attached();
    desktop.openWindow("chat:channel:1", SPEC);
    desktop.minimize("chat:channel:1");
    const seen: boolean[] = [];
    activeHandlers.push((e) => seen.push(desktop.isMinimized(e.panel?.id ?? "")));

    desktop.reveal("chat:channel:1");

    expect(seen).toEqual([false]);
  });

  it("leaves a window that is already visible and in front alone", () => {
    const { desktop, setActive } = attached();
    desktop.openWindow("chat:server", SPEC);
    setActive.mockClear();

    desktop.reveal("chat:server");

    expect(setActive).not.toHaveBeenCalled();
  });

  it("raises a visible window that is not the one in front", () => {
    const { desktop, setActive } = attached();
    desktop.openWindow("chat:server", SPEC);
    desktop.openWindow("tree", { component: "tree", title: "Channels & users" });
    setActive.mockClear();

    desktop.reveal("chat:server");

    expect(setActive).toHaveBeenCalledWith("chat:server");
  });
});

describe("clicking a taskbar button", () => {
  it("puts away the window in front and brings back a minimised one", () => {
    const { desktop } = attached();
    desktop.openWindow("chat:server", SPEC);
    const buttonOf = (id: string) => desktop.buttons.value.find((b) => b.panelId === id)!;

    desktop.clickTaskbar(buttonOf("chat:server"));
    expect(desktop.isMinimized("chat:server")).toBe(true);

    desktop.clickTaskbar(buttonOf("chat:server"));
    expect(desktop.isMinimized("chat:server")).toBe(false);
  });
});

describe("the taskbar's minimise all", () => {
  it("puts every window away and brings back the ones it put away", () => {
    const { desktop } = attached();
    desktop.openWindow("chat:server", SPEC);
    desktop.openWindow("tree", { component: "tree", title: "Channels & users" });

    desktop.toggleShowDesktop();
    expect(desktop.isMinimized("chat:server")).toBe(true);
    expect(desktop.isMinimized("tree")).toBe(true);
    // The windows keep their taskbar buttons; only the desktop empties.
    expect(desktop.buttons.value.map((b) => b.panelId)).toEqual(["chat:server", "tree"]);

    desktop.toggleShowDesktop();
    expect(desktop.isMinimized("chat:server")).toBe(false);
    expect(desktop.isMinimized("tree")).toBe(false);
  });

  it("leaves a window the user had already minimised where it was", () => {
    const { desktop } = attached();
    desktop.openWindow("chat:server", SPEC);
    desktop.openWindow("tree", { component: "tree", title: "Channels & users" });
    desktop.minimize("chat:server");

    desktop.toggleShowDesktop();
    desktop.toggleShowDesktop();

    expect(desktop.isMinimized("chat:server")).toBe(true);
    expect(desktop.isMinimized("tree")).toBe(false);
  });
});

/**
 * dockview's per-frame drag hook, and the pointer tracking that feeds it.
 *
 * Windows 11 arms a snap zone from the CURSOR, not from the dragged window's
 * box, and dockview's drag context carries no pointer coordinates — so the
 * desktop listens for them itself. These drive that listener directly: a
 * press, then moves, in viewport coordinates offset from the dock's origin, so
 * the conversion into desktop coordinates is exercised too.
 */
describe("dragTransform", () => {
  const CONTAINER = { width: 1000, height: 600 };
  const NO_MODIFIERS = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };

  /** A drag frame shaped the way dockview supplies one. */
  function frame(modifiers = NO_MODIFIERS) {
    return {
      group: {},
      proposed: { left: 0, top: 0, width: 400, height: 300 },
      container: CONTAINER,
      others: [],
      modifiers,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  /** A desktop with its pointer listeners installed. */
  function dragging() {
    const dock = fakeDock();
    const desktop = useDesktop();
    desktop.attach(dock.api);
    return desktop;
  }

  /** Presses the pointer down at (x, y) in desktop coordinates. */
  const press = (x: number, y: number) =>
    fire("pointerdown", { clientX: ORIGIN.left + x, clientY: ORIGIN.top + y, buttons: 1 });

  /** Moves the held pointer to (x, y) in desktop coordinates. */
  const moveTo = (x: number, y: number) =>
    fire("pointermove", { clientX: ORIGIN.left + x, clientY: ORIGIN.top + y, buttons: 1 });

  /**
   * A frame, and then the same frame once the dwell has passed: what it now
   * takes for a snap to arm at all. A single frame arms nothing by design.
   */
  function dwellOn(desktop: ReturnType<typeof useDesktop>, f = frame()) {
    desktop.dragTransform(f);
    clock += DWELL_MS;
    return desktop.dragTransform(f);
  }

  it("arms the left half from a pointer taken to the left edge", () => {
    const desktop = dragging();
    press(500, 300);
    moveTo(4, 300);
    dwellOn(desktop);
    expect(desktop.snapPreview.value).toEqual({ x: 0, y: 0, width: 500, height: 600 });
  });

  it("arms a corner from a pointer taken into it", () => {
    const desktop = dragging();
    press(500, 300);
    moveTo(996, 2);
    dwellOn(desktop);
    expect(desktop.snapPreview.value).toEqual({ x: 500, y: 0, width: 500, height: 300 });
  });

  it("arms nothing for a pointer in the middle of the desktop", () => {
    const desktop = dragging();
    press(500, 300);
    moveTo(500, 300);
    dwellOn(desktop);
    expect(desktop.snapPreview.value).toBeNull();
  });

  it("arms nothing before it has seen the pointer at all", () => {
    const desktop = dragging();
    desktop.dragTransform(frame());
    expect(desktop.snapPreview.value).toBeNull();
  });

  // Holding the modifier is how a window is dropped against an edge without snapping.
  it("arms nothing while the free-drag modifier is held", () => {
    const desktop = dragging();
    press(500, 300);
    moveTo(4, 300);
    dwellOn(desktop, frame({ ...NO_MODIFIERS, altKey: true }));
    expect(desktop.snapPreview.value).toBeNull();
  });

  it("drops the preview again once the pointer leaves the edge", () => {
    const desktop = dragging();
    press(500, 300);
    moveTo(4, 300);
    dwellOn(desktop);
    moveTo(400, 300);
    desktop.dragTransform(frame());
    expect(desktop.snapPreview.value).toBeNull();
  });

  it("forgets the pointer when the press ends, and stops listening for moves", () => {
    const desktop = dragging();
    press(500, 300);
    fire("pointerup", {});
    expect(listeners.get("pointermove")?.size ?? 0).toBe(0);
    moveTo(4, 300);
    desktop.dragTransform(frame());
    expect(desktop.snapPreview.value).toBeNull();
  });

  it("gives up tracking on a cancelled gesture", () => {
    const desktop = dragging();
    press(500, 300);
    fire("pointercancel", {});
    expect(listeners.get("pointermove")?.size ?? 0).toBe(0);
    moveTo(4, 300);
    desktop.dragTransform(frame());
    expect(desktop.snapPreview.value).toBeNull();
  });

  it("gives up tracking when a move arrives with no button held", () => {
    // A mouse released outside the page fires no pointerup we can hear.
    const desktop = dragging();
    press(500, 300);
    fire("pointermove", { clientX: ORIGIN.left + 4, clientY: ORIGIN.top + 300, buttons: 0 });
    expect(listeners.get("pointermove")?.size ?? 0).toBe(0);
    desktop.dragTransform(frame());
    expect(desktop.snapPreview.value).toBeNull();
  });

  // The preview and the box committed on drop must be the same rectangle.
  it("previews exactly the box the zone commits", () => {
    const desktop = dragging();
    press(500, 300);
    moveTo(4, 300);
    dwellOn(desktop);
    expect(desktop.snapPreview.value).toEqual(snapBox("left", CONTAINER));
  });
});

/**
 * The half-second the drag has to rest before anything snaps.
 *
 * `snapDwell.ts` decides it from timestamps; this is the hook obeying it, with
 * `Date.now` under the tests' control. What it buys is the case at the end: a
 * window flung across the desktop passes every edge on the way and must take
 * none of them.
 */
describe("the dwell before a snap", () => {
  const CONTAINER = { width: 1000, height: 600 };
  const NO_MODIFIERS = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };

  function frame() {
    return {
      group: {},
      proposed: { left: 0, top: 0, width: 400, height: 300 },
      container: CONTAINER,
      others: [],
      modifiers: NO_MODIFIERS,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  function dragging() {
    const dock = fakeDock();
    const desktop = useDesktop();
    desktop.attach(dock.api);
    return desktop;
  }

  const press = (x: number, y: number) =>
    fire("pointerdown", { clientX: ORIGIN.left + x, clientY: ORIGIN.top + y, buttons: 1 });
  const moveTo = (x: number, y: number) =>
    fire("pointermove", { clientX: ORIGIN.left + x, clientY: ORIGIN.top + y, buttons: 1 });

  it("shows no preview on the frame the pointer reaches the edge", () => {
    const desktop = dragging();
    press(500, 300);
    moveTo(4, 300);
    desktop.dragTransform(frame());
    expect(desktop.snapPreview.value).toBeNull();
  });

  it("shows no preview a moment short of the dwell", () => {
    const desktop = dragging();
    press(500, 300);
    moveTo(4, 300);
    desktop.dragTransform(frame());
    clock += DWELL_MS - 1;
    desktop.dragTransform(frame());
    expect(desktop.snapPreview.value).toBeNull();
  });

  it("arms the zone once the drag has rested at the edge for the dwell", () => {
    const desktop = dragging();
    press(500, 300);
    moveTo(4, 300);
    desktop.dragTransform(frame());
    clock += DWELL_MS;
    desktop.dragTransform(frame());
    expect(desktop.snapPreview.value).toEqual(snapBox("left", CONTAINER));
  });

  it("arms nothing for a drag flicked past one edge and on to another", () => {
    const desktop = dragging();
    press(500, 300);
    for (const [x, y] of [
      [4, 300],
      [4, 4],
      [500, 4],
    ]) {
      moveTo(x, y);
      desktop.dragTransform(frame());
      clock += 60;
      expect(desktop.snapPreview.value).toBeNull();
    }
  });

  it("arms a newly reached zone at once once a dwell has been served", () => {
    const desktop = dragging();
    press(500, 300);
    moveTo(4, 300);
    desktop.dragTransform(frame());
    clock += DWELL_MS;
    desktop.dragTransform(frame());
    // The left half is armed, so the user has already proved they are aiming:
    // crossing to the right edge arms it on the frame it is reached, and the
    // preview glides across rather than fading out for another half second.
    moveTo(996, 300);
    clock += 16;
    desktop.dragTransform(frame());
    expect(desktop.snapPreview.value).toEqual(snapBox("right", CONTAINER));
  });

  it("makes a zone reached after leaving every zone wait out its own dwell", () => {
    const desktop = dragging();
    press(500, 300);
    moveTo(4, 300);
    desktop.dragTransform(frame());
    clock += DWELL_MS;
    desktop.dragTransform(frame());
    // Out into the middle of the desktop, which arms nothing: the served wait
    // is spent by it, so the right edge has to earn its own.
    moveTo(500, 300);
    clock += 16;
    desktop.dragTransform(frame());
    moveTo(996, 300);
    clock += 16;
    desktop.dragTransform(frame());
    expect(desktop.snapPreview.value).toBeNull();
    clock += DWELL_MS;
    desktop.dragTransform(frame());
    expect(desktop.snapPreview.value).toEqual(snapBox("right", CONTAINER));
  });

  it("arms the zone for a drag that comes to a standstill at the edge", () => {
    // The case the dwell would otherwise never see: dockview calls the
    // transform only on a pointer move, so a hand that stops moving stops the
    // frames. The hook has to come back to the decision by itself.
    const desktop = dragging();
    press(500, 300);
    moveTo(4, 300);
    desktop.dragTransform(frame());
    expect(desktop.snapPreview.value).toBeNull();
    clock += DWELL_MS;
    runTimers();
    expect(desktop.snapPreview.value).toEqual(snapBox("left", CONTAINER));
  });

  it("arms nothing once the window has been let go", () => {
    // The press ends before the dwell is served: whatever was pending must not
    // snap a drag that is already over.
    const desktop = dragging();
    press(500, 300);
    moveTo(4, 300);
    desktop.dragTransform(frame());
    fire("pointerup", {});
    clock += DWELL_MS;
    runTimers();
    expect(desktop.snapPreview.value).toBeNull();
  });

  it("keeps an armed zone through the jitter of a hand holding still", () => {
    const desktop = dragging();
    press(500, 300);
    moveTo(4, 300);
    desktop.dragTransform(frame());
    clock += DWELL_MS;
    desktop.dragTransform(frame());
    moveTo(9, 306);
    clock += 16;
    desktop.dragTransform(frame());
    expect(desktop.snapPreview.value).toEqual(snapBox("left", CONTAINER));
  });

  /*
   * What the desktop shows *during* the half second. The pre-arm cue and the
   * armed preview are two different rectangles with two different testids, so
   * that "armed" stays exactly what `snap-preview` means — to the e2e specs and
   * to the user alike.
   */
  it("outlines the box it is waiting on, while arming nothing", () => {
    const desktop = dragging();
    press(500, 300);
    moveTo(4, 300);
    desktop.dragTransform(frame());
    expect(desktop.snapDwelling.value).toEqual({ box: snapBox("left", CONTAINER), since: clock });
    expect(desktop.snapPreview.value).toBeNull();
  });

  it("gives the outline up to the solid preview the moment the wait is served", () => {
    const desktop = dragging();
    press(500, 300);
    moveTo(4, 300);
    desktop.dragTransform(frame());
    clock += DWELL_MS;
    desktop.dragTransform(frame());
    expect(desktop.snapDwelling.value).toBeNull();
    expect(desktop.snapPreview.value).toEqual(snapBox("left", CONTAINER));
  });

  it("outlines nothing while the drag is pointing at no target at all", () => {
    const desktop = dragging();
    press(500, 300);
    moveTo(500, 300);
    desktop.dragTransform(frame());
    expect(desktop.snapDwelling.value).toBeNull();
  });

  it("restarts the outline's clock when the drag drifts off its anchor", () => {
    // The wait itself starts over, so the cue has to as well: a fill that ran
    // on would claim more of the half second had passed than really had.
    const desktop = dragging();
    press(500, 300);
    moveTo(4, 300);
    desktop.dragTransform(frame());
    const started = clock;
    clock += 100;
    moveTo(8, 300);
    desktop.dragTransform({ ...frame(), proposed: { left: 40, top: 40, width: 400, height: 300 } });
    expect(desktop.snapDwelling.value?.since).toBe(started + 100);
  });

  it("takes the outline down when the window is let go mid-wait", () => {
    const desktop = dragging();
    press(500, 300);
    moveTo(4, 300);
    desktop.dragTransform(frame());
    expect(desktop.snapDwelling.value).not.toBeNull();
    fire("pointerup", {});
    expect(desktop.snapDwelling.value).toBeNull();
  });
});

/**
 * The other switch: a dragged window's edges against the OTHER windows'.
 *
 * Unlike a zone, this one has an answer to give dockview — the top-left to put
 * the window at — so these assert on what `dragTransform` returns, and on the
 * preview staying empty, because nothing is being resized.
 */
describe("window-to-window snapping", () => {
  const CONTAINER = { width: 1000, height: 600 };
  const NO_MODIFIERS = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
  /** Where the two windows sit before the drag. */
  const NEIGHBOUR = { x: 100, y: 100, width: 200, height: 150 };
  const DRAGGED = { x: 500, y: 100, width: 200, height: 150 };
  /** The dragged window a few pixels short of flush against the neighbour. */
  const NEARLY_FLUSH = {
    ...DRAGGED,
    x: NEIGHBOUR.x + NEIGHBOUR.width - 4,
    y: NEIGHBOUR.y + 3,
  };

  /** A desktop holding two floating windows, of which `b` is the dragged one. */
  function twoWindows() {
    const dock = fakeDock({ floating: true });
    const desktop = useDesktop();
    desktop.attach(dock.api);
    desktop.openWindow("a", SPEC);
    desktop.openWindow("b", SPEC);
    desktop.snapTo("a", NEIGHBOUR);
    desktop.snapTo("b", DRAGGED);
    const group = dock.raw.panels.find((p) => p.id === "b")?.group;
    return { desktop, dock, group };
  }

  function frame(
    group: unknown,
    box: { x: number; y: number; width: number; height: number },
    modifiers = NO_MODIFIERS,
  ) {
    return {
      group,
      proposed: { left: box.x, top: box.y, width: box.width, height: box.height },
      container: CONTAINER,
      others: [],
      modifiers,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  /** The same frame twice, a dwell apart: what it takes for any snap to act. */
  function dwellOn(desktop: ReturnType<typeof useDesktop>, f: unknown) {
    desktop.dragTransform(f as Parameters<typeof desktop.dragTransform>[0]);
    clock += DWELL_MS;
    return desktop.dragTransform(f as Parameters<typeof desktop.dragTransform>[0]);
  }

  beforeEach(() => setSnapToWindows(true));
  afterEach(() => {
    // The maximised state is published to a module singleton, so a test that
    // maximises a window has to hand the next one a clean desktop.
    publishWindowStates(NO_WINDOWS);
  });

  it("puts the dragged window flush against its neighbour, and level with it", () => {
    const { desktop, group } = twoWindows();
    expect(dwellOn(desktop, frame(group, NEARLY_FLUSH))).toEqual({
      left: NEIGHBOUR.x + NEIGHBOUR.width,
      top: NEIGHBOUR.y,
    });
  });

  it("lines the window up when the drag comes to a standstill beside its neighbour", () => {
    // No further frames arrive, so the hook's own re-run has to move the window.
    const { desktop, dock, group } = twoWindows();
    desktop.dragTransform(frame(group, NEARLY_FLUSH));
    clock += DWELL_MS;
    runTimers();
    const dragged = dock.floats.find((f) => f.group === group);
    expect(dragged?.box).toEqual({
      left: NEIGHBOUR.x + NEIGHBOUR.width,
      top: NEIGHBOUR.y,
      width: DRAGGED.width,
      height: DRAGGED.height,
    });
  });

  it("leaves the window under the pointer until the dwell is served", () => {
    const { desktop, group } = twoWindows();
    expect(desktop.dragTransform(frame(group, NEARLY_FLUSH))).toBeUndefined();
  });

  it("does nothing at all while the switch is off", () => {
    setSnapToWindows(false);
    const { desktop, group } = twoWindows();
    expect(dwellOn(desktop, frame(group, NEARLY_FLUSH))).toBeUndefined();
  });

  /** Where `NEARLY_FLUSH` is snapped to: flush and level, at its own size. */
  const FLUSH = { ...DRAGGED, x: NEIGHBOUR.x + NEIGHBOUR.width, y: NEIGHBOUR.y };

  // A snap that only moves the window used to promise nothing at all, so the
  // window jumped into line unannounced. It is shadowed like every other snap.
  it("outlines the box it will line the window up in while the wait runs", () => {
    const { desktop, group } = twoWindows();
    desktop.dragTransform(frame(group, NEARLY_FLUSH));
    expect(desktop.snapDwelling.value).toEqual({ box: FLUSH, since: clock });
    expect(desktop.snapPreview.value).toBeNull();
  });

  it("previews the lined-up box once armed, though nothing is resized", () => {
    const { desktop, group } = twoWindows();
    dwellOn(desktop, frame(group, NEARLY_FLUSH));
    expect(desktop.snapDwelling.value).toBeNull();
    expect(desktop.snapPreview.value).toEqual(FLUSH);
  });

  it("takes the shadow down when the drag leaves the neighbour", () => {
    const { desktop, group } = twoWindows();
    dwellOn(desktop, frame(group, NEARLY_FLUSH));
    desktop.dragTransform(frame(group, { ...DRAGGED, x: 700, y: 420 }));
    expect(desktop.snapPreview.value).toBeNull();
    expect(desktop.snapDwelling.value).toBeNull();
  });

  it("never lines a window up with a minimised one", () => {
    const { desktop, group } = twoWindows();
    desktop.minimize("a");
    expect(dwellOn(desktop, frame(group, NEARLY_FLUSH))).toBeUndefined();
  });

  it("never lines a window up with a maximised one", () => {
    // A maximised window's box is the whole desktop, so lining up with it is
    // lining up with the desktop's own edges — the *other* switch's gesture,
    // and here one the drag never asked for. It is also the window a seam
    // resize refuses to push about, and the two collections have to agree about
    // what is on the desktop.
    const { desktop, group } = twoWindows();
    desktop.toggleMaximize("a");
    expect(dwellOn(desktop, frame(group, { ...DRAGGED, x: 8, y: 6 }))).toBeUndefined();
  });

  it("never lines a window up with itself", () => {
    // Its own edges are zero away from themselves, so a dragged window that
    // counted as its own neighbour would be pinned where it started.
    const { desktop, group } = twoWindows();
    expect(dwellOn(desktop, frame(group, { ...DRAGGED, x: 700, y: 420 }))).toBeUndefined();
  });

  it("snaps nothing while the free-drag modifier is held", () => {
    const { desktop, group } = twoWindows();
    const held = frame(group, NEARLY_FLUSH, { ...NO_MODIFIERS, altKey: true });
    expect(dwellOn(desktop, held)).toBeUndefined();
  });

  it("gives a screen-edge zone precedence over a neighbour's edge", () => {
    // Both modes would act: the pointer is at the desktop's left edge while the
    // window is nearly flush against its neighbour. The zone is the deliberate
    // gesture — it resizes the window into half the desktop — so it wins, and
    // the nudge stands down rather than fighting it for the same window.
    const { desktop, group } = twoWindows();
    fire("pointerdown", { clientX: ORIGIN.left + 4, clientY: ORIGIN.top + 300, buttons: 1 });
    expect(dwellOn(desktop, frame(group, NEARLY_FLUSH))).toBeUndefined();
    expect(desktop.snapPreview.value).toEqual(snapBox("left", CONTAINER));
  });

  /**
   * The gap-filling half of the gesture, which needs a third window: a window
   * put *between* two others is resized to fill the space, and because dockview
   * keeps the dragged window's size to itself mid-drag that resize is previewed
   * and applied on release.
   */
  describe("dropped into a gap", () => {
    /** The wall on the far side of the gap, 400px from the neighbour's right. */
    const FAR_SIDE = { x: 700, y: NEIGHBOUR.y, width: 200, height: NEIGHBOUR.height };
    /** The box the dragged window should end up in, gap filled. */
    const FILLED = { x: NEIGHBOUR.x + NEIGHBOUR.width, y: NEIGHBOUR.y, width: 400, height: 150 };

    /** The two windows of `twoWindows`, plus the far wall of the gap. */
    function withGap() {
      const dock = fakeDock({ floating: true });
      const desktop = useDesktop();
      desktop.attach(dock.api);
      desktop.openWindow("a", SPEC);
      desktop.openWindow("c", SPEC);
      desktop.openWindow("b", SPEC);
      desktop.snapTo("a", NEIGHBOUR);
      desktop.snapTo("c", FAR_SIDE);
      desktop.snapTo("b", DRAGGED);
      const group = dock.raw.panels.find((p) => p.id === "b")?.group;
      return { desktop, dock, group };
    }

    /** A window's box as dockview holds it. */
    const boxOf = (dock: ReturnType<typeof fakeDock>, group: unknown) => ({
      ...dock.floats.find((f) => f.group === group)!.box,
    });

    it("previews the filled box while still only moving the window", () => {
      const { desktop, group } = withGap();
      expect(dwellOn(desktop, frame(group, NEARLY_FLUSH))).toEqual({
        left: FILLED.x,
        top: FILLED.y,
      });
      expect(desktop.snapPreview.value).toEqual(FILLED);
    });

    it("outlines the filled box while the wait is still running", () => {
      // The pre-arm cue promises exactly what the armed preview will, so the
      // user sees one rectangle firming up rather than two different offers.
      const { desktop, group } = withGap();
      desktop.dragTransform(frame(group, NEARLY_FLUSH));
      expect(desktop.snapDwelling.value).toEqual({ box: FILLED, since: clock });
      expect(desktop.snapPreview.value).toBeNull();
    });

    it("fills the gap when the window is let go", () => {
      const { desktop, dock, group } = withGap();
      dwellOn(desktop, frame(group, NEARLY_FLUSH));
      dock.endDrag(group);
      expect(boxOf(dock, group)).toEqual({
        left: FILLED.x,
        top: FILLED.y,
        width: FILLED.width,
        height: FILLED.height,
      });
      expect(desktop.snapPreview.value).toBeNull();
    });

    it("leaves the size alone when the window was not put between anything", () => {
      // One neighbour and open desktop beyond it: the snap moves the window and
      // the release must not invent a resize for it.
      const { desktop, dock, group } = twoWindows();
      dwellOn(desktop, frame(group, NEARLY_FLUSH));
      dock.endDrag(group);
      expect(boxOf(dock, group).width).toBe(DRAGGED.width);
      expect(boxOf(dock, group).height).toBe(DRAGGED.height);
    });

    it("never applies one window's fill to another window's release", () => {
      // A fill is armed for the dragged window only; a different window let go
      // while it is armed is nobody's gap to fill.
      const { desktop, dock, group } = withGap();
      const other = dock.raw.panels.find((p) => p.id === "c")?.group;
      dwellOn(desktop, frame(group, NEARLY_FLUSH));
      dock.endDrag(other);
      expect(boxOf(dock, other)).toEqual({
        left: FAR_SIDE.x,
        top: FAR_SIDE.y,
        width: FAR_SIDE.width,
        height: FAR_SIDE.height,
      });
    });
  });

  it("still lines windows up when screen-edge snapping is switched off", () => {
    setSnapToEdges(false);
    const { desktop, group } = twoWindows();
    fire("pointerdown", { clientX: ORIGIN.left + 4, clientY: ORIGIN.top + 300, buttons: 1 });
    expect(dwellOn(desktop, frame(group, NEARLY_FLUSH))).toEqual({
      left: NEIGHBOUR.x + NEIGHBOUR.width,
      top: NEIGHBOUR.y,
    });
    expect(desktop.snapPreview.value).toEqual(FLUSH);
  });
});

/**
 * The two movers, and why the desktop has to offer both.
 *
 * Every deliberate placement — a Snap Layouts tile, a tab split, a drop into a
 * gap — brings the window forward, because the user just put it there. A window
 * dragged along by *someone else's* gesture must not: the seam resize in
 * `useSnapGroups.ts` moves every neighbour on every frame, and raising one both
 * puts it in front of the window still being resized and tells the rest of the
 * app the user switched windows.
 */
describe("moving a window without raising it", () => {
  const BOX = { x: 40, y: 60, width: 300, height: 200 };
  const ELSEWHERE = { x: 500, y: 300, width: 300, height: 200 };

  /** Two floating windows, with "b" in front and nothing scheduled yet. */
  function twoWindows() {
    const dock = fakeDock({ floating: true });
    const desktop = useDesktop();
    desktop.attach(dock.api);
    desktop.openWindow("a", SPEC);
    desktop.openWindow("b", SPEC);
    dock.raw.onDidActivePanelChange((e) => dock.announced.push(e.panel?.id));
    dock.setActive.mockClear();
    timers.length = 0;
    return { desktop, dock };
  }

  const boxOf = (dock: ReturnType<typeof fakeDock>, id: string) => ({
    ...dock.floats.find((f) => f.group?.activePanel.id === id)!.box,
  });

  it("moves the window and leaves the one in front alone", () => {
    const { desktop, dock } = twoWindows();

    desktop.moveWindow("a", BOX);

    expect(boxOf(dock, "a")).toEqual({
      left: BOX.x,
      top: BOX.y,
      width: BOX.width,
      height: BOX.height,
    });
    expect(dock.setActive).not.toHaveBeenCalled();
    expect(dock.announced).toEqual([]);
  });

  it("leaves the saving to the end of the gesture", () => {
    // One deferred write per frame per neighbour would only ever push the
    // debounced save further out; the gesture saves once when it ends.
    const { desktop } = twoWindows();
    desktop.moveWindow("a", BOX);
    expect(timers).toEqual([]);
  });

  it("still raises and saves for a window put somewhere on purpose", () => {
    const { desktop, dock } = twoWindows();

    desktop.snapTo("a", ELSEWHERE);

    expect(dock.setActive).toHaveBeenCalledWith("a");
    expect(timers.length).toBe(1);
  });
});

/**
 * The gesture that ends without the page ever hearing it.
 *
 * A mouse released outside the page fires no `pointerup`, `pointercancel` or
 * `blur`, so dockview never announces the drag's end and nothing commits the
 * zone that was armed. What must not happen is that the zone waits there for
 * the *next* gesture: the user's next drag, or a mere resize, would be snapped
 * to an edge they aimed at minutes ago and lose whatever they had just done.
 */
describe("a release the page never saw", () => {
  const CONTAINER = { width: 1000, height: 600 };
  const NO_MODIFIERS = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
  /** Where the one window sits, well away from every edge. */
  const BOX = { x: 500, y: 300, width: 200, height: 150 };

  function oneWindow() {
    const dock = fakeDock({ floating: true });
    const desktop = useDesktop();
    desktop.attach(dock.api);
    desktop.openWindow("tree", SPEC);
    desktop.snapTo("tree", BOX);
    const group = dock.raw.panels.find((p) => p.id === "tree")?.group;
    return { desktop, dock, group };
  }

  const boxOf = (dock: ReturnType<typeof fakeDock>, group: unknown) => ({
    ...dock.floats.find((f) => f.group === group)!.box,
  });

  /** Arms the left half: a press, a drag to the left edge, and the dwell served. */
  function armLeftHalf(desktop: ReturnType<typeof useDesktop>, group: unknown) {
    fire("pointerdown", { clientX: ORIGIN.left + 500, clientY: ORIGIN.top + 300, buttons: 1 });
    fire("pointermove", { clientX: ORIGIN.left + 4, clientY: ORIGIN.top + 300, buttons: 1 });
    const f = {
      group,
      proposed: { left: BOX.x, top: BOX.y, width: BOX.width, height: BOX.height },
      container: CONTAINER,
      others: [],
      modifiers: NO_MODIFIERS,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    desktop.dragTransform(f);
    clock += DWELL_MS;
    desktop.dragTransform(f);
  }

  it("never hands a zone armed by one gesture to the next one", () => {
    const { desktop, dock, group } = oneWindow();
    armLeftHalf(desktop, group);
    expect(desktop.snapPreview.value).toEqual(snapBox("left", CONTAINER));

    // No release reached the page, so dockview's own end never fired either.
    // The next press is the first the desktop hears of it.
    fire("pointerdown", { clientX: ORIGIN.left + 600, clientY: ORIGIN.top + 400, buttons: 1 });
    dock.endDrag(group);

    expect(boxOf(dock, group)).toEqual({
      left: BOX.x,
      top: BOX.y,
      width: BOX.width,
      height: BOX.height,
    });
  });
});

/**
 * Windows' double-click-the-title-bar gesture, which on this desktop is the tab
 * bar — and which has to be the *same* transition as the maximise button, or
 * the two would disagree about the box a window comes back to.
 *
 * `anyMaximized` is what the window's own restore glyph reads, so asserting on
 * it pins the button's appearance after the gesture as well as the geometry.
 */
describe("double-clicking a window's tab bar", () => {
  const SIZE = { width: 1200, height: 800 };
  const BOX = { x: 120, y: 90, width: 400, height: 300 };

  /** A desktop holding one floating window, opened at `BOX`. */
  function withWindow() {
    const dock = fakeDock({ floating: true });
    const desktop = useDesktop();
    desktop.attach(dock.api);
    desktop.openWindow("sounds", { component: "sounds", title: "Soundboard" });
    // `openWindow` cascades, so the box it really got is what a restore must
    // come back to; put it somewhere known instead.
    desktop.snapTo("sounds", BOX);
    return { desktop, dock };
  }

  /** The window's box as dockview holds it. */
  const boxOf = (dock: ReturnType<typeof fakeDock>) => ({ ...dock.floats[0].box });

  /**
   * A double-click whose target answers `closest()` for the given selectors,
   * which is all the desktop asks of it.
   */
  function dblclick(dock: ReturnType<typeof fakeDock>, matched: readonly string[]) {
    const group = dock.raw.panels[0].group?.element ?? null;
    const hits: Record<string, unknown> = { [GROUP_SELECTOR]: group };
    for (const selector of matched) hits[selector] = { selector };
    fireOnDock("dblclick", { target: { closest: (s: string) => hits[s] ?? null } });
  }

  it("maximises the window, and puts it back on the second double-click", () => {
    const { dock } = withWindow();

    dblclick(dock, [TITLE_BAR_SELECTOR]);
    expect(boxOf(dock)).toEqual({ left: 0, top: 0, width: SIZE.width, height: SIZE.height });
    expect(anyMaximized(["sounds"])).toBe(true);

    dblclick(dock, [TITLE_BAR_SELECTOR]);
    expect(boxOf(dock)).toEqual({ left: BOX.x, top: BOX.y, width: BOX.width, height: BOX.height });
    expect(anyMaximized(["sounds"])).toBe(false);
  });

  it("is the same transition the maximise button performs", () => {
    // The button's path, then the gesture's: the second must undo the first,
    // which it can only do if both share one restore box.
    const { desktop, dock } = withWindow();
    desktop.toggleMaximize("sounds");
    expect(anyMaximized(["sounds"])).toBe(true);

    dblclick(dock, [TITLE_BAR_SELECTOR]);
    expect(boxOf(dock)).toEqual({ left: BOX.x, top: BOX.y, width: BOX.width, height: BOX.height });
    expect(anyMaximized(["sounds"])).toBe(false);
  });

  it("ignores a double-click on a tab's close cross or the window controls", () => {
    const { dock } = withWindow();
    dblclick(dock, [TITLE_BAR_SELECTOR, NO_MAXIMIZE_SELECTOR]);
    expect(anyMaximized(["sounds"])).toBe(false);
    expect(boxOf(dock)).toEqual({ left: BOX.x, top: BOX.y, width: BOX.width, height: BOX.height });
  });

  it("ignores a double-click that is not in a tab bar at all", () => {
    const { dock } = withWindow();
    dblclick(dock, []);
    expect(anyMaximized(["sounds"])).toBe(false);
  });
});
