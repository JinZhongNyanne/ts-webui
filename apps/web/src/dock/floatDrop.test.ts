import { describe, expect, it } from "vitest";
import {
  desktopDropFor,
  FLOAT_GRAB_OFFSET,
  FLOAT_HEIGHT,
  FLOAT_WIDTH,
  floatBoxAt,
  floatTargetForDrop,
  landingBoxFor,
  tearOutBox,
  type Box,
} from "./floatDrop";

const DOCK = "dock-1";
const tab = { viewId: DOCK, groupId: "g1", panelId: "info" };
const group = { viewId: DOCK, groupId: "g1", panelId: null };

describe("floatTargetForDrop", () => {
  it("floats a tab dropped on the centre of a group's content", () =>
    expect(floatTargetForDrop({ kind: "content", position: "center", data: tab }, DOCK)).toEqual({
      type: "panel",
      panelId: "info",
    }));

  it("floats a whole group dragged by its header", () =>
    expect(floatTargetForDrop({ kind: "content", position: "center", data: group }, DOCK)).toEqual({
      type: "group",
      groupId: "g1",
    }));

  it.each(["left", "right", "top", "bottom"])(
    "floats on the %s edge too, rather than splitting the window's interior",
    (position) =>
      expect(floatTargetForDrop({ kind: "content", position, data: tab }, DOCK)).toEqual({
        type: "panel",
        panelId: "info",
      }),
  );

  it.each(["tab", "header_space", "edge"])("leaves %s drops to dockview", (kind) =>
    expect(floatTargetForDrop({ kind, position: "center", data: tab }, DOCK)).toBeNull(),
  );

  it("ignores foreign drags without dockview data", () =>
    expect(
      floatTargetForDrop({ kind: "content", position: "center", data: undefined }, DOCK),
    ).toBeNull());

  it("ignores drags from another dock instance", () =>
    expect(
      floatTargetForDrop({ kind: "content", position: "center", data: tab }, "other"),
    ).toBeNull());

  it("leaves tab-group chips to dockview", () =>
    expect(
      floatTargetForDrop(
        { kind: "content", position: "center", data: { ...group, tabGroupId: "tg" } },
        DOCK,
      ),
    ).toBeNull());
});

describe("floatBoxAt", () => {
  it("centres the window on the pointer with its tab bar under it", () =>
    expect(floatBoxAt(800, 400, 1600, 900)).toEqual({
      x: 800 - FLOAT_WIDTH / 2,
      y: 400 - FLOAT_GRAB_OFFSET,
      width: FLOAT_WIDTH,
      height: FLOAT_HEIGHT,
    }));

  it("keeps the window inside the left and top edges", () => {
    const box = floatBoxAt(5, 3, 1600, 900);
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
  });

  it("keeps the window inside the right and bottom edges", () => {
    const box = floatBoxAt(1599, 899, 1600, 900);
    expect(box.x + box.width).toBe(1600);
    expect(box.y + box.height).toBe(900);
  });

  it("shrinks the window in a small dock", () => {
    const box = floatBoxAt(200, 150, 400, 300);
    expect(box.width).toBe(320);
    expect(box.height).toBe(240);
    expect(box.x + box.width).toBeLessThanOrEqual(400);
  });

  it("never goes below a usable minimum", () => {
    const box = floatBoxAt(50, 50, 100, 100);
    expect(box.width).toBe(160);
    expect(box.x).toBe(0);
  });

  it("falls back to the corner for a non-finite pointer", () => {
    const box = floatBoxAt(Number.NaN, Number.NaN, 1600, 900);
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
  });
});

describe("desktopDropFor", () => {
  it("tears a stacked tab out where it was dropped", () =>
    expect(desktopDropFor({ data: tab, alone: false }, DOCK)).toEqual({
      type: "tear",
      panelId: "info",
    }));

  it("MOVES the window of a tab that is alone in it, rather than doing nothing", () =>
    expect(desktopDropFor({ data: tab, alone: true }, DOCK)).toEqual({
      type: "move",
      panelId: "info",
    }));

  it("leaves a whole-group drag to dockview: that is a window being moved", () =>
    expect(desktopDropFor({ data: group, alone: false }, DOCK)).toBeNull());

  it("leaves a whole-group drag alone even when that group holds one tab", () =>
    expect(desktopDropFor({ data: group, alone: true }, DOCK)).toBeNull());

  it("leaves tab-group chips to dockview, as a content drop does", () =>
    expect(desktopDropFor({ data: { ...tab, tabGroupId: "tg" }, alone: false }, DOCK)).toBeNull());

  it("ignores a foreign drag, so a file dropped on the desktop is not swallowed", () =>
    expect(desktopDropFor({ data: undefined, alone: false }, DOCK)).toBeNull());

  it("ignores a drag from another dock instance", () =>
    expect(desktopDropFor({ data: tab, alone: false }, "other")).toBeNull());
});

describe("tearOutBox", () => {
  const REMEMBERED = { x: 30, y: 40, width: 520, height: 300 };

  it("takes the default size for a tab that never had its own window", () =>
    expect(tearOutBox(null, 600, 500, 1200, 800)).toEqual(floatBoxAt(600, 500, 1200, 800)));

  it("lands under the pointer, at the size the tab's own window had", () =>
    expect(tearOutBox(REMEMBERED, 600, 500, 1200, 800)).toEqual({
      x: 600 - REMEMBERED.width / 2,
      y: 500 - FLOAT_GRAB_OFFSET,
      width: REMEMBERED.width,
      height: REMEMBERED.height,
    }));

  it("ignores where the remembered window used to be", () => {
    const far = tearOutBox(REMEMBERED, 900, 700, 1200, 800);
    expect(far.x).not.toBe(REMEMBERED.x);
    expect(far.y).not.toBe(REMEMBERED.y);
    expect(far.width).toBe(REMEMBERED.width);
  });

  it("keeps the torn-out window inside the desktop's edges", () => {
    const box = tearOutBox(REMEMBERED, 1199, 799, 1200, 800);
    expect(box.x + box.width).toBeLessThanOrEqual(1200);
    expect(box.y + box.height).toBeLessThanOrEqual(800);
    expect(tearOutBox(REMEMBERED, 0, 0, 1200, 800)).toMatchObject({ x: 0, y: 0 });
  });

  it("shrinks a remembered size into a desktop that has since shrunk", () => {
    const box = tearOutBox(REMEMBERED, 200, 130, 400, 260);
    expect(box.width).toBe(400);
    expect(box.width).toBeLessThanOrEqual(400);
    expect(box.height).toBeLessThanOrEqual(260);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
  });

  it("never comes back smaller than a window can be grabbed at", () => {
    const box = tearOutBox({ x: 0, y: 0, width: 4, height: 4 }, 600, 500, 1200, 800);
    expect(box.width).toBeGreaterThanOrEqual(160);
    expect(box.height).toBeGreaterThanOrEqual(160);
  });

  it("falls back to the corner for a non-finite pointer", () => {
    const box = tearOutBox(REMEMBERED, Number.NaN, Number.NaN, 1200, 800);
    expect(box).toMatchObject({ x: 0, y: 0, width: REMEMBERED.width });
  });

  it("does not mutate the box it remembered", () => {
    const remembered = { ...REMEMBERED };
    tearOutBox(remembered, 100, 100, 200, 200);
    expect(remembered).toEqual(REMEMBERED);
  });
});

describe("floatBoxAt with a preferred size", () => {
  it("honours a size the caller asks for", () =>
    expect(floatBoxAt(800, 400, 1600, 900, { width: 520, height: 300 })).toEqual({
      x: 800 - 260,
      y: 400 - FLOAT_GRAB_OFFSET,
      width: 520,
      height: 300,
    }));

  it("keeps a real window's size even past the share a fresh float is capped at", () =>
    expect(floatBoxAt(800, 400, 1000, 900, { width: 900, height: 860 })).toMatchObject({
      width: 900,
      height: 860,
    }));

  it("still shrinks a preferred size that will not fit the dock at all", () => {
    const box = floatBoxAt(200, 150, 400, 300, { width: 900, height: 700 });
    expect(box.width).toBe(400);
    expect(box.height).toBe(300);
  });
});

/*
 * The window a tab drop leaves behind, which the tab drag also has to know
 * *during* the drag: it is the box a window-to-window snap lines up, so the
 * hover and the drop must size it the same way or the shadow would promise one
 * box and the release deliver another.
 */
describe("landingBoxFor", () => {
  const REMEMBERED: Box = { x: 30, y: 40, width: 520, height: 300 };
  const CURRENT: Box = { x: 10, y: 20, width: 700, height: 500 };

  it("moves a lone tab's window at the size it has now", () =>
    expect(
      landingBoxFor("move", { current: CURRENT, remembered: REMEMBERED }, 600, 400, 1200, 800),
    ).toEqual(tearOutBox(CURRENT, 600, 400, 1200, 800)));

  it("tears a stacked tab out at the size its own window last had", () =>
    expect(
      landingBoxFor("tear", { current: CURRENT, remembered: REMEMBERED }, 600, 400, 1200, 800),
    ).toEqual(tearOutBox(REMEMBERED, 600, 400, 1200, 800)));

  it("tears a tab that never had a window out at the default size", () =>
    expect(
      landingBoxFor("tear", { current: CURRENT, remembered: null }, 600, 400, 1200, 800),
    ).toMatchObject({ width: FLOAT_WIDTH, height: FLOAT_HEIGHT }));
});
