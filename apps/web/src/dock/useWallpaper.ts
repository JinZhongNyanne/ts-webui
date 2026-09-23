/**
 * The desktop wallpaper's live state: the picture currently on the desktop,
 * how it is fitted, and the last refusal to show the user.
 *
 * A store rather than component state, because the picture outlives any one
 * render of the desktop and its object URL has to be revoked exactly once when
 * it is replaced or removed — component state would leak one URL per change.
 *
 * Only the desktop shell uses it, and the desktop is never mounted on a phone,
 * so nothing here runs in the mobile shell.
 */
import { computed, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import {
  DEFAULT_WALLPAPER_FIT,
  parseWallpaperFit,
  validateWallpaperFile,
  wallpaperStyle,
  type WallpaperError,
  type WallpaperFit,
  type WallpaperStyle,
} from "./wallpaper";
import { deleteWallpaperImage, loadWallpaperImage, saveWallpaperImage } from "./wallpaperImage";

/** The fit is a single short string, so it lives with the small preferences. */
export const WALLPAPER_FIT_KEY = "jinz.desktop.wallpaperFit.v1";

/**
 * Whether the browser can actually decode this picture. The file picker's
 * `type` is only what the file claims; a renamed `.exe` would otherwise leave
 * an empty layer on the desktop with nothing said about why.
 */
function decodes(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

export const useWallpaperStore = defineStore("wallpaper", () => {
  /** The object URL of the picture on the desktop, or null for the theme's own background. */
  const url = shallowRef<string | null>(null);
  const fit = ref<WallpaperFit>(DEFAULT_WALLPAPER_FIT);
  const error = shallowRef<WallpaperError | null>(null);
  let loaded = false;

  try {
    fit.value = parseWallpaperFit(localStorage.getItem(WALLPAPER_FIT_KEY));
  } catch {
    /* blocked storage: the default fit, then */
  }

  /**
   * The one place `url` changes, so the URL it replaces is always revoked —
   * an object URL keeps its blob alive until it is, and a wallpaper is
   * megabytes.
   */
  function swapUrl(next: string | null): void {
    const previous = url.value;
    if (previous === next) return;
    url.value = next;
    if (previous) URL.revokeObjectURL(previous);
  }

  /** Reads the saved wallpaper back, once per page load. */
  async function load(): Promise<void> {
    if (loaded) return;
    loaded = true;
    const blob = await loadWallpaperImage();
    if (blob) swapUrl(URL.createObjectURL(blob));
  }

  /**
   * Puts a picked file on the desktop. Every refusal sets `error` and leaves
   * the desktop exactly as it was — a bad file never takes the old wallpaper
   * down with it.
   */
  async function choose(file: File): Promise<void> {
    error.value = validateWallpaperFile(file);
    if (error.value) return;
    const candidate = URL.createObjectURL(file);
    if (!(await decodes(candidate))) {
      URL.revokeObjectURL(candidate);
      error.value = "decode";
      return;
    }
    try {
      await saveWallpaperImage(file);
    } catch {
      URL.revokeObjectURL(candidate);
      error.value = "storage";
      return;
    }
    swapUrl(candidate);
  }

  function setFit(next: WallpaperFit): void {
    error.value = null;
    fit.value = next;
    try {
      localStorage.setItem(WALLPAPER_FIT_KEY, next);
    } catch {
      /* ignore quota errors: the fit still applies for this session */
    }
  }

  /** Back to the theme's own background. */
  async function clear(): Promise<void> {
    error.value = null;
    swapUrl(null);
    await deleteWallpaperImage();
  }

  function dismissError(): void {
    error.value = null;
  }

  /** The inline style for the wallpaper layer, or null when there is none. */
  const style = computed<WallpaperStyle | null>(() =>
    url.value ? wallpaperStyle(url.value, fit.value) : null,
  );

  return { url, fit, error, style, load, choose, setFit, clear, dismissError };
});
