/**
 * The list of identities kept in this browser, as plain immutable data plus
 * the functions that change it. The Pinia store only wires these to
 * localStorage and the UI, so everything here is unit-testable.
 */
import {
  IdentityError,
  formatHubIdentity,
  formatTs3Identity,
  parseHubIdentity,
  parseIdentityString,
  type IdentityKey,
} from "./formats";
import { formatIdentityIni, looksLikeIni, parseIdentityIni } from "./ini";
import { publicKeyBase64, randomScalar, securityLevel, uidFromPublicKey } from "./keys";
import { searchChunk } from "./levelSearch";

export const BOOK_KEY = "jinz.ts.identities";
/** Where the single identity lived before there was a list; migrated on first load. */
export const LEGACY_KEY = "jinz.ts.identity";
/** TeamSpeak 3's own default for new identities; reached in ~256 hashes. */
export const DEFAULT_LEVEL = 8;
const MAX_NAME = 60;

export interface StoredIdentity {
  id: string;
  name: string;
  /** Hub format (`scalar:counter`), what `connect` sends. */
  key: string;
  uid: string;
  /** Cached; recomputed whenever `key` changes. */
  level: number;
  /** Nickname preset used when this identity is picked (may be empty). */
  nickname: string;
  createdAt: number;
}

export interface IdentityBook {
  version: 1;
  activeId: string | null;
  items: StoredIdentity[];
}

export interface KeyFacts {
  key: string;
  uid: string;
  level: number;
  publicKey: string;
}

export const EMPTY_BOOK: IdentityBook = { version: 1, activeId: null, items: [] };

export function describeKey(key: IdentityKey): KeyFacts {
  const publicKey = publicKeyBase64(key.d);
  return {
    key: formatHubIdentity(key),
    uid: uidFromPublicKey(publicKey),
    level: securityLevel(publicKey, key.offset),
    publicKey,
  };
}

export function newId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** A fresh key at DEFAULT_LEVEL; cheap enough for the main thread. */
export function generateKey(level = DEFAULT_LEVEL): IdentityKey {
  const d = randomScalar();
  const pub = publicKeyBase64(d);
  let start = 0n;
  for (;;) {
    const r = searchChunk(pub, start, level, 10_000);
    if (r.found !== null) return { d, offset: r.found };
    start = r.next;
  }
}

export function makeIdentity(
  key: IdentityKey,
  opts: { name: string; nickname?: string; id?: string; now?: number },
): StoredIdentity {
  const facts = describeKey(key);
  return {
    id: opts.id ?? newId(),
    name: cleanName(opts.name) || facts.uid.slice(0, 8),
    key: facts.key,
    uid: facts.uid,
    level: facts.level,
    nickname: opts.nickname?.trim().slice(0, 30) ?? "",
    createdAt: opts.now ?? Date.now(),
  };
}

function cleanName(name: string): string {
  return name.trim().slice(0, MAX_NAME);
}

/* ------------------------------ persistence ------------------------------ */

function isStored(v: unknown): v is StoredIdentity {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.key === "string" &&
    typeof o.uid === "string" &&
    typeof o.level === "number" &&
    typeof o.nickname === "string" &&
    typeof o.createdAt === "number"
  );
}

/**
 * Reads the book, migrating the pre-list single identity into the first entry
 * so existing users keep their UID without noticing anything.
 */
export function loadBook(
  storage: Pick<Storage, "getItem">,
  legacyName: string,
  now = Date.now(),
): IdentityBook {
  const raw = storage.getItem(BOOK_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<IdentityBook>;
      const items = Array.isArray(parsed.items) ? parsed.items.filter(isStored) : [];
      const activeId = items.some((i) => i.id === parsed.activeId)
        ? (parsed.activeId as string)
        : (items[0]?.id ?? null);
      return { version: 1, activeId, items };
    } catch {
      // Fall through: a corrupt book is treated like a missing one.
    }
  }
  const legacy = storage.getItem(LEGACY_KEY);
  if (legacy) {
    try {
      const item = makeIdentity(parseHubIdentity(legacy), { name: legacyName, now });
      return { version: 1, activeId: item.id, items: [item] };
    } catch {
      // An unreadable legacy identity was never usable (the hub replaced it too).
    }
  }
  return EMPTY_BOOK;
}

export function saveBook(
  storage: Pick<Storage, "setItem" | "removeItem">,
  book: IdentityBook,
): void {
  storage.setItem(BOOK_KEY, JSON.stringify(book));
  // Once the list exists it is the only source of truth.
  storage.removeItem(LEGACY_KEY);
}

/* ------------------------------ edits ------------------------------ */

export function activeIdentity(book: IdentityBook): StoredIdentity | null {
  return book.items.find((i) => i.id === book.activeId) ?? null;
}

export function setActive(book: IdentityBook, id: string): IdentityBook {
  return book.items.some((i) => i.id === id) ? { ...book, activeId: id } : book;
}

export function findByUid(book: IdentityBook, uid: string): StoredIdentity | null {
  return book.items.find((i) => i.uid === uid) ?? null;
}

/**
 * Adds an identity; a key whose UID is already present updates that entry
 * instead (keeping the higher counter), so importing twice does not duplicate.
 */
export function addIdentity(
  book: IdentityBook,
  item: StoredIdentity,
): { book: IdentityBook; id: string; existed: boolean } {
  const same = findByUid(book, item.uid);
  if (same) {
    const better = item.level > same.level ? { ...same, key: item.key, level: item.level } : same;
    return {
      book: { ...book, items: book.items.map((i) => (i.id === same.id ? better : i)) },
      id: same.id,
      existed: true,
    };
  }
  return {
    book: { ...book, items: [...book.items, item], activeId: book.activeId ?? item.id },
    id: item.id,
    existed: false,
  };
}

export function updateIdentity(
  book: IdentityBook,
  id: string,
  patch: Partial<Pick<StoredIdentity, "name" | "nickname">>,
): IdentityBook {
  return {
    ...book,
    items: book.items.map((i) =>
      i.id === id
        ? {
            ...i,
            ...(patch.name !== undefined ? { name: cleanName(patch.name) || i.name } : {}),
            ...(patch.nickname !== undefined
              ? { nickname: patch.nickname.trim().slice(0, 30) }
              : {}),
          }
        : i,
    ),
  };
}

export function removeIdentity(book: IdentityBook, id: string): IdentityBook {
  const items = book.items.filter((i) => i.id !== id);
  const activeId = book.activeId === id ? (items[0]?.id ?? null) : book.activeId;
  return { ...book, items, activeId };
}

/** Replaces an entry's key with a same-UID key at a different counter. */
export function replaceKey(book: IdentityBook, id: string, key: IdentityKey): IdentityBook {
  const facts = describeKey(key);
  return {
    ...book,
    items: book.items.map((i) =>
      i.id === id && i.uid === facts.uid ? { ...i, key: facts.key, level: facts.level } : i,
    ),
  };
}

/**
 * Takes in the identity the hub reports after connecting. The hub may have
 * raised the counter to satisfy the server; keep that so the next connect does
 * not redo the work. An unknown UID (the hub had to generate one) becomes a new
 * active entry.
 */
export function adoptHubIdentity(
  book: IdentityBook,
  hubKey: string,
  name: string,
  now = Date.now(),
): IdentityBook {
  let key: IdentityKey;
  try {
    key = parseHubIdentity(hubKey);
  } catch {
    return book;
  }
  const facts = describeKey(key);
  const same = findByUid(book, facts.uid);
  if (same) {
    // A reconnect can echo a key from before the user raised its level in
    // the meantime; never trade the stored key for a weaker one.
    if (same.key === facts.key || facts.level < same.level) return book;
    return replaceKey(book, same.id, key);
  }
  const item = makeIdentity(key, { name, now });
  return { ...book, items: [...book.items, item], activeId: item.id };
}

/* --------------------------- import / export --------------------------- */

export interface ImportCandidate {
  key: IdentityKey;
  name: string;
  nickname: string;
}

/** Parses pasted text or a file's content: an `.ini` export or a bare string. */
export function parseImport(text: string): ImportCandidate[] {
  if (!text.trim()) throw new IdentityError("empty");
  if (looksLikeIni(text)) {
    const entries = parseIdentityIni(text);
    if (entries.length === 0) throw new IdentityError("unrecognized");
    return entries.map((e) => ({
      key: parseIdentityString(e.identity),
      name: e.name,
      nickname: e.nickname,
    }));
  }
  return [{ key: parseIdentityString(text), name: "", nickname: "" }];
}

export function keyOf(item: StoredIdentity): IdentityKey {
  return parseHubIdentity(item.key);
}

export function exportTs3String(item: StoredIdentity): string {
  return formatTs3Identity(keyOf(item));
}

export function exportIni(item: StoredIdentity): string {
  return formatIdentityIni({
    name: item.name,
    identity: exportTs3String(item),
    nickname: item.nickname,
  });
}

/** A file name safe on every OS. */
export function exportFileName(item: StoredIdentity): string {
  const base = item.name.replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^[_.]+|[_.]+$/g, "");
  return `${base || "identity"}.ini`;
}
