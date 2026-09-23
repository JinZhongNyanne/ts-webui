import { describe, expect, it } from "vitest";
import { maximizeTargetFor } from "./titleBarMaximize";

/** A double-click in the tab bar of the window whose front tab is `sounds`. */
const inTitleBar = { inTitleBar: true, onControl: false, panelId: "sounds" };

describe("maximizeTargetFor", () => {
  it("maximises the window whose tab bar was double-clicked", () => {
    expect(maximizeTargetFor(inTitleBar)).toBe("sounds");
  });

  it("ignores a double-click anywhere but a tab bar", () => {
    // A window's contents: the panel decides what a double-click there means.
    expect(maximizeTargetFor({ ...inTitleBar, inTitleBar: false })).toBeNull();
  });

  it("ignores a double-click on a control that already has a meaning", () => {
    // A tab's close "X" and the window's own minimise / maximise / close
    // buttons sit inside the tab bar; two quick clicks on one of those is two
    // presses of that button, not a request to maximise.
    expect(maximizeTargetFor({ ...inTitleBar, onControl: true })).toBeNull();
  });

  it("does nothing when the window could not be resolved", () => {
    expect(maximizeTargetFor({ ...inTitleBar, panelId: null })).toBeNull();
  });
});
