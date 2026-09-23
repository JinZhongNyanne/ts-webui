/** Pure viewport geometry for the context menu; no store or DOM involved. */
export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Gap kept between a floating box and the viewport edge. */
export const EDGE_MARGIN = 8;

/**
 * Slides one edge of a box back inside the viewport on a single axis, keeping
 * the margin. Shared with the teleported popovers (`composables/popoverPosition.ts`),
 * which flip differently but must be pushed inwards in exactly the same way.
 * A box too big for the space keeps its near edge, so its top-left stays visible.
 */
export function clampAxis(value: number, size: number, viewport: number): number {
  return Math.max(EDGE_MARGIN, Math.min(value, viewport - size - EDGE_MARGIN));
}

/**
 * Moves a menu anchored at `anchor` so its whole box stays inside the viewport.
 * It is flipped to the other side of the cursor before being pushed inwards, so
 * the click point stays at a corner of the menu whenever there is room.
 */
export function clampToViewport(anchor: Point, menu: Size, viewport: Size): Point {
  const maxX = viewport.width - menu.width - EDGE_MARGIN;
  const maxY = viewport.height - menu.height - EDGE_MARGIN;
  const x =
    anchor.x > maxX && anchor.x - menu.width >= EDGE_MARGIN ? anchor.x - menu.width : anchor.x;
  const y =
    anchor.y > maxY && anchor.y - menu.height >= EDGE_MARGIN ? anchor.y - menu.height : anchor.y;
  return {
    x: clampAxis(x, menu.width, viewport.width),
    y: clampAxis(y, menu.height, viewport.height),
  };
}
