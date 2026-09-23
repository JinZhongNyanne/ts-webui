import { shallowRef } from "vue";
import { isMaximized, NO_WINDOWS, type WindowStates } from "./windowState";

/**
 * Which windows are maximised, published for the header controls to read.
 *
 * dockview constructs `HeaderActions.vue` itself, so nothing there can be
 * bound from `App.vue`'s template and no prop can be handed down — which is
 * also why the buttons' clicks are delegated from the dock element. The
 * restore button still has to know the state of *its own* window to show the
 * right glyph, so `useDesktop` publishes the window state here and the header
 * reads it back, the way `settingsOpen` is shared across the shell.
 *
 * A module-level ref is a singleton, which is what the desktop is: one dock,
 * one set of windows.
 */
const published = shallowRef<WindowStates>(NO_WINDOWS);

/** Called by the desktop whenever its window state changes. */
export function publishWindowStates(states: WindowStates): void {
  published.value = states;
}

/**
 * Whether any of those panels' window is maximised.
 *
 * A window is one dockview group and may hold several tabs; maximising acts on
 * the window, so any panel of it being maximised makes the whole frame
 * maximised. Reactive: call it inside a `computed` and it re-runs when the
 * desktop publishes a new state.
 */
export function anyMaximized(panelIds: readonly string[]): boolean {
  return panelIds.some((id) => isMaximized(published.value, id));
}
