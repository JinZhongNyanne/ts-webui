/**
 * The desktop wallpaper's pure half: which ways a picture may be fitted to the
 * desktop, what each of them means in CSS, and whether a picked file may be
 * rendered at all.
 *
 * Pure, so it runs on plain node in the unit tests. Everything that touches
 * IndexedDB, object URLs or the DOM lives in `wallpaperImage.ts` and
 * `useWallpaper.ts`.
 */

/**
 * The five fits Windows offers for a desktop background, by its own names.
 * The order is the order the context menu lists them in.
 */
export const WALLPAPER_FITS = ["fill", "fit", "stretch", "tile", "center"] as const;

export type WallpaperFit = (typeof WALLPAPER_FITS)[number];

/** What Windows starts with, and the best answer for a photo on a wide screen. */
export const DEFAULT_WALLPAPER_FIT: WallpaperFit = "fill";

export function isWallpaperFit(value: unknown): value is WallpaperFit {
  return typeof value === "string" && (WALLPAPER_FITS as readonly string[]).includes(value);
}

/** Reads a stored preference back, falling back for anything unrecognised. */
export function parseWallpaperFit(raw: string | null | undefined): WallpaperFit {
  return isWallpaperFit(raw) ? raw : DEFAULT_WALLPAPER_FIT;
}

/** The CSS a fit mode is made of. Plain properties, so they can be asserted on. */
export interface WallpaperStyle {
  readonly backgroundImage: string;
  readonly backgroundSize: string;
  readonly backgroundRepeat: string;
  readonly backgroundPosition: string;
}

/**
 * How each fit maps onto CSS:
 *
 * - `fill`    → `cover`: the picture covers the desktop, cropping the overflow.
 * - `fit`     → `contain`: the whole picture is shown, letterboxed.
 * - `stretch` → `100% 100%`: exactly fills, aspect ratio ignored.
 * - `tile`    → natural size, repeated from the top-left corner.
 * - `center`  → natural size, once, centred (and cropped if it is too big).
 */
const FIT_CSS: Record<WallpaperFit, Omit<WallpaperStyle, "backgroundImage">> = {
  fill: { backgroundSize: "cover", backgroundRepeat: "no-repeat", backgroundPosition: "center" },
  fit: { backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center" },
  stretch: {
    backgroundSize: "100% 100%",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "center",
  },
  tile: { backgroundSize: "auto", backgroundRepeat: "repeat", backgroundPosition: "left top" },
  center: { backgroundSize: "auto", backgroundRepeat: "no-repeat", backgroundPosition: "center" },
};

/**
 * Quotes a URL for `background-image`. Object URLs contain nothing that needs
 * escaping, but the value is built from data all the same, so the two
 * characters that could end the string early are escaped rather than trusted.
 */
function cssUrl(url: string): string {
  return `url("${url.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}")`;
}

/** The inline style for a wallpaper. Never mutates its arguments. */
export function wallpaperStyle(url: string, fit: WallpaperFit): WallpaperStyle {
  return { backgroundImage: cssUrl(url), ...FIT_CSS[fit] };
}

/* ------------------------------- validation ------------------------------- */

/**
 * A wallpaper is decoded into a full-screen layer and kept in this browser's
 * IndexedDB, so the cap is generous enough for a phone photo and mean enough
 * that a RAW file or a video renamed to `.png` is refused before it is read.
 */
export const WALLPAPER_MAX_BYTES = 12 * 1024 * 1024;

/**
 * The raster types every target browser decodes. SVG is deliberately absent:
 * an SVG is a document that can carry script and remote references, and
 * nothing here needs a vector background.
 */
export const WALLPAPER_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
];

/** Why a picked file cannot become the wallpaper; each has an i18n key. */
export type WallpaperError = "empty" | "too-large" | "bad-type" | "decode" | "storage";

/**
 * Whether a picked file may be rendered at all, from its size and its declared
 * type. Null when it may. A file that merely *claims* to be a PNG still has to
 * decode; that check needs the browser and lives in `useWallpaper.ts`.
 */
export function validateWallpaperFile(file: { size: number; type: string }): WallpaperError | null {
  if (file.size === 0) return "empty";
  if (file.size > WALLPAPER_MAX_BYTES) return "too-large";
  if (!WALLPAPER_TYPES.includes(file.type.toLowerCase())) return "bad-type";
  return null;
}
