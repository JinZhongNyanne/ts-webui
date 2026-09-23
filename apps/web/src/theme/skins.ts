import type { SkinId } from "./theme";
import needyCss from "./skins/needy.css?raw";
import ameCss from "./skins/ame.css?raw";

/** The stylesheet each skin layers over the generated variables. */
export const SKIN_CSS: Record<SkinId, string> = {
  none: "",
  needy: needyCss,
  // Ame is the needy desktop at night: its shapes, then her colours on top.
  ame: `${needyCss}\n${ameCss}`,
};

/**
 * Fonts a skin needs, fetched only once it is picked: the pixel font is a few
 * hundred kilobytes that nobody on another skin should pay for.
 */
export function loadSkinAssets(skin: SkinId): void {
  if (skin === "needy" || skin === "ame") {
    import("@fontsource/dotgothic16/400.css").catch((err: unknown) => {
      console.warn("[theme] pixel font failed to load; falling back to system fonts", err);
    });
  }
}
