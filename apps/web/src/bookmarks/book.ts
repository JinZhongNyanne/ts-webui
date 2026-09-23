/**
 * Saved servers ("bookmarks") and the automatic list of recent connections,
 * as immutable data plus pure edit functions. Only meaningful when the hub
 * lets the user pick a server (not in fixed-server mode).
 *
 * Passwords are stored as `Sealed` blobs (see vault.ts); this module never
 * sees them in clear text. The recent list keeps no passwords at all.
 */
import { isSealed, type Sealed } from "./vault";

export const BOOKMARKS_KEY = "jinz.ts.bookmarks";
export const RECENT_LIMIT = 10;
const MAX_TEXT = 200;

export interface ServerTarget {
  host: string;
  port: number;
  nickname: string;
  /** StoredIdentity.id, or null for "whichever is active". */
  identityId: string | null;
  defaultChannel: string;
  musicBot: string;
}

export interface Bookmark extends ServerTarget {
  id: string;
  label: string;
  /** Folder name; "" = ungrouped. */
  group: string;
  serverPassword: Sealed | null;
  channelPassword: Sealed | null;
  createdAt: number;
}

export interface RecentConnection extends ServerTarget {
  at: number;
}

export interface BookmarkBook {
  version: 1;
  bookmarks: Bookmark[];
  recent: RecentConnection[];
}

export const EMPTY_BOOKMARKS: BookmarkBook = { version: 1, bookmarks: [], recent: [] };

function text(v: unknown, max = MAX_TEXT): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function port(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 65535 ? v : 9987;
}

function target(o: Record<string, unknown>): ServerTarget | null {
  const host = text(o.host, 253);
  if (!host) return null;
  return {
    host,
    port: port(o.port),
    nickname: text(o.nickname, 30),
    identityId: typeof o.identityId === "string" ? o.identityId : null,
    defaultChannel: text(o.defaultChannel),
    musicBot: text(o.musicBot, 253),
  };
}

function toBookmark(v: unknown): Bookmark | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const t = target(o);
  if (!t || typeof o.id !== "string") return null;
  return {
    ...t,
    id: o.id,
    label: text(o.label, 80) || t.host,
    group: text(o.group, 60),
    serverPassword: isSealed(o.serverPassword) ? o.serverPassword : null,
    channelPassword: isSealed(o.channelPassword) ? o.channelPassword : null,
    createdAt: typeof o.createdAt === "number" ? o.createdAt : 0,
  };
}

function toRecent(v: unknown): RecentConnection | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const t = target(o);
  return t && typeof o.at === "number" ? { ...t, at: o.at } : null;
}

/** Tolerant load: anything malformed is dropped rather than breaking the dialog. */
export function parseBookmarks(raw: string | null): BookmarkBook {
  if (!raw) return EMPTY_BOOKMARKS;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const list = <T>(v: unknown, f: (x: unknown) => T | null): T[] =>
      Array.isArray(v) ? v.map(f).filter((x): x is T => x !== null) : [];
    return {
      version: 1,
      bookmarks: list(o.bookmarks, toBookmark),
      recent: list(o.recent, toRecent).slice(0, RECENT_LIMIT),
    };
  } catch {
    return EMPTY_BOOKMARKS;
  }
}

export type BookmarkDraft = Omit<Bookmark, "id" | "createdAt"> & { id?: string };

/** Inserts or replaces (by id) a bookmark. */
export function upsertBookmark(
  book: BookmarkBook,
  draft: BookmarkDraft,
  makeId: () => string,
  now = Date.now(),
): { book: BookmarkBook; id: string } {
  const existing = draft.id ? book.bookmarks.find((b) => b.id === draft.id) : undefined;
  const clean = toBookmark({
    ...draft,
    id: existing?.id ?? makeId(),
    createdAt: existing?.createdAt ?? now,
  });
  if (!clean) throw new Error("bookmark needs a server address");
  const bookmarks = existing
    ? book.bookmarks.map((b) => (b.id === existing.id ? clean : b))
    : [...book.bookmarks, clean];
  return { book: { ...book, bookmarks }, id: clean.id };
}

export function removeBookmark(book: BookmarkBook, id: string): BookmarkBook {
  return { ...book, bookmarks: book.bookmarks.filter((b) => b.id !== id) };
}

function sameServer(a: ServerTarget, b: ServerTarget): boolean {
  return a.host.toLowerCase() === b.host.toLowerCase() && a.port === b.port;
}

/**
 * Puts a successful connection at the top of the recent list. The same server
 * with the same identity is one entry (its nickname/channel are refreshed), so
 * using two identities on one server keeps both.
 */
export function recordRecent(book: BookmarkBook, t: ServerTarget, now = Date.now()): BookmarkBook {
  const clean = target(t as unknown as Record<string, unknown>);
  if (!clean) return book;
  const rest = book.recent.filter(
    (r) => !(sameServer(r, clean) && r.identityId === clean.identityId),
  );
  return { ...book, recent: [{ ...clean, at: now }, ...rest].slice(0, RECENT_LIMIT) };
}

export function clearRecent(book: BookmarkBook): BookmarkBook {
  return { ...book, recent: [] };
}

/** Drops references to a deleted identity so those entries fall back to the active one. */
export function forgetIdentity(book: BookmarkBook, identityId: string): BookmarkBook {
  const strip = <T extends ServerTarget>(x: T): T =>
    x.identityId === identityId ? { ...x, identityId: null } : x;
  return { ...book, bookmarks: book.bookmarks.map(strip), recent: book.recent.map(strip) };
}

export interface BookmarkGroup {
  name: string;
  items: Bookmark[];
}

/** Named folders alphabetically, ungrouped ones first; items by label. */
export function groupBookmarks(bookmarks: readonly Bookmark[]): BookmarkGroup[] {
  const byName = new Map<string, Bookmark[]>();
  for (const b of bookmarks) byName.set(b.group, [...(byName.get(b.group) ?? []), b]);
  return [...byName.entries()]
    .sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)))
    .map(([name, items]) => ({
      name,
      items: [...items].sort((x, y) => x.label.localeCompare(y.label)),
    }));
}

export function groupNames(book: BookmarkBook): string[] {
  return [...new Set(book.bookmarks.map((b) => b.group).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}
