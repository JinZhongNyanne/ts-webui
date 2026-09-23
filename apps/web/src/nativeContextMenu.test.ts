import { describe, expect, it } from "vitest";
import { keepsNativeContextMenu } from "./nativeContextMenu";

describe("keepsNativeContextMenu", () => {
  it("keeps it for a textarea", () => {
    expect(keepsNativeContextMenu({ tagName: "TEXTAREA", isContentEditable: false })).toBe(true);
  });

  it("keeps it for text-ish input types", () => {
    for (const type of ["text", "search", "email", "url", "password", "number", "tel"]) {
      expect(
        keepsNativeContextMenu({ tagName: "INPUT", inputType: type, isContentEditable: false }),
      ).toBe(true);
    }
  });

  it("keeps it for an input with no explicit type (the DOM default is text)", () => {
    expect(keepsNativeContextMenu({ tagName: "INPUT", isContentEditable: false })).toBe(true);
  });

  it("drops it for non-textual input types", () => {
    for (const type of ["checkbox", "radio", "range", "button", "submit", "file", "color"]) {
      expect(
        keepsNativeContextMenu({ tagName: "INPUT", inputType: type, isContentEditable: false }),
      ).toBe(false);
    }
  });

  it("is case-insensitive on tag and type", () => {
    expect(
      keepsNativeContextMenu({ tagName: "input", inputType: "TEXT", isContentEditable: false }),
    ).toBe(true);
  });

  it("keeps it for a contenteditable element regardless of tag", () => {
    expect(keepsNativeContextMenu({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("drops it for a plain div, button, or anything else non-editable", () => {
    expect(keepsNativeContextMenu({ tagName: "DIV", isContentEditable: false })).toBe(false);
    expect(keepsNativeContextMenu({ tagName: "BUTTON", isContentEditable: false })).toBe(false);
    expect(keepsNativeContextMenu({ tagName: "SPAN", isContentEditable: false })).toBe(false);
  });
});
