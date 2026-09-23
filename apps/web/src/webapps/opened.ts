/**
 * Which of the shared sites this browser has open in the Apps window, and
 * which one is showing. The site list itself belongs to the hub; this is the
 * per-user part, kept as plain data so the rules can be tested alone.
 */

export interface OpenedState {
  /** Open sites, in the order their tabs appear. */
  readonly ids: readonly string[];
  readonly active: string | null;
}

export const EMPTY_OPENED: OpenedState = { ids: [], active: null };

/** Opens a site (or re-shows it) and makes it the visible tab. */
export function openSite(state: OpenedState, id: string): OpenedState {
  return { ids: state.ids.includes(id) ? state.ids : [...state.ids, id], active: id };
}

/** Closes a tab; the one to its left (else its right) takes over when it was showing. */
export function closeSite(state: OpenedState, id: string): OpenedState {
  const index = state.ids.indexOf(id);
  if (index < 0) return state;
  const ids = state.ids.filter((x) => x !== id);
  if (state.active !== id) return { ids, active: state.active };
  return { ids, active: ids[Math.max(0, index - 1)] ?? null };
}

/** Drops tabs of sites that no longer exist (removed by anyone). */
export function pruneOpened(state: OpenedState, existing: ReadonlySet<string>): OpenedState {
  let next = state;
  for (const id of state.ids) if (!existing.has(id)) next = closeSite(next, id);
  return next;
}

/** Saved state, re-validated: storage is user-editable and may hold anything. */
export function parseOpened(raw: unknown): OpenedState {
  if (!raw || typeof raw !== "object") return EMPTY_OPENED;
  const { ids, active } = raw as Record<string, unknown>;
  const list = Array.isArray(ids)
    ? [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))]
    : [];
  return { ids: list, active: typeof active === "string" && list.includes(active) ? active : null };
}
