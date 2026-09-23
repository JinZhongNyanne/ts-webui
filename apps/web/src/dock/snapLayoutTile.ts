/**
 * Which Snap Layouts tile, if any, is under a point on the screen.
 *
 * The flyout's tiles are the only DOM the drop half of the gesture needs to
 * know about, and a drag never fires `mouseenter` on them — the browser routes
 * every move to whatever captured the pointer — so the tile is found by
 * hit-testing at the release point instead of by tracking hovers.
 *
 * Kept out of `layouts.ts`, which stays DOM-free, and out of `useDesktop.ts`,
 * which only wants the answer.
 */

/** A tile's identity, as its `data-layout` / `data-zone` attributes carry it. */
export interface LayoutTile {
  readonly layoutId: string;
  readonly zoneId: string;
}

/** The test id every tile carries, so specs can address one. */
export const TILE_TESTID = "snap-layout-zone";

/** The test id of the flyout itself. */
export const PANEL_TESTID = "snap-layouts";

/** The tile at a viewport point, or `null`. */
export function layoutTileAt(clientX: number, clientY: number): LayoutTile | null {
  const tile = elementAt(clientX, clientY)?.closest<HTMLElement>(`[data-testid=${TILE_TESTID}]`);
  const layoutId = tile?.dataset.layout;
  const zoneId = tile?.dataset.zone;
  if (!layoutId || !zoneId) return null;
  return { layoutId, zoneId };
}

/**
 * Whether that point is over the flyout at all — a tile, the gap between two
 * thumbnails, the padding.
 *
 * This is what keeps the panel up once the drag has reached for it. The panel
 * hangs below the top edge, so a pointer that has left the edge band to aim at
 * a tile would otherwise disarm the top-edge gesture and take the panel away
 * from under itself.
 */
export function overLayoutPanel(clientX: number, clientY: number): boolean {
  return !!elementAt(clientX, clientY)?.closest(`[data-testid=${PANEL_TESTID}]`);
}

/**
 * The topmost element at a viewport point, or `null`.
 *
 * Tolerant of a stripped-down `document`: the desktop's unit tests stub one
 * with nothing but `querySelector`, and a missing hit test means "nothing
 * there" rather than a crash mid-drag.
 */
function elementAt(clientX: number, clientY: number): Element | null {
  if (typeof document === "undefined") return null;
  const hitTest = (document as Partial<Document>).elementFromPoint;
  if (typeof hitTest !== "function") return null;
  const hit = hitTest.call(document, clientX, clientY);
  return hit instanceof Element ? hit : null;
}
