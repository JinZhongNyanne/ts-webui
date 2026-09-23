import { themeToCss, type Theme } from "./theme";
import { SKIN_CSS, loadSkinAssets } from "./skins";

const VARS_ID = "jinz-theme";
const SKIN_ID = "jinz-theme-skin";
const CUSTOM_ID = "jinz-theme-custom";
/** `?safetheme` in the URL skips the hand-written CSS, in case it hid the UI. */
const SAFE_PARAM = "safetheme";

export function isSafeMode(): boolean {
  return new URLSearchParams(location.search).has(SAFE_PARAM);
}

/** One `<style>` per id at the end of `<head>`, so it wins over the app's own CSS. */
function setStyle(id: string, css: string): void {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    document.head.appendChild(el);
  }
  // textContent, never innerHTML: the user's CSS is only ever CSS.
  if (el.textContent !== css) el.textContent = css;
}

/**
 * Pushes a theme into the page as three layers, in this order: the generated
 * variables, the skin's stylesheet, then the user's own CSS (so it can
 * override both). `data-glass` on `<html>` drives the blur rules in
 * `styles/base.css`; `data-skin` is there for hand-written CSS to key off.
 */
export function applyTheme(theme: Theme, safeMode: boolean): void {
  setStyle(VARS_ID, themeToCss(theme));
  setStyle(SKIN_ID, SKIN_CSS[theme.skin]);
  setStyle(CUSTOM_ID, safeMode ? "" : theme.customCss);
  const html = document.documentElement;
  html.toggleAttribute("data-glass", theme.glass.enabled);
  html.dataset.skin = theme.skin;
  loadSkinAssets(theme.skin);
}
