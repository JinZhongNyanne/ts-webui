import { describe, expect, it } from "vitest";
import {
  MAX_PERSONAL_STICKERS,
  MAX_STICKER_BYTES,
  MAX_STICKER_PIXELS,
  type Sticker,
  type StickerPack,
} from "@jinz/protocol";
import {
  MAX_RECENT_STICKERS,
  checkStickerFile,
  checkStickerPixels,
  groupStickers,
  matchesSticker,
  pruneRecent,
  pushRecent,
  recentStickers,
} from "./rules";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const TEXT = Uint8Array.from([..."<html>"].map((c) => c.charCodeAt(0)));

const sticker = (over: Partial<Sticker> & { id: string }): Sticker => ({
  name: over.id,
  packId: null,
  hash: "a".repeat(64),
  contentType: "image/png",
  bytes: 10,
  addedBy: "alice",
  addedAt: 0,
  ...over,
});

const pack = (id: string, name = id): StickerPack => ({ id, name, createdAt: 0 });

describe("checkStickerFile", () => {
  it("lets a small picture through", () =>
    expect(checkStickerFile(100, PNG, "shared", 0)).toBeNull());

  it("refuses an empty file", () => expect(checkStickerFile(0, PNG, "shared", 0)).toBe("empty"));

  it("refuses one over the byte cap before reading it", () =>
    expect(checkStickerFile(MAX_STICKER_BYTES + 1, PNG, "shared", 0)).toBe("tooBig"));

  it("refuses what is not a picture, whatever it is called", () =>
    expect(checkStickerFile(100, TEXT, "shared", 0)).toBe("type"));

  it("refuses when the scope is full, with each scope's own cap", () => {
    expect(checkStickerFile(100, PNG, "personal", MAX_PERSONAL_STICKERS)).toBe("full");
    expect(checkStickerFile(100, PNG, "shared", MAX_PERSONAL_STICKERS)).toBeNull();
  });

  it("names the worst problem first: size before type", () =>
    expect(checkStickerFile(MAX_STICKER_BYTES + 1, TEXT, "shared", 0)).toBe("tooBig"));
});

describe("checkStickerPixels", () => {
  it("takes a picture within the cap", () =>
    expect(checkStickerPixels(MAX_STICKER_PIXELS, 64)).toBeNull());

  it("refuses one too big in either direction", () => {
    expect(checkStickerPixels(MAX_STICKER_PIXELS + 1, 10)).toBe("tooLarge");
    expect(checkStickerPixels(10, MAX_STICKER_PIXELS + 1)).toBe("tooLarge");
  });
});

describe("groupStickers", () => {
  it("puts each sticker under its pack, packs in order", () => {
    const packs = [pack("p1", "Memes"), pack("p2", "Cats")];
    const stickers = [
      sticker({ id: "a", packId: "p2" }),
      sticker({ id: "b", packId: "p1" }),
      sticker({ id: "c" }),
    ];
    expect(
      groupStickers(packs, stickers).map((g) => [
        g.pack?.name ?? null,
        g.stickers.map((s) => s.id),
      ]),
    ).toEqual([
      ["Memes", ["b"]],
      ["Cats", ["a"]],
      [null, ["c"]],
    ]);
  });

  it("keeps an empty pack, as somewhere to put things", () =>
    expect(groupStickers([pack("p1")], []).map((g) => g.stickers)).toEqual([[]]));

  it("leaves out 'ungrouped' when nothing is loose", () =>
    expect(groupStickers([pack("p1")], [sticker({ id: "a", packId: "p1" })])).toHaveLength(1));

  it("shows a sticker whose pack is gone as ungrouped", () =>
    expect(groupStickers([], [sticker({ id: "a", packId: "vanished" })])).toEqual([
      { pack: null, stickers: [expect.objectContaining({ id: "a" })] },
    ]));
});

describe("matchesSticker", () => {
  const cat = sticker({ id: "1", name: "Happy Cat" });

  it("matches any part of the name, ignoring case", () => {
    expect(matchesSticker(cat, "cat")).toBe(true);
    expect(matchesSticker(cat, "PY C")).toBe(true);
    expect(matchesSticker(cat, "dog")).toBe(false);
  });

  it("matches everything on an empty or blank query", () => {
    expect(matchesSticker(cat, "")).toBe(true);
    expect(matchesSticker(cat, "   ")).toBe(true);
  });
});

describe("the recently-used list", () => {
  it("puts the newest first without a second copy, leaving the old list alone", () => {
    const first = pushRecent([], "a");
    const second = pushRecent(pushRecent(first, "b"), "a");
    expect(second).toEqual(["a", "b"]);
    expect(first).toEqual(["a"]);
  });

  it("stops at the cap", () => {
    let recent: string[] = [];
    for (let i = 0; i < MAX_RECENT_STICKERS + 5; i++) recent = pushRecent(recent, `s${i}`);
    expect(recent).toHaveLength(MAX_RECENT_STICKERS);
    expect(recent[0]).toBe(`s${MAX_RECENT_STICKERS + 4}`);
  });

  it("drops ids nothing answers to any more", () =>
    expect(pruneRecent(["a", "gone", "b"], [sticker({ id: "a" }), sticker({ id: "b" })])).toEqual([
      "a",
      "b",
    ]));

  it("resolves to stickers in the remembered order, skipping the missing", () =>
    expect(
      recentStickers(["b", "gone", "a"], [sticker({ id: "a" }), sticker({ id: "b" })]).map(
        (s) => s.id,
      ),
    ).toEqual(["b", "a"]));
});
