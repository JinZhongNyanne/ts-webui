import type { Box, DesktopSize } from "./box";

/**
 * Snap Layouts: the handful of ways Windows 11 offers to divide the desktop,
 * as data, plus the maths that turns one of their regions into a pixel box.
 *
 * The flyout (`SnapLayouts.vue`) draws these same fractions as thumbnails and
 * the desktop snaps a window into the box computed here, so both ends of the
 * feature read from one table.
 *
 * Pure and DOM-free, and exact in the way `snap.ts` is exact: a layout's zones
 * tile the desktop with no seam and no overlap, on odd sizes too. That falls
 * out of how the boxes are built — every zone's edges are taken from the same
 * grid of integer pixel positions, so neighbours share an edge *value* rather
 * than each rounding their own size and hoping the two agree.
 */

/** An exact fraction of one axis, as `[numerator, denominator]`. */
export type Fraction = readonly [numerator: number, denominator: number];

/** A zone's extent in fractions of the desktop, as `[start, end)` per axis. */
export interface LayoutArea {
  readonly left: Fraction;
  readonly right: Fraction;
  readonly top: Fraction;
  readonly bottom: Fraction;
}

/** One region of a layout: the tile a user aims at, and what it covers. */
export interface LayoutZone {
  readonly id: string;
  readonly area: LayoutArea;
}

export type SnapLayoutId = "even" | "wide-left" | "wide-right" | "left-stack" | "quarters";

export interface SnapLayout {
  readonly id: SnapLayoutId;
  readonly zones: readonly LayoutZone[];
}

const ZERO: Fraction = [0, 1];
const ONE: Fraction = [1, 1];
const HALF: Fraction = [1, 2];
const THIRD: Fraction = [1, 3];
const TWO_THIRDS: Fraction = [2, 3];

/** A zone spanning the whole height, between two horizontal fractions. */
function column(id: string, left: Fraction, right: Fraction): LayoutZone {
  return { id, area: { left, right, top: ZERO, bottom: ONE } };
}

/** A zone bounded on both axes. */
function cell(
  id: string,
  left: Fraction,
  right: Fraction,
  top: Fraction,
  bottom: Fraction,
): LayoutZone {
  return { id, area: { left, right, top, bottom } };
}

/**
 * The five layouts, in the order Windows 11 shows them: two equal columns; a
 * wide left column; a wide right column; a tall left half beside two stacked
 * quarters; four equal quadrants.
 */
export const SNAP_LAYOUTS: readonly SnapLayout[] = Object.freeze([
  {
    id: "even",
    zones: [column("left", ZERO, HALF), column("right", HALF, ONE)],
  },
  {
    id: "wide-left",
    zones: [column("left", ZERO, TWO_THIRDS), column("right", TWO_THIRDS, ONE)],
  },
  {
    id: "wide-right",
    zones: [column("left", ZERO, THIRD), column("right", THIRD, ONE)],
  },
  {
    id: "left-stack",
    zones: [
      column("left", ZERO, HALF),
      cell("right-top", HALF, ONE, ZERO, HALF),
      cell("right-bottom", HALF, ONE, HALF, ONE),
    ],
  },
  {
    id: "quarters",
    zones: [
      cell("top-left", ZERO, HALF, ZERO, HALF),
      cell("top-right", HALF, ONE, ZERO, HALF),
      cell("bottom-left", ZERO, HALF, HALF, ONE),
      cell("bottom-right", HALF, ONE, HALF, ONE),
    ],
  },
] as const satisfies readonly SnapLayout[]);

/**
 * The pixel position of a fraction along an axis of `size`.
 *
 * Integer arithmetic throughout — `(numerator * size) / denominator` rather
 * than a floating fraction multiplied by the size — so a third of 3 pixels is
 * 1 and not whatever `0.3333… * 3` happens to floor to. Flooring makes the
 * function non-decreasing and pins both ends exactly (`0` → 0, `1` → size),
 * which together are what make the zones tile.
 *
 * This is also the same rounding `snap.ts` uses for its halves, so a layout's
 * even columns land on exactly the Aero Snap left/right boxes.
 */
export function edgeAt(fraction: Fraction, size: number): number {
  const [numerator, denominator] = fraction;
  return Math.floor((numerator * size) / denominator);
}

/** The box a zone takes on a desktop of this size. */
export function layoutZoneBox(zone: LayoutZone, desktop: DesktopSize): Box {
  const x = edgeAt(zone.area.left, desktop.width);
  const y = edgeAt(zone.area.top, desktop.height);
  return {
    x,
    y,
    width: edgeAt(zone.area.right, desktop.width) - x,
    height: edgeAt(zone.area.bottom, desktop.height) - y,
  };
}

/** The layout with that id, or `null`. */
export function findLayout(layoutId: string): SnapLayout | null {
  return SNAP_LAYOUTS.find((layout) => layout.id === layoutId) ?? null;
}

/**
 * The box named by a layout id and a zone id, or `null` if either is unknown.
 *
 * The two ids are what the flyout's tiles carry in the DOM, so they arrive back
 * as plain strings that have been nowhere near the type system.
 */
export function layoutZoneBoxFor(
  layoutId: string,
  zoneId: string,
  desktop: DesktopSize,
): Box | null {
  const zone = findLayout(layoutId)?.zones.find((z) => z.id === zoneId);
  return zone ? layoutZoneBox(zone, desktop) : null;
}

/** A fraction as a CSS percentage, for drawing a thumbnail. */
export function fractionPercent(fraction: Fraction): number {
  return (100 * fraction[0]) / fraction[1];
}
