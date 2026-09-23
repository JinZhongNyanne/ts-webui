import { describe, expect, it } from "vitest";
import {
  EMPTY_BOOKMARKS,
  RECENT_LIMIT,
  clearRecent,
  forgetIdentity,
  groupBookmarks,
  groupNames,
  parseBookmarks,
  recordRecent,
  removeBookmark,
  upsertBookmark,
  type BookmarkDraft,
  type ServerTarget,
} from "./book";
import { createVault, generateVaultKey, isSealed } from "./vault";

const target: ServerTarget = {
  host: "ts.example.com",
  port: 9987,
  nickname: "m1id-a",
  identityId: "i1",
  defaultChannel: "Lobby",
  musicBot: "",
};

function draft(patch: Partial<BookmarkDraft> = {}): BookmarkDraft {
  return {
    ...target,
    label: "Home",
    group: "",
    serverPassword: null,
    channelPassword: null,
    ...patch,
  };
}

let n = 0;
const makeId = () => `b${++n}`;

describe("bookmarks", () => {
  it("adds, edits in place and removes", () => {
    const a = upsertBookmark(EMPTY_BOOKMARKS, draft(), makeId, 5);
    expect(a.book.bookmarks).toHaveLength(1);
    expect(EMPTY_BOOKMARKS.bookmarks).toHaveLength(0);
    const b = upsertBookmark(a.book, draft({ id: a.id, label: "Renamed" }), makeId, 9);
    expect(b.id).toBe(a.id);
    expect(b.book.bookmarks[0]).toMatchObject({ label: "Renamed", createdAt: 5 });
    expect(removeBookmark(b.book, a.id).bookmarks).toHaveLength(0);
  });

  it("requires a host and cleans fields", () => {
    expect(() => upsertBookmark(EMPTY_BOOKMARKS, draft({ host: "  " }), makeId)).toThrow();
    const r = upsertBookmark(
      EMPTY_BOOKMARKS,
      draft({ label: " ", port: 70000, group: " G " }),
      makeId,
    );
    expect(r.book.bookmarks[0]).toMatchObject({ label: "ts.example.com", port: 9987, group: "G" });
  });

  it("groups folders with ungrouped first", () => {
    let book = EMPTY_BOOKMARKS;
    for (const [label, group] of [
      ["z", "Work"],
      ["b", ""],
      ["a", "Friends"],
      ["y", "Work"],
    ] as const) {
      book = upsertBookmark(book, draft({ label, group }), makeId).book;
    }
    const groups = groupBookmarks(book.bookmarks);
    expect(groups.map((g) => g.name)).toEqual(["", "Friends", "Work"]);
    expect(groups[2]!.items.map((i) => i.label)).toEqual(["y", "z"]);
    expect(groupNames(book)).toEqual(["Friends", "Work"]);
  });

  it("parses tolerantly", () => {
    expect(parseBookmarks(null)).toEqual(EMPTY_BOOKMARKS);
    expect(parseBookmarks("nope")).toEqual(EMPTY_BOOKMARKS);
    const raw = JSON.stringify({
      bookmarks: [{ id: "x", host: "h", serverPassword: { iv: 1 } }, { host: "no id" }, 7],
      recent: [{ ...target, at: 1 }, { at: 2 }],
    });
    const book = parseBookmarks(raw);
    expect(book.bookmarks).toHaveLength(1);
    expect(book.bookmarks[0]!.serverPassword).toBeNull();
    expect(book.recent).toHaveLength(1);
  });
});

describe("recent", () => {
  it("keeps the newest first, deduplicates per server+identity, caps the list", () => {
    let book = recordRecent(EMPTY_BOOKMARKS, target, 1);
    book = recordRecent(book, { ...target, host: "TS.example.com", nickname: "m1id-b" }, 2);
    expect(book.recent).toHaveLength(1);
    expect(book.recent[0]).toMatchObject({ nickname: "m1id-b", at: 2 });
    book = recordRecent(book, { ...target, identityId: "i2" }, 3);
    expect(book.recent).toHaveLength(2);
    for (let i = 0; i < 20; i++) book = recordRecent(book, { ...target, port: 1000 + i }, 10 + i);
    expect(book.recent).toHaveLength(RECENT_LIMIT);
    expect(book.recent[0]!.port).toBe(1019);
    expect(clearRecent(book).recent).toEqual([]);
    expect(recordRecent(book, { ...target, host: "" })).toBe(book);
  });

  it("forgets a deleted identity everywhere", () => {
    let book = recordRecent(EMPTY_BOOKMARKS, target, 1);
    book = upsertBookmark(book, draft(), makeId).book;
    const after = forgetIdentity(book, "i1");
    expect(after.recent[0]!.identityId).toBeNull();
    expect(after.bookmarks[0]!.identityId).toBeNull();
  });
});

describe("vault", () => {
  it("round-trips and uses a fresh nonce each time", async () => {
    const key = await generateVaultKey();
    const vault = createVault({ get: async () => key });
    const a = await vault.seal("s3cret");
    const b = await vault.seal("s3cret");
    expect(isSealed(a)).toBe(true);
    expect(a.data).not.toContain("s3cret");
    expect(a.iv).not.toBe(b.iv);
    expect(await vault.open(a)).toBe("s3cret");
  });

  it("cannot open with another key or tampered data", async () => {
    const one = createVault({ get: generateVaultKey });
    const sealed = await createVault({ get: async () => await generateVaultKey() }).seal("x");
    await expect(one.open(sealed)).rejects.toThrow();
    const key = await generateVaultKey();
    const v = createVault({ get: async () => key });
    const s = await v.seal("hello");
    const bytes = atob(s.data);
    const flipped = String.fromCharCode(bytes.charCodeAt(0) ^ 1) + bytes.slice(1);
    await expect(v.open({ ...s, data: btoa(flipped) })).rejects.toThrow();
  });

  it("the key is not extractable", async () => {
    const key = await generateVaultKey();
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });
});
