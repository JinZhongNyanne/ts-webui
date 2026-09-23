import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DockviewApi } from "dockview-vue";
import { watchDesktopResize } from "./desktopResize";
import { snapBox } from "./snap";

/**
 * The resize watcher against a stand-in dockview and a hand-driven
 * ResizeObserver, so the one thing that matters — *when* boxes are read and
 * when they are written, relative to dockview's own clamp — can be replayed
 * step by step.
 */

interface Raw {
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;
  width: number;
  height: number;
}

let hostSize: { width: number; height: number };
let observed: (() => void) | null;
let resizeListener: (() => void) | null;

beforeEach(() => {
  hostSize = { width: 1000, height: 600 };
  observed = null;
  resizeListener = null;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        observed = callback;
      }
      observe() {}
      disconnect() {
        observed = null;
      }
    },
  );
  vi.stubGlobal("window", {
    addEventListener: (_type: string, listener: () => void) => void (resizeListener = listener),
    removeEventListener: () => void (resizeListener = null),
  });
});
afterEach(() => vi.unstubAllGlobals());

/** One floating window whose overlay serialises as `raw`, and moves when positioned. */
function fakeDock(raw: Raw) {
  const group = {};
  const state = { raw };
  const entry = {
    group,
    overlay: { toJSON: () => state.raw },
    position: (b: { top: number; left: number; width: number; height: number }) => {
      state.raw = { top: b.top, left: b.left, width: b.width, height: b.height };
    },
  };
  const api = {
    panels: [{ id: "a", group }],
    component: { floatingGroups: [entry], onDidEndFloatingGroupDrag: () => ({ dispose() {} }) },
  };
  const box = () => ({ x: state.raw.left, y: state.raw.top, width: raw.width, height: raw.height });
  /** What dockview's own layout pass does to a window that overflows the host. */
  const clamp = () => {
    const r = state.raw;
    if (r.left === undefined || r.top === undefined) return;
    state.raw = {
      ...r,
      left: Math.min(r.left, hostSize.width - r.width),
      top: Math.min(r.top, hostSize.height - r.height),
    };
  };
  return { api: api as unknown as DockviewApi, state, box, clamp };
}

const host = {
  querySelector: () => null,
  getBoundingClientRect: () => hostSize,
} as unknown as HTMLElement;

describe("watchDesktopResize", () => {
  it("keeps a right-half window a right half on a shrinking desktop, despite dockview's clamp", () => {
    const right = snapBox("right", { width: 1000, height: 600 });
    const dock = fakeDock({
      left: right.x,
      top: right.y,
      width: right.width,
      height: right.height,
    });
    const onRefit = vi.fn();
    watchDesktopResize(dock.api, host, onRefit);

    // The browser's order: resize event, then dockview's layout pass (host
    // resized, windows clamped), then the observer.
    resizeListener?.();
    hostSize = { width: 800, height: 600 };
    dock.clamp();
    observed?.();

    const expected = snapBox("right", { width: 800, height: 600 });
    expect(dock.state.raw).toEqual({
      left: expected.x,
      top: expected.y,
      width: expected.width,
      height: expected.height,
    });
    expect(onRefit).toHaveBeenCalledWith({ width: 1000, height: 600 }, { width: 800, height: 600 });
  });

  it("keeps a right-anchored window's gap when the host resizes with no resize event", () => {
    // dockview's drag anchors a window to the nearer edge; the anchor offsets
    // survive the resize, so they are resolved against the *old* size.
    const dock = fakeDock({ right: 0, bottom: 0, width: 300, height: 200 });
    watchDesktopResize(dock.api, host, () => void 0);

    hostSize = { width: 1400, height: 900 };
    observed?.();

    expect(dock.state.raw).toEqual({ left: 1100, top: 700, width: 300, height: 200 });
  });

  it("does nothing when the host's size has not changed", () => {
    const dock = fakeDock({ left: 10, top: 20, width: 300, height: 200 });
    const onRefit = vi.fn();
    watchDesktopResize(dock.api, host, onRefit);

    resizeListener?.();
    observed?.();

    expect(onRefit).not.toHaveBeenCalled();
    expect(dock.box()).toEqual({ x: 10, y: 20, width: 300, height: 200 });
  });

  it("stops listening once disposed", () => {
    const dock = fakeDock({ left: 10, top: 20, width: 300, height: 200 });
    const stop = watchDesktopResize(dock.api, host, () => void 0);
    stop();
    expect(observed).toBeNull();
    expect(resizeListener).toBeNull();
  });
});
