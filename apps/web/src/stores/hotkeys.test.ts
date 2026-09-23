import { describe, expect, it } from "vitest";
import { HOLD_ACTIONS, HOTKEY_ACTIONS, hotkeyConflicts, type HotkeyAction } from "./hotkeys";

const unbound: Record<HotkeyAction, string> = {
  ptt: "",
  toggleMic: "",
  toggleSpeakers: "",
  toggleAway: "",
  whisper: "",
};

describe("the whisper hotkey", () => {
  it("is a bindable action, held like push to talk", () => {
    expect(HOTKEY_ACTIONS).toContain("whisper");
    expect(HOLD_ACTIONS.has("whisper")).toBe(true);
  });

  it("conflicts with push to talk on the same key", () => {
    expect(hotkeyConflicts({ ...unbound, ptt: "KeyV", whisper: "KeyV" })).toEqual([
      { a: "ptt", b: "whisper" },
    ]);
  });

  it("conflicts with a loose push to talk it adds a modifier to", () => {
    // Push to talk on V also fires for Shift+V, so both would go down together.
    expect(hotkeyConflicts({ ...unbound, ptt: "KeyV", whisper: "Shift+KeyV" })).toEqual([
      { a: "ptt", b: "whisper" },
    ]);
  });

  it("does not conflict on a key of its own", () => {
    expect(hotkeyConflicts({ ...unbound, ptt: "KeyV", whisper: "KeyB" })).toEqual([]);
  });

  it("conflicts with a toggle on the same press", () => {
    expect(hotkeyConflicts({ ...unbound, toggleMic: "KeyM", whisper: "KeyM" })).toEqual([
      { a: "toggleMic", b: "whisper" },
    ]);
  });
});
