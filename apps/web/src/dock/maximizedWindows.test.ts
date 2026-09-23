import { computed } from "vue";
import { describe, expect, it } from "vitest";
import { anyMaximized, publishWindowStates } from "./maximizedWindows";
import { NO_WINDOWS, setMaximized } from "./windowState";

/**
 * The channel `HeaderActions.vue` reads its own window's maximised state from.
 * No DOM and no component here: what matters is that a publish reaches a
 * `computed`, which is the whole reason this module exists.
 */

const BOX = { x: 10, y: 20, width: 300, height: 200 };

describe("anyMaximized", () => {
  it("says no for a desktop with nothing maximised", () => {
    publishWindowStates(NO_WINDOWS);
    expect(anyMaximized(["tree"])).toBe(false);
    expect(anyMaximized([])).toBe(false);
  });

  it("says yes for a window holding a maximised tab, and no for the others", () => {
    publishWindowStates(setMaximized(NO_WINDOWS, "tree", BOX));
    expect(anyMaximized(["tree"])).toBe(true);
    expect(anyMaximized(["chat", "tree"])).toBe(true);
    expect(anyMaximized(["chat"])).toBe(false);
  });

  it("re-runs a computed when the desktop publishes a new state", () => {
    publishWindowStates(NO_WINDOWS);
    const maximized = computed(() => anyMaximized(["tree"]));
    expect(maximized.value).toBe(false);
    publishWindowStates(setMaximized(NO_WINDOWS, "tree", BOX));
    expect(maximized.value).toBe(true);
    publishWindowStates(NO_WINDOWS);
    expect(maximized.value).toBe(false);
  });
});
