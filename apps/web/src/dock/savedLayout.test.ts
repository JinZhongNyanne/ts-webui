import { describe, expect, it } from "vitest";
import { withoutPanelRenderers } from "./savedLayout";

const SAVED = {
  grid: { root: { type: "branch", data: [] }, width: 800, height: 600, orientation: "HORIZONTAL" },
  panels: {
    tree: { id: "tree", contentComponent: "tree", title: "Channels", renderer: "onlyWhenVisible" },
    info: { id: "info", contentComponent: "info", title: "Info", renderer: "onlyWhenVisible" },
  },
  floatingGroups: [{ data: { views: ["tree"] }, position: { top: 10, left: 20 } }],
};

describe("withoutPanelRenderers", () => {
  it("drops the renderer an older build pinned on every panel", () => {
    const next = withoutPanelRenderers(SAVED) as typeof SAVED;
    expect(next.panels.tree).not.toHaveProperty("renderer");
    expect(next.panels.info).not.toHaveProperty("renderer");
  });

  it("keeps everything else about the panel", () => {
    const next = withoutPanelRenderers(SAVED) as typeof SAVED;
    expect(next.panels.tree).toEqual({
      id: "tree",
      contentComponent: "tree",
      title: "Channels",
    });
  });

  it("keeps the grid and the floating windows untouched", () => {
    const next = withoutPanelRenderers(SAVED) as typeof SAVED;
    expect(next.grid).toEqual(SAVED.grid);
    expect(next.floatingGroups).toEqual(SAVED.floatingGroups);
  });

  it("does not mutate the layout it was given", () => {
    const before = JSON.stringify(SAVED);
    withoutPanelRenderers(SAVED);
    expect(JSON.stringify(SAVED)).toBe(before);
  });

  it("leaves a layout that never had one alone", () => {
    const plain = { panels: { tree: { id: "tree" } } };
    expect(withoutPanelRenderers(plain)).toEqual(plain);
  });

  it("hands anything that is not a layout straight back", () => {
    expect(withoutPanelRenderers(null)).toBeNull();
    expect(withoutPanelRenderers("nonsense")).toBe("nonsense");
    expect(withoutPanelRenderers([1, 2])).toEqual([1, 2]);
    expect(withoutPanelRenderers({ panels: 7 })).toEqual({ panels: 7 });
  });

  it("passes a panel entry that is not an object through as it is", () => {
    expect(withoutPanelRenderers({ panels: { tree: null } })).toEqual({ panels: { tree: null } });
  });
});
