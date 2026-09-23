import { describe, expect, it, vi } from "vitest";
import { floatingWindows, overlayElementOf } from "./dockviewInternals";

const BOX = { x: 10, y: 20, width: 300, height: 200 };

/** A stand-in for dockview's component object, shaped the way it really is. */
function fakeApi(group: object, position = vi.fn()) {
  const overlay = { toJSON: () => ({ left: 10, top: 20, width: 300, height: 200 }) };
  return {
    component: {
      floatingGroups: [{ group, position, overlay }],
      onDidEndFloatingGroupDrag: (handler: (g: unknown) => void) => {
        handlers.push(handler);
        return { dispose: () => void 0 };
      },
    },
  };
}
const handlers: ((g: unknown) => void)[] = [];

describe("floatingWindows", () => {
  it("reports itself available for a real component object", () => {
    expect(floatingWindows(fakeApi({})).available).toBe(true);
  });

  it("reads a floating window's box", () => {
    const group = {};
    expect(floatingWindows(fakeApi(group)).boxOf(group)).toEqual(BOX);
  });

  it("moves and resizes a floating window in one call, anchored top-left", () => {
    const group = {};
    const position = vi.fn();
    const ok = floatingWindows(fakeApi(group, position)).position(group, BOX);
    expect(ok).toBe(true);
    // `top` and `left` are always passed so the overlay's anchor stays put.
    expect(position).toHaveBeenCalledWith({ top: 20, left: 10, width: 300, height: 200 });
  });

  it("reports a group it does not hold rather than throwing", () => {
    const windows = floatingWindows(fakeApi({}));
    expect(windows.boxOf({})).toBeNull();
    expect(windows.position({}, BOX)).toBe(false);
  });

  it("forwards the drag-end event", () => {
    handlers.length = 0;
    const group = {};
    const seen: unknown[] = [];
    floatingWindows(fakeApi(group)).onDragEnd((g) => seen.push(g));
    handlers.forEach((h) => h(group));
    expect(seen).toEqual([group]);
  });

  it("degrades to a no-op when dockview has no component object", () => {
    const windows = floatingWindows({});
    expect(windows.available).toBe(false);
    expect(windows.boxOf({})).toBeNull();
    expect(windows.position({}, BOX)).toBe(false);
    expect(() => windows.onDragEnd(() => void 0).dispose()).not.toThrow();
  });

  it("degrades to a no-op for a component object of the wrong shape", () => {
    const windows = floatingWindows({ component: { floatingGroups: "nope" } });
    expect(windows.available).toBe(false);
    expect(windows.position({}, BOX)).toBe(false);
  });

  it("survives an overlay whose box is not numbers", () => {
    const group = {};
    const api = {
      component: {
        floatingGroups: [{ group, position: vi.fn(), overlay: { toJSON: () => ({ left: "x" }) } }],
        onDidEndFloatingGroupDrag: () => ({ dispose: () => void 0 }),
      },
    };
    expect(floatingWindows(api).boxOf(group)).toBeNull();
  });
});

describe("overlayElementOf", () => {
  // vitest's unit tests run in the NODE environment, where the global
  // `HTMLElement` does not exist — so this must never throw for any input.
  it("returns null for a group whose element is undefined", () => {
    expect(() => overlayElementOf({})).not.toThrow();
    expect(overlayElementOf({})).toBeNull();
  });

  it("returns null for a group whose element is a plain object", () => {
    expect(() => overlayElementOf({ element: {} })).not.toThrow();
    expect(overlayElementOf({ element: {} })).toBeNull();
  });

  it("returns null for a group whose element is a primitive", () => {
    expect(() => overlayElementOf({ element: "not-an-element" })).not.toThrow();
    expect(overlayElementOf({ element: "not-an-element" })).toBeNull();
  });

  it("returns null for an empty object", () => {
    const empty = {} as { element?: unknown };
    expect(() => overlayElementOf(empty)).not.toThrow();
    expect(overlayElementOf(empty)).toBeNull();
  });
});

/**
 * dockview's overlay re-anchors itself to whichever edge is nearer on every
 * drag and resize, so a window in the right-hand or lower part of the desktop
 * serialises as `right` / `bottom`. These pin the conversion back to the
 * top-left box the rest of the desktop speaks in.
 */
describe("reading an anchored box", () => {
  const CONTAINER = { width: 1000, height: 600 };

  /** A component whose single float reports `raw` and sits in `container`. */
  function anchoredApi(raw: unknown, container: { width: number; height: number } | null) {
    const group = {};
    return {
      group,
      api: {
        component: {
          floatingGroups: [
            {
              group,
              position: vi.fn(),
              overlay: {
                element: {
                  parentElement: container ? { getBoundingClientRect: () => container } : null,
                },
                toJSON: () => raw,
              },
            },
          ],
          onDidEndFloatingGroupDrag: () => ({ dispose: () => void 0 }),
        },
      },
    };
  }

  it("resolves a right-anchored window against the container's width", () => {
    const { api, group } = anchoredApi({ right: 100, top: 20, width: 300, height: 200 }, CONTAINER);
    // 1000 - 100 - 300 = 600.
    expect(floatingWindows(api).boxOf(group)).toEqual({ x: 600, y: 20, width: 300, height: 200 });
  });

  it("resolves a bottom-anchored window against the container's height", () => {
    const { api, group } = anchoredApi(
      { left: 40, bottom: 50, width: 300, height: 200 },
      CONTAINER,
    );
    // 600 - 50 - 200 = 350.
    expect(floatingWindows(api).boxOf(group)).toEqual({ x: 40, y: 350, width: 300, height: 200 });
  });

  it("resolves a bottom-right-anchored window on both axes at once", () => {
    const { api, group } = anchoredApi({ right: 0, bottom: 0, width: 300, height: 200 }, CONTAINER);
    expect(floatingWindows(api).boxOf(group)).toEqual({ x: 700, y: 400, width: 300, height: 200 });
  });

  // After a resize the anchor offsets are unchanged but the live container is
  // not; the desktop asks for the box as it was on the old desktop.
  it("resolves an anchor against a container size it is handed instead", () => {
    const { api, group } = anchoredApi({ right: 0, bottom: 0, width: 300, height: 200 }, CONTAINER);
    expect(floatingWindows(api).boxOf(group, { width: 800, height: 500 })).toEqual({
      x: 500,
      y: 300,
      width: 300,
      height: 200,
    });
  });

  it("still reads a top-left box without measuring the container", () => {
    const { api, group } = anchoredApi({ left: 10, top: 20, width: 300, height: 200 }, null);
    expect(floatingWindows(api).boxOf(group)).toEqual(BOX);
  });

  it("gives up rather than guess when the container cannot be measured", () => {
    const { api, group } = anchoredApi({ right: 100, top: 20, width: 300, height: 200 }, null);
    expect(floatingWindows(api).boxOf(group)).toBeNull();
  });

  // dockview's container is 0x0 for a frame or two; a box resolved against it
  // would put the window at a negative offset.
  it("gives up for a container that has no size yet", () => {
    const { api, group } = anchoredApi(
      { right: 100, top: 20, width: 300, height: 200 },
      { width: 0, height: 0 },
    );
    expect(floatingWindows(api).boxOf(group)).toBeNull();
  });
});

/**
 * The resize half of the internals, which the snap-group feature rides on:
 * `Overlay` fires its public `onDidChange` once per frame from `setBounds`, and
 * the handle that was pressed identifies the window by its overlay element.
 */
describe("watching a resize", () => {
  /** A float whose overlay optionally has the event and an element. */
  function resizeApi(options: { event?: boolean; element?: unknown } = {}) {
    const group = {};
    const fired: (() => void)[] = [];
    const disposed: boolean[] = [];
    const overlay: Record<string, unknown> = {
      toJSON: () => ({ left: 0, top: 0, width: 100, height: 100 }),
      element: options.element,
    };
    if (options.event !== false) {
      overlay.onDidChange = (handler: () => void) => {
        fired.push(handler);
        return {
          dispose: () => {
            disposed.push(true);
          },
        };
      };
    }
    return {
      group,
      fired,
      disposed,
      api: {
        component: {
          floatingGroups: [{ group, position: vi.fn(), overlay }],
          onDidEndFloatingGroupDrag: () => ({ dispose: () => void 0 }),
        },
      },
    };
  }

  it("forwards every fire of the overlay's change event", () => {
    const { api, group, fired } = resizeApi();
    let seen = 0;
    floatingWindows(api).onChange(group, () => seen++);
    fired.forEach((h) => h());
    fired.forEach((h) => h());
    expect(seen).toBe(2);
  });

  it("disposes the subscription it made", () => {
    const { api, group, disposed } = resizeApi();
    floatingWindows(api)
      .onChange(group, () => void 0)
      .dispose();
    expect(disposed).toEqual([true]);
  });

  it("degrades to a no-op when the overlay has no change event", () => {
    const { api, group } = resizeApi({ event: false });
    const sub = floatingWindows(api).onChange(group, () => void 0);
    expect(() => sub.dispose()).not.toThrow();
  });

  it("degrades to a no-op for a group it does not hold", () => {
    const { api } = resizeApi();
    expect(() =>
      floatingWindows(api)
        .onChange({}, () => void 0)
        .dispose(),
    ).not.toThrow();
  });

  it("finds the window a pressed handle belongs to by its overlay element", () => {
    const container = { name: "overlay" };
    const { api, group } = resizeApi({ element: container });
    const handle = { closest: (selector: string) => (selector ? container : null) };
    expect(floatingWindows(api).groupOfElement(handle)).toBe(group);
  });

  it("finds no window for a handle outside any overlay", () => {
    const { api } = resizeApi({ element: { name: "overlay" } });
    expect(floatingWindows(api).groupOfElement({ closest: () => null })).toBeNull();
  });

  it("finds no window for something that is not an element at all", () => {
    const { api } = resizeApi({ element: { name: "overlay" } });
    expect(floatingWindows(api).groupOfElement(null)).toBeNull();
    expect(floatingWindows(api).groupOfElement("nope")).toBeNull();
  });

  it("offers the same no-ops when dockview is unavailable", () => {
    const windows = floatingWindows({});
    expect(windows.groupOfElement({ closest: () => ({}) })).toBeNull();
    expect(() => windows.onChange({}, () => void 0).dispose()).not.toThrow();
  });
});
