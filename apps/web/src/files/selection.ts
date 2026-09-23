/**
 * The file table's multi-select, as a desktop file manager does it: a click
 * picks one entry, Ctrl / Cmd adds or removes one, Shift takes the range from
 * the anchor (the last entry clicked without Shift). Entries are keyed by name,
 * which is unique within a folder. Every function returns a new selection.
 */

export interface Selection {
  readonly names: ReadonlySet<string>;
  /** Where a Shift range starts; null when nothing was clicked yet. */
  readonly anchor: string | null;
}

export const EMPTY_SELECTION: Selection = { names: new Set(), anchor: null };

export interface ClickMods {
  /** Ctrl or Cmd held (or the row's checkbox). */
  readonly toggle?: boolean;
  /** Shift held. */
  readonly range?: boolean;
}

/** The selection after a click on `name`; `order` is the table's current row order. */
export function clickSelect(
  current: Selection,
  order: readonly string[],
  name: string,
  mods: ClickMods,
): Selection {
  if (mods.range && current.anchor !== null && order.includes(current.anchor)) {
    const from = order.indexOf(current.anchor);
    const to = order.indexOf(name);
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    return { names: new Set(order.slice(lo, hi + 1)), anchor: current.anchor };
  }
  if (mods.toggle) {
    const names = new Set(current.names);
    if (names.has(name)) names.delete(name);
    else names.add(name);
    return { names, anchor: name };
  }
  return { names: new Set([name]), anchor: name };
}

/** Drops what the folder no longer lists (after a refresh, a delete or a rename). */
export function pruneSelection(current: Selection, listed: readonly string[]): Selection {
  const keep = new Set(listed);
  const names = new Set([...current.names].filter((n) => keep.has(n)));
  const anchor = current.anchor !== null && keep.has(current.anchor) ? current.anchor : null;
  return { names, anchor };
}
