import { describe, expect, it } from "vitest";
import { displayChannelName, isSpacer, parseSpacer, spacerFill } from "./format";

describe("parseSpacer", () => {
  it.each([
    ["[spacer]Lobby", "left", "Lobby"],
    ["[lspacer]Lobby", "left", "Lobby"],
    ["[cspacer]Lobby", "center", "Lobby"],
    ["[rspacer]Lobby", "right", "Lobby"],
    ["[*spacer]---", "repeat", "---"],
    ["[*cspacer]=", "repeat", "="],
    ["[cspacer1]Games", "center", "Games"],
    ["[rspacerABC]x", "right", "x"],
    ["[CSPACER]Upper", "center", "Upper"],
    ["[spacer]", "left", ""],
  ])("%s", (name, align, text) => {
    expect(parseSpacer(name, "0")).toEqual({ align, text });
  });

  it("only treats top-level channels as spacers", () => {
    expect(parseSpacer("[cspacer]Sub", "12")).toBeNull();
    expect(isSpacer("[cspacer]Sub", "12")).toBe(false);
    expect(displayChannelName("[cspacer]Sub", "12")).toBe("[cspacer]Sub");
  });

  it.each([
    "Lobby",
    "[spacer",
    "x[spacer]y",
    "[xspacer]a",
    "[**spacer]a",
    "[space]a",
    "[c*spacer]a",
  ])("ignores %s", (name) => {
    expect(parseSpacer(name)).toBeNull();
  });
});

describe("displayChannelName", () => {
  it("strips the prefix and trims aligned text", () => {
    expect(displayChannelName("[cspacer2]  Games  ")).toBe("Games");
  });

  it("keeps a repeat pattern intact, spaces included", () => {
    expect(displayChannelName("[*spacer] - ")).toBe(" - ");
  });

  it("leaves ordinary names alone", () => {
    expect(displayChannelName("  General ")).toBe("  General ");
  });
});

describe("spacerFill", () => {
  it("repeats until at least the requested length", () => {
    expect(spacerFill("-=", 7)).toBe("-=-=-=-=");
    expect(spacerFill("abc", 3)).toBe("abc");
  });

  it("is empty for an empty pattern", () => {
    expect(spacerFill("")).toBe("");
  });
});
