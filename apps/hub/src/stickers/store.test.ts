import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_PERSONAL_STICKERS, MAX_STICKER_PACKS } from "@jinz/protocol";
import { StickerStore, type StickerTarget } from "./store.js";

/** Two different pictures, so the dedup tests have something to tell apart. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("first"),
]);
const OTHER = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("second"),
]);

const sha = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

const SHARED: StickerTarget = { scope: "shared" };
const ALICE: StickerTarget = { scope: "personal", uid: "alice-uid" };
const BOB: StickerTarget = { scope: "personal", uid: "bob-uid" };

let dir: string;
beforeEach(() => (dir = mkdtempSync(path.join(tmpdir(), "jinz-stickers-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const blobs = () => readdirSync(path.join(dir, "blobs")).sort();

function add(
  store: StickerStore,
  target: StickerTarget,
  name: string,
  body = PNG,
  packId: string | null = null,
  now?: number,
) {
  const result = store.addSticker(
    target,
    { name, packId, body, contentType: "image/png", addedBy: "alice" },
    now,
  );
  if (!result.ok) throw new Error(`add failed: ${result.reason}`);
  return result.sticker;
}

function pack(store: StickerStore, target: StickerTarget, name: string) {
  const result = store.addPack(target, name);
  if (!result.ok) throw new Error(`pack failed: ${result.reason}`);
  return result.pack;
}

describe("StickerStore: adding and serving", () => {
  it("stores the picture under its hash and the entry beside it", () => {
    const store = new StickerStore(dir);
    const sticker = add(store, SHARED, "Cat", PNG, null, 1000);
    expect(sticker).toMatchObject({
      name: "Cat",
      packId: null,
      hash: sha(PNG),
      contentType: "image/png",
      bytes: PNG.length,
      addedBy: "alice",
    });
    expect(sticker.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(blobs()).toEqual([`${sha(PNG)}.png`]);
    expect(store.read(sticker.hash)).toEqual({ body: PNG, contentType: "image/png" });
  });

  it("serves nothing for a hash no entry points at", () => {
    const store = new StickerStore(dir);
    expect(store.read(sha(PNG))).toBeNull();
    expect(store.read("../../etc/passwd")).toBeNull();
    expect(store.read("nope")).toBeNull();
  });

  it("keeps the scopes apart", () => {
    const store = new StickerStore(dir);
    add(store, SHARED, "shared one");
    add(store, ALICE, "alice's");
    expect(store.list(SHARED).stickers.map((s) => s.name)).toEqual(["shared one"]);
    expect(store.list(ALICE).stickers.map((s) => s.name)).toEqual(["alice's"]);
    expect(store.list(BOB).stickers).toEqual([]);
    expect(store.list(BOB).scope).toBe("personal");
  });

  it("stops at each scope's own cap", () => {
    const store = new StickerStore(dir);
    for (let i = 0; i < MAX_PERSONAL_STICKERS; i++) add(store, ALICE, `s${i}`);
    expect(
      store.addSticker(ALICE, {
        name: "one more",
        packId: null,
        body: PNG,
        contentType: "image/png",
        addedBy: "a",
      }),
    ).toEqual({ ok: false, reason: "full" });
    // The shared scope has its own, larger budget.
    expect(
      store.addSticker(SHARED, {
        name: "fine",
        packId: null,
        body: PNG,
        contentType: "image/png",
        addedBy: "a",
      }),
    ).toMatchObject({ ok: true });
  });

  it("refuses a pack that is not in this scope", () => {
    const store = new StickerStore(dir);
    const mine = pack(store, ALICE, "mine");
    expect(
      store.addSticker(SHARED, {
        name: "x",
        packId: mine.id,
        body: PNG,
        contentType: "image/png",
        addedBy: "a",
      }),
    ).toEqual({ ok: false, reason: "pack" });
  });
});

describe("StickerStore: dedup and reference counting", () => {
  it("writes one file for the same picture added twice", () => {
    const store = new StickerStore(dir);
    const a = add(store, SHARED, "one");
    const b = add(store, SHARED, "two");
    expect(a.hash).toBe(b.hash);
    expect(a.id).not.toBe(b.id);
    expect(blobs()).toEqual([`${sha(PNG)}.png`]);
    expect(store.references(a.hash)).toBe(2);
  });

  it("counts references across scopes and keeps the file until the last goes", () => {
    const store = new StickerStore(dir);
    const shared = add(store, SHARED, "shared copy");
    const personal = add(store, ALICE, "my copy");
    expect(store.references(shared.hash)).toBe(2);

    expect(store.removeSticker(SHARED, shared.id)).toBe(true);
    expect(blobs()).toEqual([`${sha(PNG)}.png`]);
    expect(store.read(personal.hash)).not.toBeNull();

    expect(store.removeSticker(ALICE, personal.id)).toBe(true);
    expect(blobs()).toEqual([]);
    expect(store.references(shared.hash)).toBe(0);
  });

  it("keeps different pictures in different files", () => {
    const store = new StickerStore(dir);
    add(store, SHARED, "one", PNG);
    add(store, SHARED, "two", OTHER);
    expect(blobs()).toEqual([`${sha(OTHER)}.png`, `${sha(PNG)}.png`].sort());
  });

  it("does not delete a sticker twice, or one that is not there", () => {
    const store = new StickerStore(dir);
    const sticker = add(store, SHARED, "one");
    expect(store.removeSticker(SHARED, sticker.id)).toBe(true);
    expect(store.removeSticker(SHARED, sticker.id)).toBe(false);
    // A personal owner cannot delete through another scope.
    const mine = add(store, ALICE, "mine");
    expect(store.removeSticker(BOB, mine.id)).toBe(false);
    expect(store.removeSticker(SHARED, mine.id)).toBe(false);
  });

  it("sweeps files no entry points at", () => {
    const store = new StickerStore(dir);
    add(store, SHARED, "one");
    writeFileSync(path.join(dir, "blobs", "orphan.png"), "stray");
    store.sweep();
    expect(blobs()).toEqual([`${sha(PNG)}.png`]);
  });
});

describe("StickerStore: packs", () => {
  it("creates, renames and refuses a name already used in the scope", () => {
    const store = new StickerStore(dir);
    const first = pack(store, SHARED, "Memes");
    expect(store.addPack(SHARED, "memes")).toEqual({ ok: false, reason: "duplicate" });
    // The same name in another scope is fine: packs never cross scopes.
    expect(store.addPack(ALICE, "Memes")).toMatchObject({ ok: true });

    const second = pack(store, SHARED, "Cats");
    expect(store.renamePack(SHARED, second.id, "Memes")).toBe("duplicate");
    expect(store.renamePack(SHARED, second.id, "Kittens")).toMatchObject({ name: "Kittens" });
    // Renaming to its own name is not a clash with itself.
    expect(store.renamePack(SHARED, first.id, "Memes")).toMatchObject({ name: "Memes" });
    expect(store.renamePack(SHARED, "nope", "x")).toBeNull();
  });

  it("stops at the pack cap", () => {
    const store = new StickerStore(dir);
    for (let i = 0; i < MAX_STICKER_PACKS; i++) pack(store, SHARED, `p${i}`);
    expect(store.addPack(SHARED, "one more")).toEqual({ ok: false, reason: "full" });
  });

  it("ungroups the stickers of a deleted pack by default", () => {
    const store = new StickerStore(dir);
    const p = pack(store, SHARED, "Memes");
    add(store, SHARED, "in it", PNG, p.id);
    expect(store.removePack(SHARED, p.id, "ungroup")).toBe(true);
    expect(store.list(SHARED).packs).toEqual([]);
    expect(store.list(SHARED).stickers.map((s) => s.packId)).toEqual([null]);
    expect(blobs()).toEqual([`${sha(PNG)}.png`]);
  });

  it("deletes the stickers with the pack when asked, freeing unreferenced files", () => {
    const store = new StickerStore(dir);
    const p = pack(store, SHARED, "Memes");
    add(store, SHARED, "in it", PNG, p.id);
    add(store, SHARED, "outside", OTHER);
    expect(store.removePack(SHARED, p.id, "delete")).toBe(true);
    expect(store.list(SHARED).stickers.map((s) => s.name)).toEqual(["outside"]);
    expect(blobs()).toEqual([`${sha(OTHER)}.png`]);
  });

  it("keeps a picture a surviving entry still uses when a pack is deleted", () => {
    const store = new StickerStore(dir);
    const p = pack(store, SHARED, "Memes");
    add(store, SHARED, "in it", PNG, p.id);
    add(store, ALICE, "my copy", PNG);
    expect(store.removePack(SHARED, p.id, "delete")).toBe(true);
    expect(blobs()).toEqual([`${sha(PNG)}.png`]);
  });

  it("does not delete a pack from the wrong scope", () => {
    const store = new StickerStore(dir);
    const p = pack(store, ALICE, "mine");
    expect(store.removePack(BOB, p.id, "ungroup")).toBe(false);
    expect(store.removePack(SHARED, p.id, "ungroup")).toBe(false);
    expect(store.list(ALICE).packs).toHaveLength(1);
  });
});

describe("StickerStore: editing", () => {
  it("renames and moves between packs, keeping everything else", () => {
    const store = new StickerStore(dir);
    const p = pack(store, SHARED, "Memes");
    const sticker = add(store, SHARED, "Cat");
    expect(store.updateSticker(SHARED, sticker.id, { name: "Big cat" })).toMatchObject({
      name: "Big cat",
      packId: null,
      hash: sticker.hash,
    });
    expect(store.updateSticker(SHARED, sticker.id, { packId: p.id })).toMatchObject({
      name: "Big cat",
      packId: p.id,
    });
    expect(store.updateSticker(SHARED, sticker.id, { packId: null })).toMatchObject({
      packId: null,
    });
  });

  it("refuses a move into a pack of another scope, and an unknown sticker", () => {
    const store = new StickerStore(dir);
    const mine = pack(store, ALICE, "mine");
    const sticker = add(store, SHARED, "Cat");
    expect(store.updateSticker(SHARED, sticker.id, { packId: mine.id })).toBe("pack");
    expect(store.updateSticker(SHARED, "nope", { name: "x" })).toBeNull();
    expect(store.updateSticker(BOB, sticker.id, { name: "x" })).toBeNull();
  });
});

describe("StickerStore: on disk", () => {
  it("survives a restart with both scopes and their packs", () => {
    const store = new StickerStore(dir);
    const p = pack(store, SHARED, "Memes");
    add(store, SHARED, "Cat", PNG, p.id);
    add(store, ALICE, "Mine", OTHER);

    const again = new StickerStore(dir);
    expect(again.list(SHARED).packs.map((x) => x.name)).toEqual(["Memes"]);
    expect(again.list(SHARED).stickers.map((s) => s.packId)).toEqual([p.id]);
    expect(again.list(ALICE).stickers.map((s) => s.name)).toEqual(["Mine"]);
    expect(again.read(sha(PNG))).toEqual({ body: PNG, contentType: "image/png" });
  });

  it("skips entries it cannot trust and ungroups orphaned ones", () => {
    const store = new StickerStore(dir);
    const p = pack(store, SHARED, "Memes");
    const sticker = add(store, SHARED, "Cat", PNG, p.id);
    const file = path.join(dir, "index.json");
    const index = JSON.parse(readFileSync(file, "utf8")) as {
      shared: { packs: unknown[]; stickers: Record<string, unknown>[] };
    };
    index.shared.packs = []; // the pack is gone: its sticker must be ungrouped
    index.shared.stickers = [
      ...index.shared.stickers,
      { ...sticker, id: "../../etc/passwd" },
      { ...sticker, id: "00000000-0000-0000-0000-000000000000", hash: "nope" },
      { ...sticker, id: "11111111-1111-1111-1111-111111111111", contentType: "image/svg+xml" },
      { ...sticker, id: "22222222-2222-2222-2222-222222222222", name: "" },
    ];
    writeFileSync(file, JSON.stringify(index));

    const again = new StickerStore(dir);
    expect(again.list(SHARED).stickers.map((s) => [s.name, s.packId])).toEqual([["Cat", null]]);
  });

  it("starts over on a corrupt index", () => {
    writeFileSync(path.join(dir, "index.json"), "{nope");
    const store = new StickerStore(dir);
    expect(store.list(SHARED).stickers).toEqual([]);
    expect(store.list(ALICE).stickers).toEqual([]);
  });

  it("writes the index atomically", () => {
    const store = new StickerStore(dir);
    add(store, SHARED, "Cat");
    expect(readdirSync(dir).some((f) => f.endsWith(".tmp"))).toBe(false);
  });
});

describe("StickerStore: an index it could not read", () => {
  /** One picture on disk, and the index replaced by whatever `breakIndex` puts there. */
  function brokenStore(breakIndex: (indexFile: string) => void): string[] {
    const store = new StickerStore(dir);
    add(store, SHARED, "one");
    const kept = blobs();
    breakIndex(path.join(dir, "index.json"));
    return kept;
  }

  // A directory where the index file goes: readFileSync fails with EISDIR, which
  // stands in for the EIO, EACCES or EBUSY a real disk hands us.
  const asDirectory = (indexFile: string) => {
    rmSync(indexFile);
    mkdirSync(indexFile);
  };

  it("sweeps nothing when the index file cannot be read", () => {
    const kept = brokenStore(asDirectory);
    const store = new StickerStore(dir);
    store.sweep();
    expect(blobs()).toEqual(kept);
  });

  it("sweeps nothing when the index file cannot be parsed", () => {
    const kept = brokenStore((indexFile) => writeFileSync(indexFile, "{ half"));
    const store = new StickerStore(dir);
    store.sweep();
    expect(blobs()).toEqual(kept);
  });

  it("leaves the unreadable index alone instead of writing an empty one over it", () => {
    brokenStore((indexFile) => writeFileSync(indexFile, "{ half"));
    const store = new StickerStore(dir);
    expect(() => add(store, SHARED, "another", OTHER)).not.toThrow();
    expect(readFileSync(path.join(dir, "index.json"), "utf8")).toBe("{ half");
  });

  it("still sweeps on a genuine first run, when there is no index at all", () => {
    const store = new StickerStore(dir);
    writeFileSync(path.join(dir, "blobs", "orphan.png"), "stray");
    store.sweep();
    expect(blobs()).toEqual([]);
  });
});
