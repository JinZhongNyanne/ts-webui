/**
 * Windows' oldest window gesture: double-click the title bar to maximise, and
 * again to put the window back where it was.
 *
 * On this desktop the title bar *is* the tab bar — the app sets
 * `floating-group-drag-handle="tabbar"`, so the bar that carries the tabs is
 * also the bar a window is dragged by — which means the gesture has to share
 * that strip with the tabs themselves, their close crosses and the window
 * controls. Everything else in the bar is fair game: a double-click on a tab,
 * or on the void space beside it, maximises the window it belongs to.
 *
 * Pure and DOM-free: the desktop resolves the three questions below from the
 * event's target and asks here what they add up to, so the rule is tested
 * without a dock, a window or a real double-click.
 */

/** dockview's tab bar, which doubles as this desktop's title bar. */
export const TITLE_BAR_SELECTOR = ".dv-tabs-and-actions-container";

/**
 * The parts of that bar that already answer a click of their own: a tab's close
 * cross (`.dv-default-tab-action`) and the window controls `HeaderActions.vue`
 * renders. Double-clicking one is two presses of that button, and must not also
 * maximise — closing a tab and maximising the window it was in at the same time
 * is nobody's intention.
 */
export const NO_MAXIMIZE_SELECTOR = ".dv-default-tab-action, .hdr-actions";

/** dockview's element for one window, which is what identifies the window. */
export const GROUP_SELECTOR = ".dv-groupview";

/** What a double-click landed on, as the three things that decide it. */
export interface TitleBarHit {
  /** Whether it landed inside a window's tab bar at all. */
  readonly inTitleBar: boolean;
  /** Whether it landed on a control with a meaning of its own. */
  readonly onControl: boolean;
  /** The window it landed in, as the id of its front tab, or `null` if unknown. */
  readonly panelId: string | null;
}

/**
 * The window to maximise or restore, or `null` for a double-click that means
 * nothing here.
 *
 * Which of the two it is deliberately is *not* decided here: the desktop hands
 * the answer to the same `toggleMaximize` the maximise button and the top-edge
 * drag use, so all three gestures share one notion of what a window's maximised
 * state is and one box to come back to.
 */
export function maximizeTargetFor(hit: TitleBarHit): string | null {
  if (!hit.inTitleBar || hit.onControl) return null;
  return hit.panelId;
}
