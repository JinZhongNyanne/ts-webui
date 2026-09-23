/**
 * Where the mobile shell takes over from the dock.
 *
 * The dock (dockview) is a mouse-first control: its splitters are dragged and
 * its tab strip is sized for a pointer, so below this width the app renders
 * `MobileShell.vue` instead. Keeping the number here — rather than only in a
 * media query — lets the CSS and the component agree on one breakpoint.
 */

/** Widest viewport that still gets the mobile shell, in CSS pixels. */
export const MOBILE_MAX_WIDTH = 768;

/** The same breakpoint as a media query, for `matchMedia` and for CSS. */
export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`;

/**
 * Whether a viewport width belongs to the mobile shell.
 *
 * A width we cannot read (0 during layout, NaN for a detached element) counts
 * as desktop: the dock is the layout every existing user already has, so it is
 * the safer guess when we do not know.
 */
export function isMobileWidth(width: number): boolean {
  if (!Number.isFinite(width) || width <= 0) return false;
  return width <= MOBILE_MAX_WIDTH;
}
