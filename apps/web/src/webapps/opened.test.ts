import { describe, expect, it } from "vitest";
import { EMPTY_OPENED, closeSite, openSite, parseOpened, pruneOpened } from "./opened";

describe("openSite", () => {
  it("adds a tab and shows it", () => {
    const s = openSite(openSite(EMPTY_OPENED, "a"), "b");
    expect(s).toEqual({ ids: ["a", "b"], active: "b" });
  });
  it("re-shows an open tab without duplicating it", () =>
    expect(openSite({ ids: ["a", "b"], active: "b" }, "a")).toEqual({
      ids: ["a", "b"],
      active: "a",
    }));
});

describe("closeSite", () => {
  it("hands the view to the tab on the left", () =>
    expect(closeSite({ ids: ["a", "b", "c"], active: "b" }, "b")).toEqual({
      ids: ["a", "c"],
      active: "a",
    }));
  it("hands it to the right when the first tab closes", () =>
    expect(closeSite({ ids: ["a", "b"], active: "a" }, "a")).toEqual({ ids: ["b"], active: "b" }));
  it("keeps the showing tab when another closes", () =>
    expect(closeSite({ ids: ["a", "b"], active: "a" }, "b")).toEqual({ ids: ["a"], active: "a" }));
  it("ends with nothing showing", () =>
    expect(closeSite({ ids: ["a"], active: "a" }, "a")).toEqual(EMPTY_OPENED));
});

describe("pruneOpened", () => {
  it("closes tabs of sites someone removed", () =>
    expect(pruneOpened({ ids: ["a", "b", "c"], active: "b" }, new Set(["a", "c"]))).toEqual({
      ids: ["a", "c"],
      active: "a",
    }));
});

describe("parseOpened", () => {
  it("keeps a valid saved state", () =>
    expect(parseOpened({ ids: ["a", "b"], active: "b" })).toEqual({
      ids: ["a", "b"],
      active: "b",
    }));
  it("repairs junk", () => {
    expect(parseOpened(null)).toEqual(EMPTY_OPENED);
    expect(parseOpened({ ids: ["a", 3, "a", ""], active: "zz" })).toEqual({
      ids: ["a"],
      active: null,
    });
  });
});
