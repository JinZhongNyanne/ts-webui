import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, defineStore, setActivePinia } from "pinia";
import type { FtDownloadTicket, FtMediaTicket, FtUploadResult } from "@jinz/protocol";
import { FileTransferError, CANCELLED, type UploadRequest } from "../files/http";
import { createTransfersStore, type TransferContext } from "./transfers";

interface PendingUpload {
  req: UploadRequest;
  resolve: (r: FtUploadResult) => void;
  reject: (e: unknown) => void;
}

function harness(overrides: Partial<TransferContext> = {}) {
  const uploads: PendingUpload[] = [];
  const downloads: string[] = [];
  let onGone: (() => void) | null = null;
  const ctx: TransferContext = {
    sessionId: () => "s1",
    limits: () => ({ maxUploadBytes: 1000, maxTransfers: 3 }),
    quotaMb: () => undefined,
    channelPassword: (cid) => (cid === "7" ? "remembered" : ""),
    rememberPassword: vi.fn(),
    forgetPassword: vi.fn(),
    onSessionGone: (fn) => {
      onGone = fn;
    },
    now: () => Date.now(),
    http: {
      uploadFile: (req) =>
        new Promise<FtUploadResult>((resolve, reject) => {
          uploads.push({ req, resolve, reject });
          req.signal?.addEventListener("abort", () =>
            reject(new FileTransferError(CANCELLED, "cancelled")),
          );
        }),
      requestDownloadLink: vi.fn(async (_s, req): Promise<FtDownloadTicket> => ({
        url: `/api/files/download/${"t".repeat(32)}`,
        expiresAt: 0,
        size: 9,
        name: req.path.slice(1),
      })),
      startBrowserDownload: (url) => void downloads.push(url),
      fetchDownload: vi.fn(async () => new Blob(["img"])),
    },
    ...overrides,
  };
  const store = defineStore(`transfers-${Math.random()}`, createTransfersStore(ctx))();
  return { store, uploads, downloads, ctx, gone: () => onGone?.() };
}

/** A browser File: a Blob with a name. */
const named = (size: number, name = "a.txt") =>
  Object.assign(new Blob([new Uint8Array(size)]), { name }) as unknown as File;

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => vi.useRealTimers());

const busy = () => new FileTransferError("busy", "Too many transfers at once");

describe("transfers store", () => {
  it("uploads into a folder with the remembered channel password", async () => {
    const { store, uploads } = harness();
    const id = store.uploadFile("7", "/docs", named(10, "报告.txt"));
    expect(store.items[0]).toMatchObject({
      id,
      kind: "upload",
      path: "/docs/报告.txt",
      state: "running",
    });
    expect(uploads[0]!.req).toMatchObject({ cid: "7", path: "/docs/报告.txt", cpw: "remembered" });
    uploads[0]!.req.onProgress?.(4);
    expect(store.items[0]!.loaded).toBe(4);
    uploads[0]!.resolve({ path: "/docs/报告.txt", size: 10 });
    await expect(store.waitFor(id)).resolves.toMatchObject({ state: "done", loaded: 10 });
  });

  it("refuses a file over the limit without sending it", async () => {
    const { store, uploads } = harness({ quotaMb: () => 0 });
    const id = store.uploadFile("5", "/", named(10));
    expect(uploads).toHaveLength(0);
    const t = await store.waitFor(id);
    expect(t.state).toBe("failed");
    expect(t.error).toBeTruthy();
  });

  it("runs at most two at once and starts the next when one ends", async () => {
    const { store, uploads } = harness();
    const ids = [1, 2, 3].map((n) => store.uploadFile("5", "/", named(1, `${n}.txt`)));
    expect(store.items.map((t) => t.state)).toEqual(["running", "running", "queued"]);
    uploads[0]!.resolve({ path: "/1.txt", size: 1 });
    await store.waitFor(ids[0]!);
    expect(store.items[2]!.state).toBe("running");
    expect(uploads).toHaveLength(3);
  });

  it("cancels a running upload by aborting it", async () => {
    const { store, uploads } = harness();
    const id = store.uploadFile("5", "/", named(5));
    store.cancel(id);
    expect(uploads[0]!.req.signal?.aborted).toBe(true);
    await expect(store.waitFor(id)).resolves.toMatchObject({ state: "cancelled" });
  });

  it("keeps the translated reason of a refusal", async () => {
    const { store, uploads } = harness();
    const id = store.uploadFile("5", "/", named(5));
    uploads[0]!.reject(new FileTransferError("781", "Wrong channel password"));
    await expect(store.waitFor(id)).resolves.toMatchObject({
      state: "failed",
      error: "Wrong channel password",
    });
  });

  it("downloads through a one-use link handed to the browser", async () => {
    const { store, downloads, ctx } = harness();
    const id = store.downloadFile("7", "/b.bin");
    const t = await store.waitFor(id);
    expect(t).toMatchObject({ state: "done", size: 9 });
    expect(ctx.http.requestDownloadLink).toHaveBeenCalledWith("s1", {
      cid: "7",
      path: "/b.bin",
      cpw: "remembered",
    });
    expect(downloads).toEqual([`/api/files/download/${"t".repeat(32)}`]);
  });

  it("refuses bad paths up front", async () => {
    const { store } = harness();
    await expect(store.waitFor(store.downloadFile("5", "/../x"))).resolves.toMatchObject({
      state: "failed",
    });
    await expect(store.waitFor(store.uploadFile("5", "/", named(1, "..")))).resolves.toMatchObject({
      state: "failed",
    });
  });

  it("fails what is left when the session goes away", async () => {
    const { store, uploads, gone } = harness();
    const a = store.uploadFile("5", "/", named(1, "1.txt"));
    store.uploadFile("5", "/", named(1, "2.txt"));
    store.uploadFile("5", "/", named(1, "3.txt"));
    gone();
    expect(uploads[0]!.req.signal?.aborted).toBe(true);
    expect(store.items.every((t) => t.state === "failed")).toBe(true);
    await expect(store.waitFor(a)).resolves.toMatchObject({ state: "failed" });
  });

  it("clears finished transfers", async () => {
    const { store, uploads } = harness();
    const id = store.uploadFile("5", "/", named(1));
    uploads[0]!.resolve({ path: "/a.txt", size: 1 });
    await store.waitFor(id);
    store.clearFinished();
    expect(store.items).toEqual([]);
  });

  it("waits and tries again while the hub is busy, instead of failing", async () => {
    vi.useFakeTimers();
    const requestDownloadLink = vi
      .fn<TransferContext["http"]["requestDownloadLink"]>()
      .mockRejectedValueOnce(busy())
      .mockRejectedValueOnce(busy())
      .mockResolvedValue({ url: "/api/files/download/x", expiresAt: 0, size: 3, name: "b" });
    const { store, ctx, downloads } = harness();
    ctx.http.requestDownloadLink = requestDownloadLink;
    const id = store.downloadFile("5", "/b");
    await vi.advanceTimersByTimeAsync(0);
    expect(store.items[0]).toMatchObject({ state: "queued" });
    expect(store.items[0]!.waitUntil).toBeGreaterThan(Date.now());
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(store.waitFor(id)).resolves.toMatchObject({ state: "done", size: 3 });
    expect(requestDownloadLink).toHaveBeenCalledTimes(3);
    expect(downloads).toEqual(["/api/files/download/x"]);
  });

  it("lets others start while one waits for the hub", async () => {
    vi.useFakeTimers();
    const { store, uploads, ctx } = harness();
    ctx.http.requestDownloadLink = vi.fn().mockRejectedValue(busy());
    store.downloadFile("5", "/a");
    store.downloadFile("5", "/b");
    await vi.advanceTimersByTimeAsync(0);
    store.uploadFile("5", "/", named(1));
    expect(uploads).toHaveLength(1);
  });

  it("keeps the failure's code", async () => {
    const { store, uploads } = harness();
    const id = store.uploadFile("5", "/", named(5));
    uploads[0]!.reject(new FileTransferError("2050", "File exists"));
    await expect(store.waitFor(id)).resolves.toMatchObject({ state: "failed", code: "2050" });
  });

  it("remembers a channel password once the server took it", async () => {
    const { store, ctx, uploads } = harness();
    await store.waitFor(store.downloadFile("5", "/b", "typed"));
    expect(ctx.rememberPassword).toHaveBeenCalledWith("5", "typed");
    const up = store.uploadFile("6", "/", named(1), { cpw: "other" });
    uploads[0]!.resolve({ path: "/a.txt", size: 1 });
    await store.waitFor(up);
    expect(ctx.rememberPassword).toHaveBeenCalledWith("6", "other");
  });

  it("never remembers a refused password, and forgets a known one the server refuses", async () => {
    const refused = vi.fn().mockRejectedValue(new FileTransferError("781", "Wrong password"));
    const { store, ctx } = harness();
    ctx.http.requestDownloadLink = refused;
    await store.waitFor(store.downloadFile("5", "/b", "guess"));
    expect(ctx.rememberPassword).not.toHaveBeenCalled();
    expect(ctx.forgetPassword).not.toHaveBeenCalled();
    // The remembered one of channel 7 was changed on the server.
    await store.waitFor(store.downloadFile("7", "/b"));
    expect(ctx.forgetPassword).toHaveBeenCalledWith("7");
  });

  it("starts internal uploads ahead of the line and past the limit", () => {
    const { store, uploads } = harness();
    store.uploadFile("5", "/", named(1, "1.txt"));
    store.uploadFile("5", "/", named(1, "2.txt"));
    store.uploadFile("5", "/", named(1, "3.txt"));
    const id = store.uploadFile("0", "/", named(1, "avatar"), { origin: "internal" });
    expect(uploads.map((u) => u.req.path)).toEqual(["/1.txt", "/2.txt", "/avatar"]);
    expect(store.items.find((t) => t.id === id)).toMatchObject({ origin: "internal" });
  });

  it("cancels through the caller's signal", async () => {
    const { store, uploads } = harness();
    const abort = new AbortController();
    const id = store.uploadFile("0", "/", named(1), { origin: "internal", signal: abort.signal });
    abort.abort();
    expect(uploads[0]!.req.signal?.aborted).toBe(true);
    await expect(store.waitFor(id)).resolves.toMatchObject({ state: "cancelled" });
  });

  it("fetches a small file into memory through the same line", async () => {
    const { store, ctx } = harness();
    const blob = await store.fetchFile("7", "/pic.png", { maxBytes: 100 });
    expect(await blob.text()).toBe("img");
    expect(ctx.http.fetchDownload).toHaveBeenCalledWith(
      `/api/files/download/${"t".repeat(32)}`,
      expect.any(AbortSignal),
    );
    expect(store.items[0]).toMatchObject({ origin: "chat", state: "done" });
  });

  it("refuses to fetch more than asked for", async () => {
    const { store, ctx } = harness();
    await expect(store.fetchFile("7", "/pic.png", { maxBytes: 5 })).rejects.toThrow();
    expect(ctx.http.fetchDownload).not.toHaveBeenCalled();
  });

  it("waits its turn to fetch like any other transfer", () => {
    const { store, uploads, ctx } = harness();
    store.uploadFile("5", "/", named(1, "1.txt"));
    store.uploadFile("5", "/", named(1, "2.txt"));
    void store.fetchFile("7", "/pic.png", { maxBytes: 100 });
    expect(uploads).toHaveLength(2);
    expect(ctx.http.requestDownloadLink).not.toHaveBeenCalled();
  });
});

describe("media links", () => {
  const LINK: FtMediaTicket = {
    url: `/api/files/media/${"m".repeat(32)}`,
    expiresAt: 600_000,
    size: 5_000_000,
    name: "clip.webm",
    type: "video/webm",
  };
  const streaming = () => ({ maxUploadBytes: 1000, maxTransfers: 3, mediaStreaming: true });

  it("are asked for only when the hub says it serves them", async () => {
    const requestMediaLink = vi.fn(async () => LINK);
    const old = harness({ requestMediaLink });
    expect(old.store.mediaStreaming).toBe(false);
    await expect(old.store.mediaLink("7", "/clip.webm")).resolves.toBeNull();
    expect(requestMediaLink).not.toHaveBeenCalled();

    const current = harness({ requestMediaLink, limits: streaming });
    expect(current.store.mediaStreaming).toBe(true);
    await expect(current.store.mediaLink("7", "/clip.webm")).resolves.toEqual(LINK);
    expect(requestMediaLink).toHaveBeenCalledWith("s1", {
      cid: "7",
      path: "/clip.webm",
      cpw: "remembered",
    });
  });

  it("remember a password the server took and forget a known one it refused", async () => {
    const took = harness({ requestMediaLink: async () => LINK, limits: streaming });
    await took.store.mediaLink("5", "/clip.webm", "typed");
    expect(took.ctx.rememberPassword).toHaveBeenCalledWith("5", "typed");

    const refused = new FileTransferError("781", "wrong password");
    const known = harness({
      requestMediaLink: async () => Promise.reject(refused),
      limits: streaming,
    });
    await expect(known.store.mediaLink("7", "/clip.webm")).rejects.toBe(refused);
    expect(known.ctx.forgetPassword).toHaveBeenCalledWith("7");
    expect(known.ctx.rememberPassword).not.toHaveBeenCalled();
  });

  it("refuse a bad path without asking", async () => {
    const requestMediaLink = vi.fn(async () => LINK);
    const { store } = harness({ requestMediaLink, limits: streaming });
    await expect(store.mediaLink("7", "/../clip.webm")).rejects.toThrow();
    expect(requestMediaLink).not.toHaveBeenCalled();
  });
});
