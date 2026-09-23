/**
 * One lazily-loaded list in the browse tabs, with the state the UI renders
 * around it: loading, an error, or "the bot does not offer this at all".
 *
 * Pure module — the caller supplies the reactive container — so the loading
 * rules can be unit-tested without Pinia or a fetch.
 */
import { MusicApiError } from "./api";

export interface Section<T> {
  items: T[];
  loading: boolean;
  /** The bot cannot serve this list; the tab leaves the section out entirely. */
  hidden: boolean;
  error: string | null;
  /** Which source the contents were loaded for; null before the first load. */
  loadedFor: string | null;
  /**
   * The source of the newest load, finished or not. A source tab can be
   * switched while an older answer is still on its way; only this one may land.
   */
  requested: string | null;
  /**
   * Counts loads. Only the newest may land: a platform check alone would let an
   * older request for the same source (a previous bot's, or one from before a
   * tab round trip) overwrite the list.
   */
  seq: number;
}

export function emptySection<T>(): Section<T> {
  return {
    items: [],
    loading: false,
    hidden: false,
    error: null,
    loadedFor: null,
    requested: null,
    seq: 0,
  };
}

/**
 * A section the bot may simply not offer.
 *
 * `recommend/songs` and `user/playlists` want a non-guest bot session (403 from
 * the bot, or from the hub's allow list), a provider that implements them (501)
 * and a route that exists (404). None of those is something the user can act
 * on, so the section hides itself rather than showing an error nobody can fix.
 */
export function isUnsupported(err: unknown): boolean {
  return (
    err instanceof MusicApiError && (err.status === 403 || err.status === 404 || err.status === 501)
  );
}

/** Has this section still to be loaded for `platform` (and is not already being)? */
export function isStale<T>(section: Section<T>, platform: string, force = false): boolean {
  return force || (section.requested ?? section.loadedFor) !== platform;
}

/**
 * Loads a section in place. Mutates `section` rather than replacing it so the
 * caller can hand a `reactive()` object straight to a template.
 */
export async function fillSection<T>(
  section: Section<T>,
  platform: string,
  load: () => Promise<T[]>,
  describe: (err: unknown) => string,
): Promise<void> {
  const seq = ++section.seq;
  section.requested = platform;
  section.loading = true;
  section.error = null;
  let result: { ok: true; items: T[] } | { ok: false; err: unknown };
  try {
    result = { ok: true, items: await load() };
  } catch (err) {
    result = { ok: false, err };
  }
  // Overtaken by a newer load (another tab, another bot): that one owns the section.
  if (section.seq !== seq) return;
  if (result.ok) {
    section.items = result.items;
    section.hidden = false;
  } else {
    section.items = [];
    section.hidden = isUnsupported(result.err);
    section.error = section.hidden ? null : describe(result.err);
  }
  section.loadedFor = platform;
  section.loading = false;
}

/** Clears a section so that no load still in flight can land in it. */
export function orphanLoads(section: Section<unknown>): void {
  section.seq++;
  section.items = [];
  section.loading = false;
  section.hidden = false;
  section.error = null;
  section.loadedFor = null;
  section.requested = null;
}
