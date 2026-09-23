import { describe, expect, it } from "vitest";
import {
  floatBoxOf,
  forgetWindow,
  isMaximized,
  isMinimized,
  NO_WINDOWS,
  parseStates,
  pruneStates,
  rememberFloats,
  serializeStates,
  setMaximized,
  settleDrag,
  setMinimized,
  stateOf,
  toggleShowDesktop,
} from "./windowState";

const BOX = { x: 10, y: 20, width: 300, height: 200 };

describe("stateOf", () => {
  it("reports a window it has never seen as open and not maximised", () => {
    expect(stateOf(NO_WINDOWS, "tree")).toEqual({ minimized: false, restore: null, float: null });
  });
});

describe("setMinimized", () => {
  it("minimises a window without touching the map it was given", () => {
    const next = setMinimized(NO_WINDOWS, "tree", true);
    expect(isMinimized(next, "tree")).toBe(true);
    expect(isMinimized(NO_WINDOWS, "tree")).toBe(false);
  });

  it("restores it again", () => {
    const next = setMinimized(setMinimized(NO_WINDOWS, "tree", true), "tree", false);
    expect(isMinimized(next, "tree")).toBe(false);
  });

  it("keeps the maximised box across a minimise", () => {
    const max = setMaximized(NO_WINDOWS, "tree", BOX);
    const min = setMinimized(max, "tree", true);
    expect(isMaximized(min, "tree")).toBe(true);
    expect(stateOf(min, "tree").restore).toEqual(BOX);
  });

  it("leaves the other windows alone", () => {
    const both = setMinimized(setMinimized(NO_WINDOWS, "tree", true), "info", true);
    expect(isMinimized(both, "tree")).toBe(true);
    expect(isMinimized(both, "info")).toBe(true);
  });
});

describe("setMaximized", () => {
  it("remembers the box to restore to", () => {
    const next = setMaximized(NO_WINDOWS, "tree", BOX);
    expect(isMaximized(next, "tree")).toBe(true);
    expect(stateOf(next, "tree").restore).toEqual(BOX);
  });

  it("un-maximises with null", () => {
    const next = setMaximized(setMaximized(NO_WINDOWS, "tree", BOX), "tree", null);
    expect(isMaximized(next, "tree")).toBe(false);
    expect(stateOf(next, "tree").restore).toBeNull();
  });
});

describe("forgetWindow and pruneStates", () => {
  it("forgets a closed window", () => {
    const next = forgetWindow(setMinimized(NO_WINDOWS, "tree", true), "tree");
    expect(isMinimized(next, "tree")).toBe(false);
  });

  it("drops the state of windows that are no longer in the layout", () => {
    const states = setMinimized(setMinimized(NO_WINDOWS, "tree", true), "info", true);
    const next = pruneStates(states, ["tree"]);
    expect(isMinimized(next, "tree")).toBe(true);
    expect(Object.keys(next)).toEqual(["tree"]);
  });
});

describe("parseStates and serializeStates", () => {
  it("round-trips", () => {
    const states = setMaximized(setMinimized(NO_WINDOWS, "info", true), "tree", BOX);
    expect(parseStates(serializeStates(states))).toEqual(states);
  });

  it("treats nothing saved as nothing minimised", () => {
    expect(parseStates(null)).toEqual(NO_WINDOWS);
    expect(parseStates("")).toEqual(NO_WINDOWS);
  });

  it("survives junk rather than wedging the desktop", () => {
    expect(parseStates("not json")).toEqual(NO_WINDOWS);
    expect(parseStates("[1,2,3]")).toEqual(NO_WINDOWS);
    expect(parseStates('{"tree":"yes"}')).toEqual(NO_WINDOWS);
  });

  it("drops an entry whose restore box is not a box", () => {
    const parsed = parseStates('{"tree":{"minimized":true,"restore":{"x":1}}}');
    expect(isMinimized(parsed, "tree")).toBe(true);
    expect(stateOf(parsed, "tree").restore).toBeNull();
  });
});

describe("toggleShowDesktop", () => {
  const OPEN_THREE = ["tree", "sounds", "files"];

  it("minimises every showing window and says which ones it moved", () => {
    const result = toggleShowDesktop(NO_WINDOWS, OPEN_THREE, []);

    for (const id of OPEN_THREE) expect(isMinimized(result.states, id)).toBe(true);
    expect(result.minimized).toEqual(OPEN_THREE);
    expect(NO_WINDOWS).toEqual({});
  });

  it("minimises the rest while one window is already away", () => {
    const states = setMinimized(NO_WINDOWS, "sounds", true);

    const result = toggleShowDesktop(states, OPEN_THREE, []);

    expect(result.minimized).toEqual(["tree", "files"]);
    expect(isMinimized(result.states, "sounds")).toBe(true);
    expect(isMinimized(states, "tree")).toBe(false);
  });

  it("brings back exactly the windows it put away", () => {
    const away = toggleShowDesktop(NO_WINDOWS, OPEN_THREE, []);

    const back = toggleShowDesktop(away.states, OPEN_THREE, away.minimized);

    for (const id of OPEN_THREE) expect(isMinimized(back.states, id)).toBe(false);
    expect(back.minimized).toEqual([]);
  });

  it("leaves a window the user minimised themselves minimised", () => {
    const byUser = setMinimized(NO_WINDOWS, "sounds", true);
    const away = toggleShowDesktop(byUser, OPEN_THREE, []);

    const back = toggleShowDesktop(away.states, OPEN_THREE, away.minimized);

    expect(isMinimized(back.states, "sounds")).toBe(true);
    expect(isMinimized(back.states, "tree")).toBe(false);
    expect(isMinimized(back.states, "files")).toBe(false);
  });

  it("forgets a remembered window that has since been closed", () => {
    const away = toggleShowDesktop(NO_WINDOWS, OPEN_THREE, []);
    const closed = forgetWindow(away.states, "files");

    const back = toggleShowDesktop(closed, ["tree", "sounds"], away.minimized);

    expect(isMinimized(back.states, "tree")).toBe(false);
    expect(stateOf(back.states, "files")).toEqual({ minimized: false, restore: null, float: null });
  });

  it("does nothing on an empty desktop", () => {
    const result = toggleShowDesktop(NO_WINDOWS, [], []);

    expect(result.states).toEqual({});
    expect(result.minimized).toEqual([]);
  });

  it("keeps a maximised window's restore box across the round trip", () => {
    const max = setMaximized(NO_WINDOWS, "tree", BOX);
    const away = toggleShowDesktop(max, ["tree"], []);
    const back = toggleShowDesktop(away.states, ["tree"], away.minimized);

    expect(isMaximized(back.states, "tree")).toBe(true);
    expect(stateOf(back.states, "tree").restore).toEqual(BOX);
  });
});

describe("rememberFloats", () => {
  it("remembers the box of a window that is its own", () => {
    const next = rememberFloats(NO_WINDOWS, [{ panelId: "tree", box: BOX }]);
    expect(floatBoxOf(next, "tree")).toEqual(BOX);
    expect(floatBoxOf(NO_WINDOWS, "tree")).toBeNull();
  });

  it("keeps the box a stacked tab had before it was stacked", () => {
    const had = rememberFloats(NO_WINDOWS, [{ panelId: "tree", box: BOX }]);
    const stacked = rememberFloats(had, [{ panelId: "tree", box: null }]);
    expect(floatBoxOf(stacked, "tree")).toEqual(BOX);
  });

  it("follows a window that has moved", () => {
    const moved = { ...BOX, x: 400 };
    const next = rememberFloats(rememberFloats(NO_WINDOWS, [{ panelId: "tree", box: BOX }]), [
      { panelId: "tree", box: moved },
    ]);
    expect(floatBoxOf(next, "tree")).toEqual(moved);
  });

  it("returns the very same map when nothing moved", () => {
    const had = rememberFloats(NO_WINDOWS, [{ panelId: "tree", box: BOX }]);
    expect(rememberFloats(had, [{ panelId: "tree", box: { ...BOX } }])).toBe(had);
  });

  it("keeps the minimised and maximised state of the window it records", () => {
    const busy = setMaximized(setMinimized(NO_WINDOWS, "tree", true), "tree", BOX);
    const next = rememberFloats(busy, [{ panelId: "tree", box: { ...BOX, y: 99 } }]);
    expect(isMinimized(next, "tree")).toBe(true);
    expect(isMaximized(next, "tree")).toBe(true);
  });

  it("records several windows at once and leaves the others alone", () => {
    const next = rememberFloats(NO_WINDOWS, [
      { panelId: "tree", box: BOX },
      { panelId: "info", box: null },
    ]);
    expect(floatBoxOf(next, "tree")).toEqual(BOX);
    expect(floatBoxOf(next, "info")).toBeNull();
  });

  it("survives a save and a reload", () => {
    const next = rememberFloats(NO_WINDOWS, [{ panelId: "tree", box: BOX }]);
    expect(floatBoxOf(parseStates(serializeStates(next)), "tree")).toEqual(BOX);
  });

  it("reads a state saved before boxes were remembered as having none", () => {
    const old = parseStates(JSON.stringify({ tree: { minimized: true, restore: null } }));
    expect(floatBoxOf(old, "tree")).toBeNull();
    expect(isMinimized(old, "tree")).toBe(true);
  });

  it("is forgotten with the window it belongs to", () => {
    const next = rememberFloats(NO_WINDOWS, [{ panelId: "tree", box: BOX }]);
    expect(floatBoxOf(forgetWindow(next, "tree"), "tree")).toBeNull();
    expect(floatBoxOf(pruneStates(next, ["info"]), "tree")).toBeNull();
  });
});

describe("settleDrag", () => {
  const DESKTOP = { width: 1000, height: 700 };
  const FULL = { x: 0, y: 0, width: 1000, height: 700 };
  const HALF = { x: 0, y: 0, width: 500, height: 700 };

  it("maximises a window a drag filled the desktop with, remembering where it was", () => {
    const next = settleDrag(NO_WINDOWS, "tree", { box: FULL, desktop: DESKTOP, before: BOX });
    expect(isMaximized(next, "tree")).toBe(true);
    expect(stateOf(next, "tree").restore).toEqual(BOX);
    expect(isMaximized(NO_WINDOWS, "tree")).toBe(false);
  });

  it("keeps the box it already had when a maximised window is dropped on the top again", () => {
    const max = setMaximized(NO_WINDOWS, "tree", BOX);
    const next = settleDrag(max, "tree", { box: FULL, desktop: DESKTOP, before: FULL });
    expect(stateOf(next, "tree").restore).toEqual(BOX);
  });

  it("refuses to maximise with no box to come back to", () => {
    const next = settleDrag(NO_WINDOWS, "tree", { box: FULL, desktop: DESKTOP, before: null });
    expect(isMaximized(next, "tree")).toBe(false);
  });

  it("refuses to maximise when the window already filled the desktop before the drag", () => {
    const next = settleDrag(NO_WINDOWS, "tree", { box: FULL, desktop: DESKTOP, before: FULL });
    expect(isMaximized(next, "tree")).toBe(false);
  });

  it("leaves a half snap un-maximised, so its own box is what maximise remembers", () => {
    const next = settleDrag(NO_WINDOWS, "tree", { box: HALF, desktop: DESKTOP, before: BOX });
    expect(isMaximized(next, "tree")).toBe(false);
  });

  it("drops the maximised flag when a maximised window is dragged off the top", () => {
    const max = setMaximized(NO_WINDOWS, "tree", BOX);
    const next = settleDrag(max, "tree", { box: HALF, desktop: DESKTOP, before: FULL });
    expect(isMaximized(next, "tree")).toBe(false);
  });

  it("changes nothing when a maximised window is put back exactly where it was", () => {
    const max = setMaximized(NO_WINDOWS, "tree", BOX);
    expect(settleDrag(max, "tree", { box: FULL, desktop: DESKTOP, before: FULL })).toBe(max);
  });

  it("keeps the rest of the window's state", () => {
    const busy = rememberFloats(setMinimized(NO_WINDOWS, "tree", true), [
      { panelId: "tree", box: BOX },
    ]);
    const next = settleDrag(busy, "tree", { box: FULL, desktop: DESKTOP, before: BOX });
    expect(isMinimized(next, "tree")).toBe(true);
    expect(floatBoxOf(next, "tree")).toEqual(BOX);
  });

  it("leaves every other window alone", () => {
    const next = settleDrag(setMaximized(NO_WINDOWS, "info", BOX), "tree", {
      box: HALF,
      desktop: DESKTOP,
      before: BOX,
    });
    expect(isMaximized(next, "info")).toBe(true);
  });
});
