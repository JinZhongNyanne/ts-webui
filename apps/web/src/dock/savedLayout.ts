/**
 * What has to be forgiven in a layout saved by an older build.
 *
 * dockview serialises a *per panel* renderer alongside the layout, and
 * `fromJSON` pins whatever it finds there — including the value the dock's own
 * default put on the panel the last time it was restored. So every layout
 * written before the desktop moved to `defaultRenderer: 'always'` carries
 * `renderer: 'onlyWhenVisible'` on every panel, and would go on destroying and
 * rebuilding panel content forever, for exactly the users who have used the
 * app before.
 *
 * Dropping the field is what makes those layouts adopt the new default, and it
 * is why the storage key did not have to be bumped: nobody loses their windows
 * over a rendering change. Pure and shape-tolerant — anything that is not the
 * structure we wrote is handed back untouched for `fromJSON` to judge.
 */

/** The saved layout with every pinned panel renderer removed. */
export function withoutPanelRenderers(layout: unknown): unknown {
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) return layout;
  const root = layout as Record<string, unknown>;
  const panels = root.panels;
  if (!panels || typeof panels !== "object" || Array.isArray(panels)) return layout;
  const next: Record<string, unknown> = {};
  for (const [id, panel] of Object.entries(panels as Record<string, unknown>)) {
    if (!panel || typeof panel !== "object" || Array.isArray(panel)) {
      next[id] = panel;
      continue;
    }
    const { renderer: _renderer, ...rest } = panel as Record<string, unknown>;
    next[id] = rest;
  }
  return { ...root, panels: next };
}
