import { describe, expect, it } from "vitest";
import { createModalStack, FOCUSABLE_SELECTOR, nextFocusIndex } from "./focus-trap";

describe("nextFocusIndex", () => {
  it("wraps Tab from the last element to the first", () => {
    expect(nextFocusIndex(3, 2, false)).toBe(0);
  });

  it("wraps Shift+Tab from the first element to the last", () => {
    expect(nextFocusIndex(3, 0, true)).toBe(2);
  });

  it("leaves moves inside the list to the browser", () => {
    expect(nextFocusIndex(3, 0, false)).toBeNull();
    expect(nextFocusIndex(3, 1, false)).toBeNull();
    expect(nextFocusIndex(3, 2, true)).toBeNull();
  });

  it("pulls focus that escaped the dialog back to the near edge", () => {
    expect(nextFocusIndex(3, -1, false)).toBe(0);
    expect(nextFocusIndex(3, -1, true)).toBe(2);
  });

  it("keeps a single element focused in both directions", () => {
    expect(nextFocusIndex(1, 0, false)).toBe(0);
    expect(nextFocusIndex(1, 0, true)).toBe(0);
  });

  it("has nowhere to go without focusable elements", () => {
    expect(nextFocusIndex(0, -1, false)).toBeNull();
  });
});

describe("FOCUSABLE_SELECTOR", () => {
  it("excludes script-only and disabled targets", () => {
    for (const part of FOCUSABLE_SELECTOR.split(",")) {
      expect(part).toContain(':not([tabindex="-1"])');
    }
    expect(FOCUSABLE_SELECTOR).toContain("button:not([disabled])");
  });
});

describe("createModalStack", () => {
  it("gives the keyboard to the newest dialog only", () => {
    const stack = createModalStack();
    const editor = Symbol("editor");
    const confirm = Symbol("confirm");

    stack.push(editor);
    expect(stack.isTop(editor)).toBe(true);

    stack.push(confirm);
    expect(stack.isTop(editor)).toBe(false);
    expect(stack.isTop(confirm)).toBe(true);

    stack.remove(confirm);
    expect(stack.isTop(editor)).toBe(true);
  });

  it("tolerates dialogs closing out of order and double registration", () => {
    const stack = createModalStack();
    const a = Symbol("a");
    const b = Symbol("b");
    stack.push(a);
    stack.push(b);
    stack.push(a); // re-shown: moves to the top instead of duplicating
    expect(stack.size()).toBe(2);
    expect(stack.isTop(a)).toBe(true);

    stack.remove(b);
    stack.remove(b);
    expect(stack.size()).toBe(1);
    expect(stack.isTop(a)).toBe(true);
  });
});
