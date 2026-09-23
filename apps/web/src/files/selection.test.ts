import { describe, expect, it } from "vitest";
import { clickSelect, pruneSelection } from "./selection";

const order = ["a", "b", "c", "d"];
const sel = (...names: string[]) => ({ names: new Set(names), anchor: names.at(-1) ?? null });

describe("clickSelect", () => {
  it("a plain click selects just that entry and makes it the anchor", () =>
    expect(clickSelect(sel("a", "b"), order, "c", {})).toEqual({
      names: new Set(["c"]),
      anchor: "c",
    }));

  it("ctrl / cmd toggles one entry", () => {
    expect(clickSelect(sel("a"), order, "c", { toggle: true })).toEqual({
      names: new Set(["a", "c"]),
      anchor: "c",
    });
    expect(clickSelect(sel("a", "c"), order, "a", { toggle: true }).names).toEqual(new Set(["c"]));
  });

  it("shift selects the range from the anchor, either way", () => {
    expect(clickSelect(sel("b"), order, "d", { range: true }).names).toEqual(
      new Set(["b", "c", "d"]),
    );
    expect(clickSelect(sel("c"), order, "a", { range: true }).names).toEqual(
      new Set(["a", "b", "c"]),
    );
  });

  it("shift without an anchor selects just that entry", () =>
    expect(clickSelect({ names: new Set(), anchor: null }, order, "b", { range: true })).toEqual({
      names: new Set(["b"]),
      anchor: "b",
    }));

  it("keeps the anchor through a range, so it can be extended again", () =>
    expect(clickSelect(sel("b"), order, "d", { range: true }).anchor).toBe("b"));

  it("does not change the selection it was given", () => {
    const before = sel("a");
    clickSelect(before, order, "c", { toggle: true });
    expect(before.names).toEqual(new Set(["a"]));
  });
});

describe("pruneSelection", () => {
  it("drops names that are no longer listed", () =>
    expect(pruneSelection(sel("a", "x"), order)).toEqual({ names: new Set(["a"]), anchor: null }));
  it("keeps an anchor that is still listed", () =>
    expect(pruneSelection(sel("x", "a"), order)).toEqual({ names: new Set(["a"]), anchor: "a" }));
});
