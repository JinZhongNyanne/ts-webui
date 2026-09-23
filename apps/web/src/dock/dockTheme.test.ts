import { describe, expect, it } from "vitest";
import { themeAbyss } from "dockview-vue";
import { DOCK_THEME } from "./dockTheme";

describe("DOCK_THEME", () => {
  it("animates tab reorder the way a browser tab strip does", () => {
    expect(DOCK_THEME.tabAnimation).toBe("smooth");
  });

  it("keeps every other field of the abyss theme, the class name above all", () => {
    expect(DOCK_THEME).toEqual({ ...themeAbyss, tabAnimation: "smooth" });
    expect(DOCK_THEME.className).toBe("dockview-theme-abyss");
    expect(DOCK_THEME.tabGroupIndicator).toBe("none");
  });

  it("leaves the imported theme alone", () => {
    expect(themeAbyss.tabAnimation).toBeUndefined();
  });
});
