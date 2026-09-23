import { describe, expect, it } from "vitest";
import {
  BOOK_KEY,
  EMPTY_BOOK,
  LEGACY_KEY,
  activeIdentity,
  addIdentity,
  adoptHubIdentity,
  exportFileName,
  exportIni,
  generateKey,
  loadBook,
  makeIdentity,
  parseImport,
  removeIdentity,
  replaceKey,
  saveBook,
  setActive,
  updateIdentity,
} from "./book";
import { formatHubIdentity, parseHubIdentity, IdentityError } from "./formats";
import { formatIdentityIni, looksLikeIni, parseIdentityIni } from "./ini";
import { searchChunk } from "./levelSearch";
import { publicKeyBase64, securityLevel } from "./keys";

const HUB_KEY = "/jdaL4Lfto9n2WMQXIYqcpY98lqOYeNWaoi/j9oiIZI=:126";
const HUB_UID = "qZvKeySVtV2Jln2B0EUjvQIz9kg=";

function memoryStorage(init: Record<string, string> = {}) {
  const map = new Map(Object.entries(init));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe("persistence", () => {
  it("migrates the single legacy identity into the first entry", () => {
    const storage = memoryStorage({ [LEGACY_KEY]: HUB_KEY });
    const book = loadBook(storage, "Default", 1);
    expect(book.items).toHaveLength(1);
    expect(book.items[0]).toMatchObject({ name: "Default", key: HUB_KEY, uid: HUB_UID, level: 8 });
    expect(activeIdentity(book)?.uid).toBe(HUB_UID);

    saveBook(storage, book);
    expect(storage.map.has(LEGACY_KEY)).toBe(false);
    expect(loadBook(storage, "ignored")).toEqual(book);
  });

  it("ignores an unreadable legacy identity and a corrupt book", () => {
    expect(loadBook(memoryStorage({ [LEGACY_KEY]: "garbage" }), "x")).toEqual(EMPTY_BOOK);
    expect(loadBook(memoryStorage({ [BOOK_KEY]: "{" }), "x")).toEqual(EMPTY_BOOK);
  });

  it("drops malformed entries and repairs a dangling active id", () => {
    const good = makeIdentity(parseHubIdentity(HUB_KEY), { name: "a", id: "a", now: 1 });
    const raw = JSON.stringify({ version: 1, activeId: "gone", items: [{ id: 3 }, good] });
    const book = loadBook(memoryStorage({ [BOOK_KEY]: raw }), "x");
    expect(book.items).toEqual([good]);
    expect(book.activeId).toBe("a");
  });
});

describe("edits", () => {
  const base = makeIdentity(parseHubIdentity(HUB_KEY), { name: "Main", id: "m", now: 1 });

  it("adds, activates, renames and removes without mutating", () => {
    const other = makeIdentity(generateKey(), { name: "Alt", id: "o", now: 2 });
    const one = addIdentity(EMPTY_BOOK, base).book;
    const two = addIdentity(one, other).book;
    expect(one.items).toHaveLength(1);
    expect(two.activeId).toBe("m");
    const switched = setActive(two, "o");
    expect(activeIdentity(switched)?.name).toBe("Alt");
    expect(setActive(two, "nope")).toBe(two);
    const renamed = updateIdentity(switched, "o", { name: "  ", nickname: " m1id-x " });
    expect(renamed.items[1]).toMatchObject({ name: "Alt", nickname: "m1id-x" });
    const removed = removeIdentity(renamed, "o");
    expect(removed.activeId).toBe("m");
    expect(removeIdentity(removed, "m")).toMatchObject({ activeId: null, items: [] });
  });

  it("merges an import of a known UID, keeping the higher level", () => {
    const one = addIdentity(EMPTY_BOOK, base).book;
    const key = parseHubIdentity(HUB_KEY);
    // Same key, a counter that reaches level 9: same UID, better level.
    const higher = searchChunk(publicKeyBase64(key.d), key.offset + 1n, 9, 1_000_000);
    expect(higher.found).not.toBeNull();
    const better = makeIdentity({ d: key.d, offset: higher.found! }, { name: "dup" });
    const r = addIdentity(one, better);
    expect(r.existed).toBe(true);
    expect(r.book.items).toHaveLength(1);
    expect(r.book.items[0]!.level).toBeGreaterThanOrEqual(9);
    expect(r.book.items[0]!.name).toBe("Main");
    // A lower one changes nothing.
    expect(addIdentity(r.book, base).book.items[0]!.level).toBeGreaterThanOrEqual(9);
  });

  it("adopts what the hub reports", () => {
    const one = addIdentity(EMPTY_BOOK, base).book;
    expect(adoptHubIdentity(one, HUB_KEY, "n")).toBe(one);
    expect(adoptHubIdentity(one, "junk", "n")).toBe(one);
    const key = parseHubIdentity(HUB_KEY);
    // A counter the hub raised further than ours (search for one that is stronger).
    const pub = publicKeyBase64(key.d);
    let raised = key.offset + 1n;
    while (securityLevel(pub, raised) <= base.level) raised++;
    const bumped = adoptHubIdentity(one, formatHubIdentity({ ...key, offset: raised }), "n");
    expect(bumped.items[0]!.key.endsWith(`:${raised}`)).toBe(true);
    const fresh = formatHubIdentity(generateKey());
    const grown = adoptHubIdentity(one, fresh, "New");
    expect(grown.items).toHaveLength(2);
    expect(activeIdentity(grown)?.name).toBe("New");
  });

  it("never lets the hub downgrade a stored key", () => {
    const key = parseHubIdentity(HUB_KEY);
    const pub = publicKeyBase64(key.d);
    // Two counters for the same key with different security levels.
    const offsets = [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 126n, 999n];
    const byLevel = [...offsets].sort((a, b) => securityLevel(pub, a) - securityLevel(pub, b));
    const low = byLevel[0]!;
    const high = byLevel[byLevel.length - 1]!;
    expect(securityLevel(pub, high)).toBeGreaterThan(securityLevel(pub, low));
    const strong = addIdentity(
      EMPTY_BOOK,
      makeIdentity({ ...key, offset: high }, { name: "Main" }),
    ).book;
    const weaker = formatHubIdentity({ ...key, offset: low });
    expect(adoptHubIdentity(strong, weaker, "n")).toBe(strong);
  });

  it("replaceKey refuses a key with a different UID", () => {
    const one = addIdentity(EMPTY_BOOK, base).book;
    expect(replaceKey(one, "m", generateKey()).items[0]!.key).toBe(HUB_KEY);
  });

  it("generates keys at the requested level", () => {
    const item = makeIdentity(generateKey(10), { name: "g" });
    expect(item.level).toBeGreaterThanOrEqual(10);
    expect(item.uid).toMatch(/^[A-Za-z0-9+/]{27}=$/);
  });
});

describe("import / export", () => {
  const item = makeIdentity(parseHubIdentity(HUB_KEY), { name: "My ID", nickname: "m1id-me" });

  it("exports a TS3 ini that imports back to the same key", () => {
    const ini = exportIni(item);
    expect(ini).toMatch(
      /^\[Identity\]\nid=My ID\nidentity="126V[A-Za-z0-9+/=]+"\nnickname=m1id-me\n/,
    );
    const [c] = parseImport(ini);
    expect(formatHubIdentity(c!.key)).toBe(HUB_KEY);
    expect(c).toMatchObject({ name: "My ID", nickname: "m1id-me" });
    expect(exportFileName(item)).toBe("My_ID.ini");
    expect(exportFileName({ ...item, name: "../" })).toBe("identity.ini");
  });

  it("reads CRLF, BOM, prefixed keys and several identities", () => {
    const one = exportIni(item).split("\n").slice(2, 3)[0]!.split("=").slice(1).join("=");
    const text = `﻿; comment\r\n[Identities]\r\n1\\id=A\r\n1\\identity=${one}\r\n2\\identity=${HUB_KEY}\r\n`;
    expect(looksLikeIni(text)).toBe(true);
    const found = parseImport(text);
    expect(found).toHaveLength(2);
    expect(found.map((f) => formatHubIdentity(f.key))).toEqual([HUB_KEY, HUB_KEY]);
    expect(found[0]!.name).toBe("A");
  });

  it("accepts a pasted bare string", () => {
    expect(parseImport(HUB_KEY)).toHaveLength(1);
    expect(looksLikeIni(HUB_KEY)).toBe(false);
  });

  it("explains bad input", () => {
    const err = (t: string) => {
      try {
        parseImport(t);
      } catch (e) {
        return (e as IdentityError).code;
      }
      return "none";
    };
    expect(err("")).toBe("empty");
    expect(err("[Identity]\nnickname=x\n")).toBe("unrecognized");
    expect(err('[Identity]\nidentity="7Vxx"\n')).toBe("badKey");
  });

  it("keeps newlines out of ini values", () => {
    const text = formatIdentityIni({ name: "a\nidentity=evil", identity: "1V", nickname: "b" });
    expect(parseIdentityIni(text)).toHaveLength(1);
  });
});
