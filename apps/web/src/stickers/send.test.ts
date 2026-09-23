import { describe, expect, it } from "vitest";
import type { FtEntry, Sticker } from "@jinz/protocol";
import type { Transfer } from "../files/transfer-queue";
import { createStickerSender, findStickerFile, type StickerSenderDeps } from "./send";

const NOW = new Date(2026, 8, 19, 7, 5, 3);
const STAMP = Math.floor(NOW.getTime() / 1000);
const HASH = `abc123def456${"0".repeat(52)}`;
/** What stickerFileName() makes of that hash. */
const FILE = "sticker_abc123def456.png";

const STICKER: Sticker = {
  id: "s1",
  name: "Happy cat",
  packId: null,
  hash: HASH,
  contentType: "image/png",
  bytes: 1234,
  addedBy: "alice",
  addedAt: 0,
};

const entry = (over: Partial<FtEntry> & { name: string }): FtEntry => ({
  size: 999,
  datetime: 111,
  isDir: false,
  ...over,
});

const transfer = (over: Partial<Transfer> = {}): Transfer => ({
  id: "ft1",
  kind: "upload",
  cid: "5",
  path: `/imgs/${FILE}`,
  name: FILE,
  size: 1234,
  loaded: 1234,
  state: "done",
  origin: "chat",
  ...over,
});

function setup(over: Partial<StickerSenderDeps> = {}) {
  const sent: Array<[string, string]> = [];
  const uploads: Array<[string, string, string]> = [];
  const deps: StickerSenderDeps = {
    channelFor: (conv) => (conv.startsWith("channel:") ? conv.slice(8) : "9"),
    ensureFolder: async () => "ready",
    listEntries: async () => [],
    fetchImage: async () => new Blob([new Uint8Array(4)]),
    upload: (cid, dir, _file, name) => {
      uploads.push([cid, dir, name]);
      return `ft${uploads.length}`;
    },
    waitFor: async () => transfer(),
    sendText: (conv, text) => sent.push([conv, text]),
    server: () => ({ host: "ts.example", port: 9987 }),
    now: () => NOW,
    ...over,
  };
  return { sender: createStickerSender(deps), deps, sent, uploads };
}

describe("findStickerFile", () => {
  it("finds the file by name, ignoring case", () =>
    expect(findStickerFile([entry({ name: FILE.toUpperCase() })], FILE)?.size).toBe(999));

  it("does not take a folder of that name for the file", () =>
    expect(findStickerFile([entry({ name: FILE, isDir: true })], FILE)).toBeNull());

  it("answers nothing for an unlistable folder or an empty name", () => {
    expect(findStickerFile(null, FILE)).toBeNull();
    expect(findStickerFile([entry({ name: FILE })], "")).toBeNull();
  });
});

describe("sending a sticker", () => {
  it("uploads it into /imgs under its hash name, then sends the link", async () => {
    const s = setup();
    const result = await s.sender.send("channel:5", STICKER);
    expect(result).toEqual({ ok: true, uploaded: true });
    expect(s.uploads).toEqual([["5", "/imgs", FILE]]);
    expect(s.sent).toEqual([
      [
        "channel:5",
        `[URL=ts3file://ts.example?port=9987&channel=5&path=/imgs&filename=${FILE}` +
          `&isDir=0&size=1234&fileDateTime=${STAMP}]${FILE}[/URL]`,
      ],
    ]);
  });

  it("reuses the channel's copy instead of uploading a second time", async () => {
    const s = setup({ listEntries: async () => [entry({ name: FILE, size: 4321, datetime: 77 })] });
    const result = await s.sender.send("channel:5", STICKER);
    expect(result).toEqual({ ok: true, uploaded: false });
    expect(s.uploads).toEqual([]);
    // The link describes the file that is really there, not what we would have sent.
    expect(s.sent[0]![1]).toContain("size=4321");
    expect(s.sent[0]![1]).toContain("fileDateTime=77");
  });

  it("takes the server's 'file exists' as the file being there", async () => {
    const s = setup({ waitFor: async () => transfer({ state: "failed", code: "2050" }) });
    const result = await s.sender.send("channel:5", STICKER);
    expect(result).toEqual({ ok: true, uploaded: false });
    expect(s.sent).toHaveLength(1);
  });

  it("sends nothing when the upload fails for any other reason", async () => {
    const s = setup({
      waitFor: async () => transfer({ state: "failed", code: "2568", error: "no power" }),
    });
    expect(await s.sender.send("channel:5", STICKER)).toMatchObject({ ok: false, error: "failed" });
    expect(s.sent).toEqual([]);
  });

  it("sends nothing when the picture cannot be fetched from the hub", async () => {
    const s = setup({ fetchImage: () => Promise.reject(new Error("offline")) });
    expect(await s.sender.send("channel:5", STICKER)).toMatchObject({ ok: false, error: "failed" });
    expect(s.sent).toEqual([]);
  });

  it("falls back to the channel's root when the folder cannot be made", async () => {
    const s = setup({ ensureFolder: async () => "unavailable" });
    await s.sender.send("channel:5", STICKER);
    expect(s.uploads).toEqual([["5", "/", FILE]]);
    expect(s.sent[0]![1]).toContain("path=/&");
  });

  it("uploads when the folder cannot be listed, rather than guessing it is there", async () => {
    const s = setup({ listEntries: async () => null });
    expect(await s.sender.send("channel:5", STICKER)).toMatchObject({ uploaded: true });
    expect(s.uploads).toHaveLength(1);
  });

  it("puts a private chat's picture in your own channel", async () => {
    const s = setup();
    await s.sender.send("client:12", STICKER);
    expect(s.uploads[0]![0]).toBe("9");
  });

  it("fails without a channel to put it in, and uploads nothing", async () => {
    const s = setup({ channelFor: () => null });
    expect(await s.sender.send("server", STICKER)).toEqual({
      ok: false,
      error: "noChannel",
      uploaded: false,
    });
    expect(s.uploads).toEqual([]);
  });

  it("does not drop the link into another channel's chat when you moved meanwhile", async () => {
    let own = "9";
    const s = setup({
      channelFor: (conv) => (conv.startsWith("channel:") ? conv.slice(8) : own),
      waitFor: async () => {
        own = "12"; // moved while it was uploading
        return transfer();
      },
    });
    expect(await s.sender.send("server", STICKER)).toMatchObject({
      ok: false,
      error: "movedAway",
      cid: "9",
    });
    expect(s.sent).toEqual([]);
  });

  it("refuses a sticker whose hash is not one of ours", async () => {
    const s = setup();
    const result = await s.sender.send("channel:5", { ...STICKER, hash: "nope" });
    expect(result).toMatchObject({ ok: false, error: "failed" });
    expect(s.uploads).toEqual([]);
  });
});
