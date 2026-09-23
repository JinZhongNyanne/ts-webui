import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DockviewApi } from "dockview-vue";
import { MIN_WINDOW_EXTENT, type Box } from "./box";
import { setSnapToEdges, setSnapToWindows } from "./snapMode";
import type { Desktop } from "./useDesktop";
import { useSnapGroups, type SnapGroupDesktop } from "./useSnapGroups";

/**
 * The resize-group hook against a stand-in dockview, in the fake-object style of
 * `useDesktop.test.ts` — no DOM library, only the handful of members the hook
 * really touches. The real resize is dockview's own pointer gesture and cannot
 * be exercised here; what is under test is the bookkeeping either side of it:
 * which neighbours are linked when the handle goes down, where each frame puts
 * them, and that the subscription is let go on release.
 */

interface FakeWindow {
  readonly id: string;
  box: Box;
  /** A stand-in for the `.dv-resize-container` element. */
  readonly overlayElement: object;
}

function fakeDesk(boxes: Record<string, Box>) {
  const windows: FakeWindow[] = Object.entries(boxes).map(([id, box]) => ({
    id,
    box,
    overlayElement: { id },
  }));
  const minimized = new Set<string>();
  /** The overlay change handlers, per window id. */
  const frameHandlers = new Map<string, (() => void)[]>();
  const disposed: string[] = [];
  const groups = windows.map((w) => ({
    group: { element: {}, id: w.id },
    win: w,
  }));

  /** Every write-back the hook made to a window's own box, in order. */
  const positioned: { id: string; box: Box }[] = [];

  const floatingGroups = groups.map(({ group, win }) => ({
    group,
    // dockview's `position` is `overlay.setBounds`, which fires the very
    // per-frame event the hook is listening to — so the fake fires it too, and a
    // hook that did not guard re-entrancy would recurse here.
    position: (bounds: { top: number; left: number; width: number; height: number }) => {
      const box = { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height };
      positioned.push({ id: win.id, box });
      win.box = box;
      for (const handler of [...(frameHandlers.get(win.id) ?? [])]) handler();
    },
    overlay: {
      element: win.overlayElement,
      toJSON: () => ({
        left: win.box.x,
        top: win.box.y,
        width: win.box.width,
        height: win.box.height,
      }),
      onDidChange: (handler: () => void) => {
        const list = frameHandlers.get(win.id) ?? [];
        list.push(handler);
        frameHandlers.set(win.id, list);
        return {
          dispose: () => {
            disposed.push(win.id);
            frameHandlers.set(
              win.id,
              (frameHandlers.get(win.id) ?? []).filter((h) => h !== handler),
            );
          },
        };
      },
    },
  }));

  const api = {
    panels: groups.map(({ group, win }) => ({ id: win.id, group })),
    component: { floatingGroups, onDidEndFloatingGroupDrag: () => ({ dispose: () => void 0 }) },
  };

  const snapped: { id: string; box: Box }[] = [];
  /** Ids moved through the desktop's *raising* mover, which a seam must not use. */
  const raised: string[] = [];
  const saves: number[] = [];
  const desktop: SnapGroupDesktop & Pick<Desktop, "snapTo"> = {
    api: { value: api as unknown as DockviewApi },
    isMinimized: (id) => minimized.has(id),
    desktopSize: () => ({ width: 1000, height: 600 }),
    moveWindow: (id, box) => {
      snapped.push({ id, box });
      const win = windows.find((w) => w.id === id);
      if (win) win.box = box;
    },
    // Offered so the tests can prove it is never reached: `snapTo` activates the
    // window it moves, which mid-resize would throw the neighbour in front of
    // the window the user is still dragging.
    snapTo: (id, box) => {
      raised.push(id);
      snapped.push({ id, box });
      const win = windows.find((w) => w.id === id);
      if (win) win.box = box;
    },
    saveLayout: () => saves.push(1),
    snapPreview: { value: null },
  };

  /** The listeners the hook installed, by event name. */
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const target = {
    addEventListener(type: string, listener: (event: unknown) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type: string, listener: (event: unknown) => void) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((l) => l !== listener),
      );
    },
  };

  /** Presses a resize handle of that window, as dockview's own handles are shaped. */
  function press(id: string, direction: string): void {
    const win = windows.find((w) => w.id === id);
    const handle = {
      className: `dv-resize-handle-${direction}`,
      closest: (selector: string) =>
        selector.includes("dv-resize-handle-") ? handle : win?.overlayElement,
    };
    for (const listener of listeners.get("pointerdown") ?? []) listener({ target: handle });
  }

  /** One frame of the drag: the dragged window is already at its new box. */
  function frame(id: string, box: Box): void {
    const win = windows.find((w) => w.id === id);
    if (win) win.box = box;
    for (const handler of frameHandlers.get(id) ?? []) handler();
  }

  function release(type = "pointerup"): void {
    for (const listener of listeners.get(type) ?? []) listener({ type });
  }

  return {
    desktop,
    target,
    press,
    frame,
    release,
    snapped,
    raised,
    saves,
    disposed,
    minimized,
    windows,
    positioned,
  };
}

const HALVES = {
  left: { x: 0, y: 0, width: 500, height: 600 },
  right: { x: 500, y: 0, width: 500, height: 600 },
};

beforeEach(() => {
  setSnapToEdges(true);
  setSnapToWindows(false);
});

afterEach(() => {
  setSnapToEdges(true);
  setSnapToWindows(false);
});

describe("useSnapGroups", () => {
  // A compile-time check, not a runtime one: the hook must keep taking nothing
  // but the desktop composable's own public surface, so that `App.vue` can hand
  // it the real `Desktop` and nothing here ever needs `useDesktop.ts` widened.
  it("asks for no more of the desktop than the composable already offers", () => {
    const widen = (real: Desktop): SnapGroupDesktop => real;
    expect(typeof widen).toBe("function");
  });

  it("moves the flush neighbour's near edge as the seam is dragged", () => {
    const desk = fakeDesk(HALVES);
    const groups = useSnapGroups(desk.desktop);
    groups.install(desk.target);
    desk.press("left", "right");
    desk.frame("left", { x: 0, y: 0, width: 600, height: 600 });
    expect(desk.snapped).toEqual([{ id: "right", box: { x: 600, y: 0, width: 400, height: 600 } }]);
    groups.dispose();
  });

  it("moves an attached window without raising it", () => {
    // The raising mover would call `setActive` on the neighbour, which jumps it
    // in front of the window still being resized and tells the rest of the app
    // the user switched windows — marking a chat read, re-aiming the header
    // controls — on every frame of the drag, and alternating between the two
    // when a second window is attached to the same seam.
    const desk = fakeDesk(HALVES);
    const groups = useSnapGroups(desk.desktop);
    groups.install(desk.target);
    desk.press("left", "right");
    desk.frame("left", { x: 0, y: 0, width: 600, height: 600 });
    desk.frame("left", { x: 0, y: 0, width: 700, height: 600 });
    expect(desk.snapped).toHaveLength(2);
    expect(desk.raised).toEqual([]);
    groups.dispose();
  });

  it("keeps following the same neighbour over several frames", () => {
    const desk = fakeDesk(HALVES);
    const groups = useSnapGroups(desk.desktop);
    groups.install(desk.target);
    desk.press("left", "right");
    desk.frame("left", { x: 0, y: 0, width: 600, height: 600 });
    desk.frame("left", { x: 0, y: 0, width: 400, height: 600 });
    expect(desk.snapped.map((s) => s.box.x)).toEqual([600, 400]);
    expect(desk.snapped.at(-1)?.box.width).toBe(600);
    groups.dispose();
  });

  it("holds the seam back rather than letting the dragged window overlap the neighbour", () => {
    const desk = fakeDesk(HALVES);
    const groups = useSnapGroups(desk.desktop);
    groups.install(desk.target);
    desk.press("left", "right");
    // The pointer asks for 990; the neighbour runs out of room at 840.
    desk.frame("left", { x: 0, y: 0, width: 990, height: 600 });
    expect(desk.positioned).toEqual([
      { id: "left", box: { x: 0, y: 0, width: 1000 - MIN_WINDOW_EXTENT, height: 600 } },
    ]);
    expect(desk.snapped.at(-1)?.box).toEqual({
      x: 1000 - MIN_WINDOW_EXTENT,
      y: 0,
      width: MIN_WINDOW_EXTENT,
      height: 600,
    });
    groups.dispose();
  });

  it("keeps the seam at the limit however much further the pointer is pulled", () => {
    const desk = fakeDesk(HALVES);
    const groups = useSnapGroups(desk.desktop);
    groups.install(desk.target);
    desk.press("left", "right");
    desk.frame("left", { x: 0, y: 0, width: 900, height: 600 });
    desk.frame("left", { x: 0, y: 0, width: 990, height: 600 });
    // Idempotent: the same limit every frame, never creeping further.
    expect(desk.positioned.map((p) => p.box.width)).toEqual([840, 840]);
    expect(desk.snapped.map((s) => s.box.x)).toEqual([840, 840]);
    groups.dispose();
  });

  it("writes the held box back exactly once, though that refires the frame event", () => {
    const desk = fakeDesk(HALVES);
    const groups = useSnapGroups(desk.desktop);
    groups.install(desk.target);
    desk.press("left", "right");
    desk.frame("left", { x: 0, y: 0, width: 990, height: 600 });
    expect(desk.positioned).toHaveLength(1);
    expect(desk.snapped).toHaveLength(1);
    groups.dispose();
  });

  it("leaves dockview's box alone for a frame that is within the limit", () => {
    const desk = fakeDesk(HALVES);
    const groups = useSnapGroups(desk.desktop);
    groups.install(desk.target);
    desk.press("left", "right");
    desk.frame("left", { x: 0, y: 0, width: 600, height: 600 });
    expect(desk.positioned).toEqual([]);
    groups.dispose();
  });

  it("holds both axes of a corner drag, each at its own limit", () => {
    const desk = fakeDesk({
      a: { x: 0, y: 0, width: 500, height: 300 },
      r: { x: 500, y: 0, width: 500, height: 300 },
      b: { x: 0, y: 300, width: 500, height: 300 },
    });
    const groups = useSnapGroups(desk.desktop);
    groups.install(desk.target);
    desk.press("a", "bottomright");
    desk.frame("a", { x: 0, y: 0, width: 900, height: 500 });
    expect(desk.positioned).toEqual([{ id: "a", box: { x: 0, y: 0, width: 840, height: 440 } }]);
    expect(desk.snapped).toEqual([
      { id: "b", box: { x: 0, y: 440, width: 500, height: 160 } },
      { id: "r", box: { x: 840, y: 0, width: 160, height: 300 } },
    ]);
    groups.dispose();
  });

  it("leaves the axis of a corner drag that has no neighbour unbounded", () => {
    const desk = fakeDesk({
      a: { x: 0, y: 0, width: 500, height: 300 },
      r: { x: 500, y: 0, width: 500, height: 300 },
    });
    const groups = useSnapGroups(desk.desktop);
    groups.install(desk.target);
    desk.press("a", "bottomright");
    desk.frame("a", { x: 0, y: 0, width: 900, height: 500 });
    // The width is held at 840; the height the user asked for is untouched.
    expect(desk.positioned).toEqual([{ id: "a", box: { x: 0, y: 0, width: 840, height: 500 } }]);
    groups.dispose();
  });

  it("holds a dragged left edge without moving the window's far side", () => {
    const desk = fakeDesk(HALVES);
    const groups = useSnapGroups(desk.desktop);
    groups.install(desk.target);
    desk.press("right", "left");
    desk.frame("right", { x: 10, y: 0, width: 990, height: 600 });
    expect(desk.positioned).toEqual([
      { id: "right", box: { x: MIN_WINDOW_EXTENT, y: 0, width: 840, height: 600 } },
    ]);
    expect(desk.snapped).toEqual([
      { id: "left", box: { x: 0, y: 0, width: MIN_WINDOW_EXTENT, height: 600 } },
    ]);
    groups.dispose();
  });

  // What the rig saw: the seam between two halves is where both windows'
  // handles overlap, and the press lands on the one in front — here the right
  // window's *left* handle. Pulled rightwards, the window being squeezed is the
  // dragged one, and before its own minimum bounded the seam it went straight
  // down to dockview's 20px floor.
  it("stops the seam at the dragged window's own minimum when pressed from the far side", () => {
    const desk = fakeDesk(HALVES);
    const groups = useSnapGroups(desk.desktop);
    groups.install(desk.target);
    desk.press("right", "left");
    desk.frame("right", { x: 918, y: 0, width: 82, height: 600 });
    expect(desk.positioned).toEqual([
      {
        id: "right",
        box: { x: 1000 - MIN_WINDOW_EXTENT, y: 0, width: MIN_WINDOW_EXTENT, height: 600 },
      },
    ]);
    expect(desk.snapped).toEqual([
      { id: "left", box: { x: 0, y: 0, width: 1000 - MIN_WINDOW_EXTENT, height: 600 } },
    ]);
    groups.dispose();
  });

  it("leaves a window that is not flush with the dragged edge alone", () => {
    const desk = fakeDesk({
      left: HALVES.left,
      away: { x: 700, y: 0, width: 200, height: 600 },
    });
    const groups = useSnapGroups(desk.desktop);
    groups.install(desk.target);
    desk.press("left", "right");
    desk.frame("left", { x: 0, y: 0, width: 600, height: 600 });
    expect(desk.snapped).toEqual([]);
    groups.dispose();
  });

  it("does not follow an edge the user is not dragging", () => {
    const desk = fakeDesk(HALVES);
    const groups = useSnapGroups(desk.desktop);
    groups.install(desk.target);
    desk.press("left", "bottom");
    desk.frame("left", { x: 0, y: 0, width: 500, height: 400 });
    expect(desk.snapped).toEqual([]);
    groups.dispose();
  });

  // The one-hop guarantee, and the case the seam model must not break: in a row
  // A|B|C the A|B seam and the B|C seam are *different* lines, so C is not on the
  // seam being dragged and nothing reaches it.
  it("leaves the third window of a row untouched — A|B|C is one hop", () => {
    const desk = fakeDesk({
      a: { x: 0, y: 0, width: 300, height: 600 },
      b: { x: 300, y: 0, width: 300, height: 600 },
      c: { x: 600, y: 0, width: 400, height: 600 },
    });
    const groups = useSnapGroups(desk.desktop);
    groups.install(desk.target);
    desk.press("a", "right");
    desk.frame("a", { x: 0, y: 0, width: 400, height: 600 });
    expect(desk.snapped).toEqual([{ id: "b", box: { x: 400, y: 0, width: 200, height: 600 } }]);
    groups.dispose();
  });

  // A and B stacked on the left, C spanning both on the right: one seam line at
  // x=500, not two. See `snapGroup.ts` — every window with an edge on that line
  // follows it, so B can never be left behind overlapping C.
  const STACKED = {
    a: { x: 0, y: 0, width: 500, height: 300 },
    b: { x: 0, y: 300, width: 500, height: 300 },
    c: { x: 500, y: 0, width: 500, height: 600 },
  };

  it("moves every window on the seam, not only the one that was dragged into", () => {
    const desk = fakeDesk(STACKED);
    const groups = useSnapGroups(desk.desktop);
    groups.install(desk.target);
    desk.press("a", "right");
    desk.frame("a", { x: 0, y: 0, width: 600, height: 300 });
    expect(desk.snapped).toEqual([
      { id: "c", box: { x: 600, y: 0, width: 400, height: 600 } },
      { id: "b", box: { x: 0, y: 300, width: 600, height: 300 } },
    ]);
    groups.dispose();
  });

  it("moves the window above when the lower one's edge is the one dragged", () => {
    const desk = fakeDesk(STACKED);
    const groups = useSnapGroups(desk.desktop);
    groups.install(desk.target);
    desk.press("b", "right");
    desk.frame("b", { x: 0, y: 300, width: 400, height: 300 });
    expect(desk.snapped).toEqual([
      { id: "c", box: { x: 400, y: 0, width: 600, height: 600 } },
      { id: "a", box: { x: 0, y: 0, width: 400, height: 300 } },
    ]);
    groups.dispose();
  });

  it("holds the seam at the minimum of a window on the dragged one's own side", () => {
    const desk = fakeDesk(STACKED);
    const groups = useSnapGroups(desk.desktop);
    groups.install(desk.target);
    desk.press("a", "right");
    // Pushing the seam back left squeezes A *and* B; B binds at x=0 plus the
    // minimum, which a rule that only looked at C would have missed entirely.
    desk.frame("a", { x: 0, y: 0, width: 20, height: 300 });
    expect(desk.positioned).toEqual([
      { id: "a", box: { x: 0, y: 0, width: MIN_WINDOW_EXTENT, height: 300 } },
    ]);
    expect(desk.snapped).toEqual([
      { id: "c", box: { x: MIN_WINDOW_EXTENT, y: 0, width: 840, height: 600 } },
      { id: "b", box: { x: 0, y: 300, width: MIN_WINDOW_EXTENT, height: 300 } },
    ]);
    groups.dispose();
  });

  it("follows the seam with three windows stacked against one tall neighbour", () => {
    const desk = fakeDesk({
      t: { x: 0, y: 0, width: 500, height: 200 },
      m: { x: 0, y: 200, width: 500, height: 200 },
      l: { x: 0, y: 400, width: 500, height: 200 },
      tall: { x: 500, y: 0, width: 500, height: 600 },
    });
    const groups = useSnapGroups(desk.desktop);
    groups.install(desk.target);
    desk.press("t", "right");
    desk.frame("t", { x: 0, y: 0, width: 600, height: 200 });
    expect(desk.snapped).toEqual([
      { id: "tall", box: { x: 600, y: 0, width: 400, height: 600 } },
      { id: "m", box: { x: 0, y: 200, width: 600, height: 200 } },
      { id: "l", box: { x: 0, y: 400, width: 600, height: 200 } },
    ]);
    groups.dispose();
  });

  it("leaves a window on the seam that is connected to nothing on it alone", () => {
    const desk = fakeDesk({
      ...STACKED,
      // Its left edge is on the seam, but it sits below every window that is,
      // so nothing on the seam reaches it: pure coincidence of coordinates.
      away: { x: 500, y: 700, width: 300, height: 200 },
    });
    const groups = useSnapGroups(desk.desktop);
    groups.install(desk.target);
    desk.press("a", "right");
    desk.frame("a", { x: 0, y: 0, width: 600, height: 300 });
    expect(desk.snapped.map((s) => s.id)).toEqual(["c", "b"]);
    groups.dispose();
  });

  it("never treats a minimised window as a neighbour", () => {
    const desk = fakeDesk(HALVES);
    desk.minimized.add("right");
    const groups = useSnapGroups(desk.desktop);
    groups.install(desk.target);
    desk.press("left", "right");
    desk.frame("left", { x: 0, y: 0, width: 600, height: 600 });
    expect(desk.snapped).toEqual([]);
    groups.dispose();
  });

  it("stops following once the pointer is released, and saves the layout", () => {
    const desk = fakeDesk(HALVES);
    const groups = useSnapGroups(desk.desktop);
    groups.install(desk.target);
    desk.press("left", "right");
    desk.release();
    expect(desk.disposed).toEqual(["left"]);
    expect(desk.saves.length).toBe(1);
    desk.frame("left", { x: 0, y: 0, width: 600, height: 600 });
    expect(desk.snapped).toEqual([]);
    groups.dispose();
  });

  it("stops following when the drag is cancelled", () => {
    const desk = fakeDesk(HALVES);
    const groups = useSnapGroups(desk.desktop);
    groups.install(desk.target);
    desk.press("left", "right");
    desk.release("pointercancel");
    expect(desk.disposed).toEqual(["left"]);
    groups.dispose();
  });

  it("does nothing when the user has switched off all snapping", () => {
    const desk = fakeDesk(HALVES);
    setSnapToEdges(false);
    setSnapToWindows(false);
    const groups = useSnapGroups(desk.desktop);
    groups.install(desk.target);
    desk.press("left", "right");
    desk.frame("left", { x: 0, y: 0, width: 600, height: 600 });
    expect(desk.snapped).toEqual([]);
    groups.dispose();
  });

  it("works with only window-to-window snapping switched on", () => {
    const desk = fakeDesk(HALVES);
    setSnapToEdges(false);
    setSnapToWindows(true);
    const groups = useSnapGroups(desk.desktop);
    groups.install(desk.target);
    desk.press("left", "right");
    desk.frame("left", { x: 0, y: 0, width: 600, height: 600 });
    expect(desk.snapped).toHaveLength(1);
    groups.dispose();
  });

  describe("snapping while resizing", () => {
    // A 12px strip of wallpaper between the two: close, but not a seam, so the
    // right edge is free and a resize towards the neighbour can snap to it.
    const APART = {
      a: { x: 0, y: 0, width: 388, height: 600 },
      b: { x: 400, y: 0, width: 600, height: 600 },
    };

    it("previews the snapped box while the edge goes on following the pointer", () => {
      setSnapToWindows(true);
      const desk = fakeDesk(APART);
      const groups = useSnapGroups(desk.desktop);
      groups.install(desk.target);
      desk.press("a", "right");
      desk.frame("a", { x: 0, y: 0, width: 393, height: 600 });
      expect(desk.desktop.snapPreview.value).toEqual({ x: 0, y: 0, width: 400, height: 600 });
      expect(desk.positioned).toEqual([]);
      groups.dispose();
    });

    it("lands the edge on the snapped box on release, writing it once and saving once", () => {
      setSnapToWindows(true);
      const desk = fakeDesk(APART);
      const groups = useSnapGroups(desk.desktop);
      groups.install(desk.target);
      desk.press("a", "right");
      desk.frame("a", { x: 0, y: 0, width: 393, height: 600 });
      desk.frame("a", { x: 0, y: 0, width: 395, height: 600 });
      desk.release();
      expect(desk.positioned).toEqual([{ id: "a", box: { x: 0, y: 0, width: 400, height: 600 } }]);
      expect(desk.desktop.snapPreview.value).toBeNull();
      expect(desk.saves).toEqual([1]);
      groups.dispose();
    });

    it("leaves dockview's box exactly as dragged when nothing is in reach", () => {
      setSnapToWindows(true);
      const desk = fakeDesk(APART);
      const groups = useSnapGroups(desk.desktop);
      groups.install(desk.target);
      desk.press("a", "right");
      desk.frame("a", { x: 0, y: 0, width: 300, height: 600 });
      expect(desk.desktop.snapPreview.value).toBeNull();
      desk.release();
      expect(desk.positioned).toEqual([]);
      expect(desk.saves).toEqual([]);
      groups.dispose();
    });

    it("withdraws the preview when the edge leaves reach, and then commits nothing", () => {
      setSnapToWindows(true);
      const desk = fakeDesk(APART);
      const groups = useSnapGroups(desk.desktop);
      groups.install(desk.target);
      desk.press("a", "right");
      desk.frame("a", { x: 0, y: 0, width: 393, height: 600 });
      desk.frame("a", { x: 0, y: 0, width: 350, height: 600 });
      expect(desk.desktop.snapPreview.value).toBeNull();
      desk.release();
      expect(desk.positioned).toEqual([]);
      groups.dispose();
    });

    it("commits nothing when the drag is cancelled rather than released", () => {
      setSnapToWindows(true);
      const desk = fakeDesk(APART);
      const groups = useSnapGroups(desk.desktop);
      groups.install(desk.target);
      desk.press("a", "right");
      desk.frame("a", { x: 0, y: 0, width: 393, height: 600 });
      desk.release("pointercancel");
      expect(desk.positioned).toEqual([]);
      expect(desk.desktop.snapPreview.value).toBeNull();
      groups.dispose();
    });

    it("snaps to the desktop's edge with only screen-edge snapping on", () => {
      const desk = fakeDesk({ a: { x: 0, y: 0, width: 500, height: 600 } });
      const groups = useSnapGroups(desk.desktop);
      groups.install(desk.target);
      desk.press("a", "right");
      desk.frame("a", { x: 0, y: 0, width: 994, height: 600 });
      desk.release();
      expect(desk.positioned).toEqual([{ id: "a", box: { x: 0, y: 0, width: 1000, height: 600 } }]);
      groups.dispose();
    });

    it("ignores other windows with window-to-window snapping off", () => {
      setSnapToWindows(false);
      const desk = fakeDesk(APART);
      const groups = useSnapGroups(desk.desktop);
      groups.install(desk.target);
      desk.press("a", "right");
      desk.frame("a", { x: 0, y: 0, width: 393, height: 600 });
      expect(desk.desktop.snapPreview.value).toBeNull();
      groups.dispose();
    });

    it("leaves a seamed edge to its seam and snaps the free axis of the corner", () => {
      // The right edge is on the seam with `r`; the bottom one is free and 6px
      // short of the desktop's bottom edge.
      const desk = fakeDesk({
        a: { x: 0, y: 0, width: 500, height: 300 },
        r: { x: 500, y: 0, width: 500, height: 300 },
      });
      const groups = useSnapGroups(desk.desktop);
      groups.install(desk.target);
      desk.press("a", "bottomright");
      desk.frame("a", { x: 0, y: 0, width: 600, height: 594 });
      // The seam has not jumped anywhere: `r` followed it to exactly 600.
      expect(desk.snapped).toEqual([{ id: "r", box: { x: 600, y: 0, width: 400, height: 300 } }]);
      expect(desk.desktop.snapPreview.value).toEqual({ x: 0, y: 0, width: 600, height: 600 });
      desk.release();
      expect(desk.positioned).toEqual([{ id: "a", box: { x: 0, y: 0, width: 600, height: 600 } }]);
      expect(desk.snapped.at(-1)).toEqual({
        id: "r",
        box: { x: 600, y: 0, width: 400, height: 300 },
      });
      expect(desk.saves).toEqual([1]);
      groups.dispose();
    });

    it("never snaps a seam that is held at its limit on past it", () => {
      // The seam is clamped at 840 and the desktop edge is 160px further on:
      // the seamed edge is the seam's, so nothing pulls it out to 1000.
      const desk = fakeDesk(HALVES);
      const groups = useSnapGroups(desk.desktop);
      groups.install(desk.target);
      desk.press("left", "right");
      desk.frame("left", { x: 0, y: 0, width: 995, height: 600 });
      expect(desk.desktop.snapPreview.value).toBeNull();
      desk.release();
      expect(desk.positioned.map((p) => p.box.width)).toEqual([1000 - MIN_WINDOW_EXTENT]);
      groups.dispose();
    });
  });

  it("ignores a press on a handle it does not recognise", () => {
    const desk = fakeDesk(HALVES);
    const groups = useSnapGroups(desk.desktop);
    groups.install(desk.target);
    // A direction dockview does not have: no edges, so no group is resolved.
    desk.press("left", "sideways");
    desk.frame("left", { x: 0, y: 0, width: 600, height: 600 });
    expect(desk.snapped).toEqual([]);
    groups.dispose();
  });

  it("survives a dock that is not attached yet", () => {
    const desk = fakeDesk(HALVES);
    const groups = useSnapGroups({ ...desk.desktop, api: { value: null } });
    groups.install(desk.target);
    expect(() => desk.press("left", "right")).not.toThrow();
    groups.dispose();
  });

  it("releases its own listener when disposed", () => {
    const desk = fakeDesk(HALVES);
    const groups = useSnapGroups(desk.desktop);
    groups.install(desk.target);
    groups.dispose();
    desk.press("left", "right");
    desk.frame("left", { x: 0, y: 0, width: 600, height: 600 });
    expect(desk.snapped).toEqual([]);
  });
});
