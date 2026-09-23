import { themeAbyss, type DockviewTheme } from "dockview-vue";

/**
 * The dock's theme object.
 *
 * The app picks its dockview theme by class name (`dockview-theme-abyss` on
 * the dock element, and dockview repeats it on its inner `.dv-shell`), and
 * that is where the app's own palette overrides hang — see the unscoped block
 * in `App.vue`. Passing a theme *object* is only how the non-CSS parts of a
 * theme are set; every field of `themeAbyss` is carried over unchanged, class
 * name included, so nothing about those overrides moves.
 *
 * The one change is `tabAnimation: "smooth"`: tabs slide apart to show where a
 * dragged tab will land and animate into place on drop, the way a browser's
 * tab strip does.
 */
export const DOCK_THEME: DockviewTheme = { ...themeAbyss, tabAnimation: "smooth" };
