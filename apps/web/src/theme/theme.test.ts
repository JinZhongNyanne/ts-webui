import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  MAX_CUSTOM_CSS,
  PRESETS,
  backgroundCss,
  mixHex,
  normalizeTheme,
  overriddenVariables,
  themeToCss,
  themeVariables,
  type Theme,
} from "./theme";

const withBg = (bg: Partial<Theme["background"]>): Theme => ({
  ...DEFAULT_THEME,
  background: { ...DEFAULT_THEME.background, ...bg },
});

describe("mixHex", () => {
  it("returns the first colour at 0 and the second at 1", () => {
    expect(mixHex("#102030", "#ffffff", 0)).toEqual([16, 32, 48]);
    expect(mixHex("#102030", "#ffffff", 1)).toEqual([255, 255, 255]);
  });

  it("accepts the three-digit shorthand", () =>
    expect(mixHex("#fff", "#000", 0.5)).toEqual([128, 128, 128]));
});

describe("backgroundCss", () => {
  it("is the plain colour for a solid background", () =>
    expect(backgroundCss(withBg({ kind: "solid", color: "#123456" }).background)).toBe("#123456"));

  it("builds a linear gradient at the chosen angle", () =>
    expect(
      backgroundCss(
        withBg({ kind: "linear", angle: 90, stops: ["#000000", "#ffffff"] }).background,
      ),
    ).toBe("linear-gradient(90deg, #000000, #ffffff)"));

  it("builds a radial gradient from the top", () =>
    expect(
      backgroundCss(
        withBg({ kind: "radial", stops: ["#111111", "#222222", "#333333"] }).background,
      ),
    ).toBe("radial-gradient(ellipse at top, #111111, #222222, #333333)"));
});

describe("themeVariables", () => {
  it("keeps the stock palette for the default theme", () => {
    const vars = themeVariables(DEFAULT_THEME);
    expect(vars["--bg"]).toBe("rgba(15, 17, 21, 1)");
    expect(vars["--bg-elev"]).toBe("rgba(23, 26, 33, 1)");
    expect(vars["--app-bg"]).toBe("#0f1115");
    expect(vars["--accent"]).toBe("#4f8cff");
  });

  it("makes the surfaces translucent with the chosen opacity", () => {
    const vars = themeVariables({ ...DEFAULT_THEME, surface: { color: "#000000", opacity: 0.5 } });
    expect(vars["--bg-elev"]).toBe("rgba(0, 0, 0, 0.5)");
  });

  it("keeps the stock text colours on a dark surface", () => {
    const vars = themeVariables(DEFAULT_THEME);
    expect(vars["--text"]).toBe("#e6e8ee");
    expect(vars["--text-dim"]).toBe("#9aa3b2");
    expect(vars["--border"]).toBe("#2a2f3a");
  });

  it("switches to dark text on a light surface", () => {
    const vars = themeVariables({ ...DEFAULT_THEME, surface: { color: "#fff4fb", opacity: 1 } });
    expect(vars["--text"]).toBe("#1f2330");
    // The base layer of a light theme is only a shade darker, not near-black.
    expect(vars["--bg"]).toBe("rgba(240, 229, 236, 1)");
  });

  it("only blurs when the glass effect is on", () => {
    expect(themeVariables(DEFAULT_THEME)["--glass-blur"]).toBe("0px");
    const glass = { ...DEFAULT_THEME, glass: { enabled: true, blur: 18 } };
    expect(themeVariables(glass)["--glass-blur"]).toBe("18px");
  });
});

describe("themeToCss", () => {
  it("wraps every variable in one :root block", () => {
    const css = themeToCss(DEFAULT_THEME);
    expect(css.startsWith(":root {")).toBe(true);
    expect(css).toContain("--app-bg: #0f1115;");
    expect(css.trim().endsWith("}")).toBe(true);
  });

  it("tells the browser whether the palette is light or dark", () => {
    expect(themeToCss(DEFAULT_THEME)).toContain("color-scheme: dark;");
    const light = { ...DEFAULT_THEME, surface: { color: "#ffffff", opacity: 1 } };
    expect(themeToCss(light)).toContain("color-scheme: light;");
  });
});

describe("normalizeTheme", () => {
  it("falls back to the default for garbage", () => {
    expect(normalizeTheme(null)).toEqual(DEFAULT_THEME);
    expect(normalizeTheme("nope")).toEqual(DEFAULT_THEME);
    expect(normalizeTheme(42)).toEqual(DEFAULT_THEME);
  });

  it("keeps valid fields and repairs invalid ones", () => {
    const t = normalizeTheme({
      background: { kind: "linear", color: "red; }", stops: ["#abcdef", "bad"], angle: 900 },
      surface: { color: "#010203", opacity: 7 },
      glass: { enabled: true, blur: -4 },
      accent: "url(x)",
    });
    expect(t.background.kind).toBe("linear");
    expect(t.background.color).toBe(DEFAULT_THEME.background.color);
    expect(t.background.stops).toEqual(["#abcdef", DEFAULT_THEME.background.stops[1]]);
    expect(t.background.angle).toBe(360);
    expect(t.surface).toEqual({ color: "#010203", opacity: 1 });
    expect(t.glass).toEqual({ enabled: true, blur: 0 });
    expect(t.accent).toBe(DEFAULT_THEME.accent);
  });

  it("rejects an unknown background kind", () =>
    expect(normalizeTheme({ background: { kind: "video" } }).background.kind).toBe("solid"));

  it("keeps two or three gradient stops", () => {
    const one = normalizeTheme({ background: { stops: ["#111111"] } });
    expect(one.background.stops).toHaveLength(2);
    const four = normalizeTheme({
      background: { stops: ["#111111", "#222222", "#333333", "#444444"] },
    });
    expect(four.background.stops).toEqual(["#111111", "#222222", "#333333"]);
  });

  it("keeps a known skin and drops an unknown one", () => {
    expect(normalizeTheme({ skin: "needy" }).skin).toBe("needy");
    expect(normalizeTheme({ skin: "evil" }).skin).toBe("none");
  });

  it("dresses the Needy Girl preset in its skin", () =>
    expect(PRESETS.find((p) => p.id === "needy")?.theme.skin).toBe("needy"));

  it("offers Ame's night desktop as a dark preset with its own skin", () => {
    const ame = PRESETS.find((p) => p.id === "ame")?.theme;
    expect(ame?.skin).toBe("ame");
    expect(normalizeTheme(ame)).toEqual(ame);
    expect(normalizeTheme({ skin: "ame" }).skin).toBe("ame");
  });

  it("caps the custom CSS", () => {
    const t = normalizeTheme({ customCss: "a".repeat(MAX_CUSTOM_CSS + 10) });
    expect(t.customCss).toHaveLength(MAX_CUSTOM_CSS);
  });

  it("round-trips every preset unchanged", () => {
    for (const p of PRESETS) expect(normalizeTheme(p.theme)).toEqual(p.theme);
  });
});

describe("overriddenVariables", () => {
  it("finds the theme variables the CSS sets", () =>
    expect(overriddenVariables(":root { --accent: red; --bg-elev-2: #000 }")).toEqual([
      "--bg-elev-2",
      "--accent",
    ]));

  it("does not confuse a variable with a longer one", () =>
    expect(overriddenVariables(":root { --app-bg: #000; --bg-elev: #111 }")).toEqual([
      "--app-bg",
      "--bg-elev",
    ]));

  it("ignores reads and comments", () =>
    expect(overriddenVariables("/* --accent: red; */ .x { color: var(--accent); }")).toEqual([]));
});
