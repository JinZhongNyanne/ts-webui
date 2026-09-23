import { describe, expect, it } from "vitest";
import { wrapSelection } from "./bbcode-edit";

describe("wrapSelection", () => {
  it("wraps the selected text and keeps it selected", () => {
    expect(wrapSelection("say hello now", 4, 9, "[b]", "[/b]")).toEqual({
      text: "say [b]hello[/b] now",
      start: 7,
      end: 12,
    });
  });

  it("inserts an empty pair with the caret inside when nothing is selected", () => {
    expect(wrapSelection("ab", 1, 1, "[i]", "[/i]")).toEqual({
      text: "a[i][/i]b",
      start: 4,
      end: 4,
    });
  });

  it("clamps and orders out-of-range positions", () => {
    expect(wrapSelection("ab", 5, 0, "[u]", "[/u]")).toEqual({
      text: "[u]ab[/u]",
      start: 3,
      end: 5,
    });
  });
});
