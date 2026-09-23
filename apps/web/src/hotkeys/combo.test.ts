import { describe, expect, it } from "vitest";
import {
  comboFromKey,
  comboFromMouse,
  comboLabel,
  findConflicts,
  formatCombo,
  isTypingTarget,
  matchesPress,
  matchesRelease,
  parseCombo,
  type KeyLike,
  type MouseLike,
} from "./combo";

const NO_MODS = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
const key = (code: string, mods: Partial<typeof NO_MODS> = {}): KeyLike => ({
  code,
  ...NO_MODS,
  ...mods,
});
const mouse = (button: number, mods: Partial<typeof NO_MODS> = {}): MouseLike => ({
  button,
  ...NO_MODS,
  ...mods,
});

function combo(text: string) {
  const c = parseCombo(text);
  if (!c) throw new Error(`bad combo ${text}`);
  return c;
}

describe("parseCombo / formatCombo", () => {
  it("round-trips in canonical modifier order", () => {
    expect(formatCombo(combo("Shift+Ctrl+KeyM"))).toBe("Ctrl+Shift+KeyM");
    expect(formatCombo(combo("KeyV"))).toBe("KeyV");
    expect(formatCombo(combo("Alt+Mouse4"))).toBe("Alt+Mouse4");
  });

  it("accepts a bare modifier key, the old PTT format", () => {
    expect(combo("ControlLeft").mods.size).toBe(0);
  });

  it("rejects unbound and malformed combos", () => {
    expect(parseCombo("")).toBeNull();
    expect(parseCombo("Ctrl+")).toBeNull();
    expect(parseCombo("Hyper+KeyA")).toBeNull();
    expect(parseCombo("Ctrl+Ctrl+KeyA")).toBeNull();
    expect(parseCombo("Shift+ControlLeft")).toBeNull();
  });
});

describe("recording", () => {
  it("builds a combo from a key press with modifiers", () => {
    expect(formatCombo(comboFromKey(key("KeyM", { ctrlKey: true, shiftKey: true })))).toBe(
      "Ctrl+Shift+KeyM",
    );
  });

  it("records a modifier key on its own without its own flag", () => {
    expect(formatCombo(comboFromKey(key("ControlLeft", { ctrlKey: true })))).toBe("ControlLeft");
  });

  it("takes middle and side mouse buttons but never left/right click", () => {
    expect(formatCombo(comboFromMouse(mouse(3))!)).toBe("Mouse4");
    expect(formatCombo(comboFromMouse(mouse(4, { ctrlKey: true }))!)).toBe("Ctrl+Mouse5");
    expect(formatCombo(comboFromMouse(mouse(1))!)).toBe("Mouse3");
    expect(comboFromMouse(mouse(0))).toBeNull();
    expect(comboFromMouse(mouse(2))).toBeNull();
  });
});

describe("matching", () => {
  it("is exact by default", () => {
    const m = combo("Ctrl+KeyM");
    expect(matchesPress(m, key("KeyM", { ctrlKey: true }))).toBe(true);
    expect(matchesPress(m, key("KeyM"))).toBe(false);
    expect(matchesPress(m, key("KeyM", { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(matchesPress(combo("KeyM"), key("KeyM", { ctrlKey: true }))).toBe(false);
  });

  it("lets extra modifiers through when loose (push-to-talk)", () => {
    expect(matchesPress(combo("KeyV"), key("KeyV", { shiftKey: true }), true)).toBe(true);
    expect(matchesPress(combo("Ctrl+KeyV"), key("KeyV"), true)).toBe(false);
  });

  it("matches a bare modifier binding while it is held", () => {
    expect(matchesPress(combo("ControlLeft"), key("ControlLeft", { ctrlKey: true }))).toBe(true);
    expect(matchesPress(combo("ControlLeft"), key("ControlRight", { ctrlKey: true }))).toBe(false);
  });

  it("matches mouse buttons", () => {
    expect(matchesPress(combo("Mouse4"), mouse(3))).toBe(true);
    expect(matchesPress(combo("Mouse4"), mouse(4))).toBe(false);
    expect(matchesPress(combo("Mouse4"), key("Mouse4"))).toBe(true); // names are names
  });

  it("releases on the main key even if a modifier went first", () => {
    expect(matchesRelease(combo("Ctrl+KeyV"), key("KeyV"))).toBe(true);
    expect(matchesRelease(combo("Ctrl+KeyV"), key("ControlLeft"))).toBe(false);
    expect(matchesRelease(combo("Mouse5"), mouse(4))).toBe(true);
  });
});

describe("labels", () => {
  it("reads like a keyboard", () => {
    expect(comboLabel(combo("Ctrl+Shift+KeyM"))).toBe("Ctrl + Shift + M");
    expect(comboLabel(combo("Digit1"))).toBe("1");
    expect(comboLabel(combo("ControlLeft"))).toBe("Left Ctrl");
    expect(comboLabel(combo("Mouse4"))).toBe("Mouse 4");
    expect(comboLabel(combo("F13"))).toBe("F13");
  });
});

describe("findConflicts", () => {
  it("flags identical bindings", () => {
    expect(
      findConflicts([
        { action: "a", combo: "Ctrl+KeyM" },
        { action: "b", combo: "Ctrl+KeyM" },
        { action: "c", combo: "KeyM" },
      ]),
    ).toEqual([{ a: "a", b: "b" }]);
  });

  it("flags a loose binding shadowing a combo with more modifiers", () => {
    const specs = [
      { action: "ptt", combo: "KeyV", loose: true },
      { action: "mute", combo: "Ctrl+KeyV" },
    ];
    expect(findConflicts(specs)).toEqual([{ a: "ptt", b: "mute" }]);
    // Exact bindings with different modifiers are fine together.
    expect(findConflicts(specs.map((s) => ({ ...s, loose: false })))).toEqual([]);
  });

  it("ignores unbound actions and different keys", () => {
    expect(
      findConflicts([
        { action: "a", combo: "" },
        { action: "b", combo: "" },
        { action: "c", combo: "Mouse4" },
        { action: "d", combo: "Mouse5" },
      ]),
    ).toEqual([]);
  });
});

describe("isTypingTarget", () => {
  it("counts text fields and editable content", () => {
    expect(isTypingTarget({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(isTypingTarget({ tagName: "input" })).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("does not count buttons, sliders, checkboxes or nothing", () => {
    expect(isTypingTarget({ tagName: "INPUT", type: "range" })).toBe(false);
    expect(isTypingTarget({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
