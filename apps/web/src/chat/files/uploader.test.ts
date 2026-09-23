import { describe, expect, it, vi } from "vitest";
import type { Transfer } from "../../files/transfer-queue";
import { createUploader, type ChatUpload, type UploaderDeps } from "./uploader";

const NOW = new Date(2026, 8, 19, 7, 5, 3);

function setup(over: Partial<UploaderDeps> = {}) {
  let list: readonly ChatUpload[] = [];
  const finish = new Map<string, (t: Transfer) => void>();
  const sent: Array<[string, string]> = [];
  const uploads: Array<[string, string, string]> = [];
  const seeded: Array<[string, string, string]> = [];
  const deps: UploaderDeps = {
    keepPreview: (cid, path, f) => seeded.push([cid, path, f.name]),
    channelFor: (conv) => (conv.startsWith("channel:") ? conv.slice(8) : "9"),
    listNames: async () => new Set(["a.txt"]),
    ensureFolder: async () => "ready",
    upload: (cid, dir, _file, name) => {
      uploads.push([cid, dir, name]);
      return `ft${uploads.length}`;
    },
    waitFor: (id) => new Promise((resolve) => finish.set(id, resolve)),
    cancelTransfer: vi.fn(),
    sendText: (conv, text) => sent.push([conv, text]),
    server: () => ({ host: "ts.example", port: 9987 }),
    now: () => NOW,
    text: (key, params) => `text:${key}${params ? `:${params.channel}` : ""}`,
    ...over,
  };
  const uploader = createUploader(
    deps,
    () => list,
    (next) => (list = next),
  );
  const settle = (id: string, t: Partial<Transfer>) =>
    finish.get(id)!({
      id,
      kind: "upload",
      cid: "5",
      path: "/a (2).txt",
      name: "a (2).txt",
      size: 3,
      loaded: 3,
      state: "done",
      ...t,
    });
  return { uploader, deps, sent, uploads, seeded, settle, list: () => list };
}

const file = (name: string, type = "") => new File(["abc"], name, { type });
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("chat file uploader", () => {
  it("uploads into /files under a free name, then sends the link to that path", async () => {
    const s = setup();
    const done = s.uploader.attach("channel:5", file("a.txt"));
    await tick();
    expect(s.uploads).toEqual([["5", "/files", "a (2).txt"]]);
    expect(s.list()).toMatchObject([
      { conversation: "channel:5", name: "a (2).txt", state: "uploading", transferId: "ft1" },
    ]);
    s.settle("ft1", { path: "/files/a (2).txt" });
    await done;
    expect(s.sent).toEqual([
      [
        "channel:5",
        `[URL=ts3file://ts.example?port=9987&channel=5&path=/files&filename=a%20(2).txt&isDir=0&size=3&fileDateTime=${Math.floor(NOW.getTime() / 1000)}]a (2).txt[/URL]`,
      ],
    ]);
    expect(s.list()).toEqual([]);
  });

  it("puts pictures in /imgs and everything else in /files", async () => {
    const s = setup({ listNames: async () => new Set() });
    void s.uploader.attach("channel:5", file("cat.png", "image/png"));
    await tick();
    void s.uploader.attach("channel:5", file("notes.txt"));
    await tick();
    expect(s.uploads.map((u) => u[1])).toEqual(["/imgs", "/files"]);
  });

  it("falls back to the channel's root when the folder cannot be made, and says nothing", async () => {
    const s = setup({ ensureFolder: async () => "unavailable" });
    const done = s.uploader.attach("channel:5", file("cat.png", "image/png"));
    await tick();
    expect(s.uploads[0]![1]).toBe("/");
    s.settle("ft1", { path: "/cat.png" });
    await done;
    expect(s.list()).toEqual([]);
    expect(s.sent[0]![1]).toContain("path=/&");
  });

  it("falls back to the root when creating the folder throws outright", async () => {
    const s = setup({ ensureFolder: () => Promise.reject(new Error("offline")) });
    void s.uploader.attach("channel:5", file("cat.png", "image/png"));
    await tick();
    expect(s.uploads[0]![1]).toBe("/");
  });

  it("lists the folder it will use, not the channel's root", async () => {
    const seen: Array<[string, string]> = [];
    const s = setup({
      listNames: async (cid, dir) => {
        seen.push([cid, dir]);
        return new Set();
      },
    });
    void s.uploader.attach("channel:5", file("cat.png", "image/png"));
    await tick();
    expect(seen).toEqual([["5", "/imgs"]]);
  });

  it("does not send the link to the wrong chat when you moved meanwhile", async () => {
    let own = "9";
    const s = setup({
      channelFor: (conv) => (conv.startsWith("channel:") ? conv.slice(8) : own),
      channelName: () => "Lobby",
    });
    const done = s.uploader.attach("server", file("a.txt"));
    await tick();
    own = "12"; // moved while it was uploading
    s.settle("ft1", {});
    await done;
    expect(s.sent).toEqual([]);
    expect(s.list()).toMatchObject([{ state: "failed", error: "text:movedAway:Lobby" }]);
  });

  it("puts private and server chat files into your own channel", async () => {
    const s = setup();
    void s.uploader.attach("client:12", file("b.txt"));
    await tick();
    expect(s.uploads[0]![0]).toBe("9");
  });

  it("stamps the name when the folder cannot be listed", async () => {
    const s = setup({ listNames: async () => null });
    void s.uploader.attach("channel:5", file("a.txt"));
    await tick();
    expect(s.uploads[0]![2]).toBe("a_20260919-070503.txt");
  });

  it("also when listing throws", async () => {
    const s = setup({ listNames: () => Promise.reject(new Error("2568")) });
    void s.uploader.attach("channel:5", file("a.txt"));
    await tick();
    expect(s.uploads[0]![2]).toBe("a_20260919-070503.txt");
  });

  it("names pasted images itself", async () => {
    const s = setup();
    void s.uploader.attach("channel:5", file("image.png", "image/png"), { pasted: true });
    await tick();
    expect(s.uploads[0]![2]).toBe("image_20260919-070503.png");
  });

  it("cleans up odd browser names", async () => {
    const s = setup();
    void s.uploader.attach("channel:5", file('x:y?"z".txt'));
    await tick();
    expect(s.uploads[0]![2]).toBe("x_y__z_.txt");
  });

  it("keeps a failure, with the reason, until dismissed; sends nothing", async () => {
    const s = setup();
    const done = s.uploader.attach("channel:5", file("a.txt"));
    await tick();
    s.settle("ft1", { state: "failed", error: "no permission" });
    await done;
    expect(s.sent).toEqual([]);
    expect(s.list()).toMatchObject([{ state: "failed", error: "no permission" }]);
    s.uploader.dismiss(s.list()[0]!.id);
    expect(s.list()).toEqual([]);
  });

  it("cancels the transfer and sends nothing", async () => {
    const s = setup();
    const done = s.uploader.attach("channel:5", file("a.txt"));
    await tick();
    s.uploader.cancel(s.list()[0]!.id);
    expect(s.deps.cancelTransfer).toHaveBeenCalledWith("ft1");
    expect(s.list()).toEqual([]);
    s.settle("ft1", { state: "cancelled" });
    await done;
    expect(s.sent).toEqual([]);
    expect(s.list()).toEqual([]);
  });

  it("stops before uploading when cancelled while the folder is listed", async () => {
    let release!: (names: Set<string>) => void;
    const s = setup({ listNames: () => new Promise((r) => (release = r)) });
    const done = s.uploader.attach("channel:5", file("a.txt"));
    await tick(); // the folder is made first, then listed
    s.uploader.cancel(s.list()[0]!.id);
    release(new Set());
    await done;
    expect(s.uploads).toEqual([]);
  });

  it("fails without a channel to put the file in", async () => {
    const s = setup({ channelFor: () => null });
    await s.uploader.attach("server", file("a.txt"));
    expect(s.list()).toMatchObject([{ state: "failed", error: "text:noChannel" }]);
  });

  it("fails on a name nothing usable is left of", async () => {
    const s = setup();
    await s.uploader.attach("channel:5", file(".."));
    expect(s.list()).toMatchObject([{ state: "failed", error: "text:badName" }]);
  });

  it("keeps the picture it just sent, so the sender sees their own sticker", async () => {
    const s = setup();
    const png = new File(["abc"], "cat.png", { type: "image/png" });
    const done = s.uploader.attach("channel:5", png);
    await tick();
    s.settle("ft1", { path: "/cat.png", name: "cat.png" });
    await done;
    expect(s.seeded).toEqual([["5", "/cat.png", "cat.png"]]);
  });

  it("keeps nothing for a file that is not a picture", async () => {
    const s = setup();
    const done = s.uploader.attach("channel:5", file("notes.txt"));
    await tick();
    s.settle("ft1", { path: "/notes.txt", name: "notes.txt" });
    await done;
    expect(s.seeded).toEqual([]);
  });

  it("keeps nothing when the link was never sent", async () => {
    const s = setup();
    const png = new File(["abc"], "cat.png", { type: "image/png" });
    const done = s.uploader.attach("channel:5", png);
    await tick();
    s.settle("ft1", { state: "failed", error: "nope" });
    await done;
    expect(s.seeded).toEqual([]);
  });
});
