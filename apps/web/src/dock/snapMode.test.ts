import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SNAP_TO_EDGES,
  DEFAULT_SNAP_TO_WINDOWS,
  SNAP_EDGES_KEY,
  SNAP_WINDOWS_KEY,
  loadSnapToEdges,
  loadSnapToWindows,
  saveSnapToEdges,
  saveSnapToWindows,
  setSnapToEdges,
  setSnapToWindows,
  snapToEdges,
  snapToWindows,
} from "./snapMode";

/** A storage that works, starting from whatever is already in it. */
function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    read: () => Object.fromEntries(store),
  };
}

/** A storage that refuses everything, as a private window's can. */
const brokenStorage = {
  getItem(): string | null {
    throw new Error("blocked");
  },
  setItem(): void {
    throw new Error("blocked");
  },
};

afterEach(() => {
  setSnapToEdges(DEFAULT_SNAP_TO_EDGES);
  setSnapToWindows(DEFAULT_SNAP_TO_WINDOWS);
});

describe("the defaults", () => {
  it("leaves screen-edge snapping off, so a window goes where it is dropped until asked", () => {
    expect(DEFAULT_SNAP_TO_EDGES).toBe(false);
    expect(loadSnapToEdges(fakeStorage())).toBe(false);
  });

  it("turns window-to-window snapping on, so windows line up with each other from the start", () => {
    expect(DEFAULT_SNAP_TO_WINDOWS).toBe(true);
    expect(loadSnapToWindows(fakeStorage())).toBe(true);
  });

  // The defaults moved; a choice somebody already made did not. Anyone who
  // flipped either switch before keeps what they flipped it to.
  it("keeps a choice saved under the old defaults", () => {
    const storage = fakeStorage({ [SNAP_EDGES_KEY]: "true", [SNAP_WINDOWS_KEY]: "false" });
    expect(loadSnapToEdges(storage)).toBe(true);
    expect(loadSnapToWindows(storage)).toBe(false);
  });
});

describe("loading a saved choice", () => {
  it("reads each switch back from its own key", () => {
    const storage = fakeStorage({ [SNAP_EDGES_KEY]: "true", [SNAP_WINDOWS_KEY]: "false" });
    expect(loadSnapToEdges(storage)).toBe(true);
    expect(loadSnapToWindows(storage)).toBe(false);
  });

  it("keeps the two switches in separate keys", () => {
    expect(SNAP_EDGES_KEY).not.toBe(SNAP_WINDOWS_KEY);
  });

  it("falls back to the default for anything it did not write", () => {
    expect(loadSnapToEdges(fakeStorage({ [SNAP_EDGES_KEY]: "yes please" }))).toBe(false);
    expect(loadSnapToWindows(fakeStorage({ [SNAP_WINDOWS_KEY]: "" }))).toBe(true);
  });

  it("falls back to the defaults when storage itself refuses", () => {
    expect(loadSnapToEdges(brokenStorage)).toBe(false);
    expect(loadSnapToWindows(brokenStorage)).toBe(true);
  });
});

describe("saving a choice", () => {
  it("writes each flag as the one it reads back", () => {
    const storage = fakeStorage();
    saveSnapToEdges(true, storage);
    saveSnapToWindows(false, storage);
    expect(storage.read()[SNAP_EDGES_KEY]).toBe("true");
    expect(storage.read()[SNAP_WINDOWS_KEY]).toBe("false");
    expect(loadSnapToEdges(storage)).toBe(true);
    expect(loadSnapToWindows(storage)).toBe(false);
  });

  it("swallows a storage refusal, so the choice still holds for this session", () => {
    expect(() => saveSnapToEdges(false, brokenStorage)).not.toThrow();
    expect(() => saveSnapToWindows(true, brokenStorage)).not.toThrow();
  });
});

describe("the published preferences", () => {
  it("start at their defaults", () => {
    expect(snapToEdges()).toBe(DEFAULT_SNAP_TO_EDGES);
    expect(snapToWindows()).toBe(DEFAULT_SNAP_TO_WINDOWS);
  });

  it("report what was last set, each without touching the other", () => {
    setSnapToEdges(true);
    expect(snapToEdges()).toBe(true);
    expect(snapToWindows()).toBe(true);
    setSnapToWindows(false);
    expect(snapToWindows()).toBe(false);
    expect(snapToEdges()).toBe(true);
  });
});
