import type { MessageKey } from "../i18n/zh-CN";

/**
 * The appearance theme: page background (solid colour or gradient), the tint
 * and opacity of the panels laid over it, an optional frosted-glass blur, the
 * accent colour, and free-form CSS the user writes by hand.
 *
 * Everything here is pure. The theme is turned into CSS custom properties that
 * `styles/base.css` and the components already read (`--bg`, `--bg-elev`, …),
 * so a theme never has to know about individual components.
 */

export type BackgroundKind = "solid" | "linear" | "radial";

/**
 * A skin is a built-in stylesheet layered between the generated variables and
 * the user's own CSS: it restyles shapes (borders, title bars, fonts) that
 * colour variables alone cannot reach. The CSS itself lives in `skins.ts`.
 */
export type SkinId = "none" | "needy" | "ame";

export interface ThemeBackground {
  readonly kind: BackgroundKind;
  /** Used when `kind` is "solid". */
  readonly color: string;
  /** Two or three gradient colours. */
  readonly stops: readonly string[];
  /** Direction of a linear gradient, in degrees. */
  readonly angle: number;
}

export interface Theme {
  readonly background: ThemeBackground;
  /** Panel tint; `opacity` below 1 lets the background show through. */
  readonly surface: { readonly color: string; readonly opacity: number };
  /** Frosted glass: blurs whatever sits behind a panel. */
  readonly glass: { readonly enabled: boolean; readonly blur: number };
  readonly accent: string;
  readonly skin: SkinId;
  /** Appended after the generated variables, so it can override anything. */
  readonly customCss: string;
}

export const BACKGROUND_KINDS: readonly BackgroundKind[] = ["solid", "linear", "radial"];
export const SKINS: readonly { id: SkinId; label: MessageKey }[] = [
  { id: "none", label: "theme.skinNone" },
  { id: "needy", label: "theme.skinNeedy" },
  { id: "ame", label: "theme.skinAme" },
];
export const MAX_CUSTOM_CSS = 20_000;
export const OPACITY_MIN = 0.2;
export const BLUR_MAX = 40;
const MIN_STOPS = 2;
const MAX_STOPS = 3;
/** Above this relative luminance a surface counts as light and gets dark text. */
const LIGHT_SURFACE = 0.5;

/**
 * How the other layers derive from the panel tint. A dark theme sinks its base
 * layer (`--bg`) far down and lifts raised controls (`--bg-elev-2`) a little; a
 * light one only shades the base and makes controls whiter.
 */
const DARK_TONES = {
  baseDarken: 0.35,
  raised: { toward: "#ffffff", by: 0.04 },
  text: "#e6e8ee",
  textDim: "#9aa3b2",
  border: "#2a2f3a",
} as const;
const LIGHT_TONES = {
  baseDarken: 0.06,
  raised: { toward: "#ffffff", by: 0.5 },
  text: "#1f2330",
  textDim: "#5b6272",
  border: "#c9ccd6",
} as const;

export const DEFAULT_THEME: Theme = {
  background: { kind: "solid", color: "#0f1115", stops: ["#1a1f2b", "#0f1115"], angle: 160 },
  surface: { color: "#171a21", opacity: 1 },
  glass: { enabled: false, blur: 16 },
  accent: "#4f8cff",
  skin: "none",
  customCss: "",
};

export interface ThemePreset {
  readonly id: string;
  /** i18n key of the preset's name. */
  readonly label: MessageKey;
  readonly theme: Theme;
}

export const PRESETS: readonly ThemePreset[] = [
  { id: "default", label: "theme.presetDefault", theme: DEFAULT_THEME },
  {
    id: "midnight",
    label: "theme.presetMidnight",
    theme: {
      ...DEFAULT_THEME,
      background: { kind: "linear", color: "#0b1020", stops: ["#0b1020", "#1b1440"], angle: 160 },
      surface: { color: "#141a2e", opacity: 0.85 },
      accent: "#7c8cff",
    },
  },
  {
    id: "aurora",
    label: "theme.presetAurora",
    theme: {
      ...DEFAULT_THEME,
      background: {
        kind: "linear",
        color: "#0f2027",
        stops: ["#0f2027", "#2c5364", "#3a1c71"],
        angle: 135,
      },
      surface: { color: "#101820", opacity: 0.55 },
      glass: { enabled: true, blur: 18 },
      accent: "#3ddcb4",
    },
  },
  {
    id: "sunset",
    label: "theme.presetSunset",
    theme: {
      ...DEFAULT_THEME,
      background: {
        kind: "linear",
        color: "#2b1331",
        stops: ["#41295a", "#8e3b46", "#d0703c"],
        angle: 145,
      },
      surface: { color: "#1c1320", opacity: 0.6 },
      glass: { enabled: true, blur: 20 },
      accent: "#ff8a5c",
    },
  },
  {
    id: "ocean",
    label: "theme.presetOcean",
    theme: {
      ...DEFAULT_THEME,
      background: { kind: "radial", color: "#08263a", stops: ["#1b4f72", "#08263a"], angle: 180 },
      surface: { color: "#0c1c28", opacity: 0.65 },
      glass: { enabled: true, blur: 14 },
      accent: "#4fc3ff",
    },
  },
  {
    // A pastel, Windows-9x desktop in the style of NEEDY GIRL OVERDOSE.
    id: "needy",
    label: "theme.presetNeedy",
    theme: {
      ...DEFAULT_THEME,
      background: {
        kind: "linear",
        color: "#ffd6ef",
        stops: ["#ffc8ea", "#e4ccff", "#bfe3ff"],
        angle: 160,
      },
      surface: { color: "#fff4fb", opacity: 0.94 },
      glass: { enabled: true, blur: 6 },
      accent: "#ff4fa7",
      skin: "needy",
    },
  },
  {
    // The same game, Ame's side: her room at night, indigo and plum under a muted pink.
    id: "ame",
    label: "theme.presetAme",
    theme: {
      ...DEFAULT_THEME,
      background: {
        kind: "linear",
        color: "#140f28",
        stops: ["#0e0a1e", "#2a1b4c", "#5b2c60"],
        angle: 165,
      },
      surface: { color: "#1c1434", opacity: 0.9 },
      glass: { enabled: true, blur: 6 },
      accent: "#f08dc5",
      skin: "ame",
    },
  },
];

/* --------------------------------- colours -------------------------------- */

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Only `#rgb` / `#rrggbb` are accepted, so nothing but a colour ends up in the CSS. */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

type Rgb = readonly [number, number, number];

function parseHex(hex: string): Rgb {
  const h = hex.slice(1);
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as unknown as Rgb;
}

/** Blends `a` towards `b` by `t` (0 = a, 1 = b). */
export function mixHex(a: string, b: string, t: number): Rgb {
  const ca = parseHex(a);
  const cb = parseHex(b);
  return ca.map((v, i) => Math.round(v + (cb[i]! - v) * t)) as unknown as Rgb;
}

function rgba([r, g, b]: Rgb, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${round(alpha)})`;
}

/** Relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function isLightSurface(theme: Theme): boolean {
  return luminance(theme.surface.color) > LIGHT_SURFACE;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ------------------------------ theme → CSS ------------------------------- */

export function backgroundCss(bg: ThemeBackground): string {
  const stops = bg.stops.join(", ");
  if (bg.kind === "linear") return `linear-gradient(${bg.angle}deg, ${stops})`;
  if (bg.kind === "radial") return `radial-gradient(ellipse at top, ${stops})`;
  return bg.color;
}

/** The custom properties a theme sets on `:root`. */
export function themeVariables(theme: Theme): Record<string, string> {
  const { color, opacity } = theme.surface;
  const tones = isLightSurface(theme) ? LIGHT_TONES : DARK_TONES;
  return {
    "--app-bg": backgroundCss(theme.background),
    "--bg": rgba(mixHex(color, "#000000", tones.baseDarken), opacity),
    "--bg-elev": rgba(parseHex(color), opacity),
    // Buttons and inputs stay a little more solid than the panel they sit on.
    "--bg-elev-2": rgba(
      mixHex(color, tones.raised.toward, tones.raised.by),
      Math.min(1, opacity + 0.1),
    ),
    "--text": tones.text,
    "--text-dim": tones.textDim,
    "--border": tones.border,
    "--accent": theme.accent,
    "--glass-blur": `${theme.glass.enabled ? theme.glass.blur : 0}px`,
  };
}

/**
 * The theme variables that hand-written CSS sets itself. Those win over the
 * look controls, which then appear to do nothing, so the UI says so.
 */
export function overriddenVariables(css: string): string[] {
  const names = Object.keys(themeVariables(DEFAULT_THEME));
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return names.filter((name) => new RegExp(`(?<![\\w-])${name}\\s*:`).test(code));
}

export function themeToCss(theme: Theme): string {
  const lines = Object.entries(themeVariables(theme)).map(([k, v]) => `  ${k}: ${v};`);
  // Native controls (scrollbars, pickers) follow the palette too.
  lines.push(`  color-scheme: ${isLightSurface(theme) ? "light" : "dark"};`);
  return `:root {\n${lines.join("\n")}\n}\n`;
}

/* ------------------------------- validation ------------------------------- */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function color(v: unknown, fallback: string): string {
  return isHexColor(v) ? v : fallback;
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function stops(v: unknown, fallback: readonly string[]): string[] {
  const given = Array.isArray(v) ? v.slice(0, MAX_STOPS) : [];
  const count = Math.max(MIN_STOPS, given.length);
  return Array.from({ length: count }, (_, i) =>
    color(given[i], fallback[i] ?? fallback[fallback.length - 1]!),
  );
}

/**
 * Turns anything (saved JSON, a pasted theme) into a valid theme. Each field
 * that is missing or malformed falls back to the default on its own, so one bad
 * value never throws the whole theme away.
 */
export function normalizeTheme(raw: unknown): Theme {
  if (!isRecord(raw)) return DEFAULT_THEME;
  const d = DEFAULT_THEME;
  const bg = isRecord(raw.background) ? raw.background : {};
  const surface = isRecord(raw.surface) ? raw.surface : {};
  const glass = isRecord(raw.glass) ? raw.glass : {};
  const kind = BACKGROUND_KINDS.find((k) => k === bg.kind) ?? d.background.kind;
  return {
    background: {
      kind,
      color: color(bg.color, d.background.color),
      stops: stops(bg.stops, d.background.stops),
      angle: num(bg.angle, d.background.angle, 0, 360),
    },
    surface: {
      color: color(surface.color, d.surface.color),
      opacity: num(surface.opacity, d.surface.opacity, OPACITY_MIN, 1),
    },
    glass: {
      enabled: typeof glass.enabled === "boolean" ? glass.enabled : d.glass.enabled,
      blur: num(glass.blur, d.glass.blur, 0, BLUR_MAX),
    },
    accent: color(raw.accent, d.accent),
    skin: SKINS.find((s) => s.id === raw.skin)?.id ?? d.skin,
    customCss: typeof raw.customCss === "string" ? raw.customCss.slice(0, MAX_CUSTOM_CSS) : "",
  };
}
