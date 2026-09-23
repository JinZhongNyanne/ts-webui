import net from "node:net";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FT_MEDIA_OPENS_PER_MIN, type FtDownloadTicket, type FtMediaTicket } from "@jinz/protocol";
import { TsCommandFailure } from "../gateway/commands.js";
import { parsePermissionList } from "../gateway/perms.js";
import { registerEmptyBodyParser } from "../http/empty-body.js";
import { RateLimiter } from "../security/limits.js";
import { registerSecurityHeaders } from "../security/headers.js";
import type { Session } from "../session/Session.js";
import { SessionRegistry } from "../session/registry.js";
import type { FtDownloadTarget } from "./ft-init.js";
import { registerFileRoutes, type FileRouteDeps } from "./routes.js";

const KEY_LENGTH = 32;
/** What a held transfer sends before it stops (see fakeFilePort). */
const HELD_BYTES = 10;
const catalog = parsePermissionList([]);

/**
 * A file port that sends whatever bytes the key was issued for, then closes;
 * a key in `held` gets its first bytes only and is kept open, like a
 * transfer a player is still reading.
 */
async function fakeFilePort() {
  const sends = new Map<string, Buffer>();
  const held = new Set<string>();
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buf = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < KEY_LENGTH) return;
      const key = buf.subarray(0, KEY_LENGTH).toString();
      const bytes = sends.get(key);
      buf = Buffer.alloc(0);
      if (!bytes) return;
      if (held.has(key)) socket.write(bytes.subarray(0, HELD_BYTES));
      else socket.end(bytes);
    });
    socket.on("error", () => undefined);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    sends,
    held,
    close: () => {
      for (const s of sockets) s.destroy();
      return new Promise((r) => server.close(r));
    },
  };
}

const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

const CLIP = Buffer.from(Array.from({ length: 1_000 }, (_, i) => i % 251));

async function build(
  opts: {
    files?: Record<string, Buffer>;
    /** Whether the start notify's size is the whole file (TS3) or what is left of it. */
    announce?: "whole" | "rest";
    /** Which starts to hold open after their first bytes (a player still reading). */
    hold?: (path: string, from: number) => boolean;
    deps?: Partial<FileRouteDeps>;
    maxTransfers?: number;
    /** Keeps starts from these offsets waiting until the test lets them go. */
    gate?: { from: number; open: Promise<void> };
    /** Runs before every handler, as the hub's own async hooks do. */
    beforeHandler?: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  } = {},
) {
  const files = new Map(Object.entries(opts.files ?? { "/clip.webm": CLIP }));
  const port = await fakeFilePort();
  closers.push(port.close);
  let seq = 0;
  const ts = {
    fileTransferHost: "127.0.0.1",
    selfUid: "uid=",
    initFileDownload: vi.fn(async (t: FtDownloadTarget) => {
      const file = files.get(t.path);
      if (!file) throw new TsCommandFailure("2051", "file not found", null);
      if (t.cpw === "wrong") throw new TsCommandFailure("781", "invalid password", null);
      const from = t.seekpos ?? 0;
      if (opts.gate && from === opts.gate.from) await opts.gate.open;
      const key = `K${++seq}`.padEnd(KEY_LENGTH, "_");
      port.sends.set(key, file.subarray(from));
      if (opts.hold?.(t.path, from)) port.held.add(key);
      const size = opts.announce === "rest" ? file.length - from : file.length;
      return { serverFtId: seq, key, port: port.port, size };
    }),
    initFileUpload: vi.fn(),
    deleteFile: vi.fn(),
    ownPermission: () => undefined,
    permissionCatalog: async () => catalog,
  };
  const sessions = new Map<string, Session>(
    ["s1", "s2"].map((id) => [id, { id, tsSession: ts } as unknown as Session]),
  );
  const registry = new SessionRegistry();
  for (const session of sessions.values()) registry.add(session);
  // Held streams are still open when a test ends.
  const app = Fastify({ forceCloseConnections: true });
  registerSecurityHeaders(app, { isProd: false });
  registerEmptyBodyParser(app);
  if (opts.beforeHandler) app.addHook("preHandler", opts.beforeHandler);
  await registerFileRoutes(app, {
    registry: {
      getConnected: (id) => (id === undefined ? undefined : sessions.get(id)),
      onEnd: (listener) => registry.onEnd(listener),
    },
    limits: { maxUploadBytes: 1024, maxTransfers: opts.maxTransfers ?? 3 },
    ...opts.deps,
  });
  await app.ready();
  closers.push(() => app.close());
  return { app, ts, sessions, registry };
}

type App = Awaited<ReturnType<typeof build>>["app"];

const mediaTicket = (app: App, body: unknown, session = "s1") =>
  app.inject({
    method: "POST",
    url: "/api/files/media-ticket",
    headers: { "x-session-id": session, "content-type": "application/json" },
    payload: JSON.stringify(body),
  });

async function link(app: App, path = "/clip.webm", session = "s1"): Promise<FtMediaTicket> {
  const res = await mediaTicket(app, { cid: "5", path }, session);
  expect(res.statusCode).toBe(200);
  return res.json<FtMediaTicket>();
}

const get = (app: App, url: string, headers: Record<string, string> = {}) =>
  app.inject({ method: "GET", url, headers });

describe("media tickets", () => {
  it("need a connected session and a valid request", async () => {
    const { app, ts } = await build();
    expect((await mediaTicket(app, { cid: "5", path: "/clip.webm" }, "nobody")).statusCode).toBe(
      401,
    );
    expect((await mediaTicket(app, { cid: "5", path: "/../clip.webm" })).statusCode).toBe(400);
    expect((await mediaTicket(app, { cid: "5", path: "/" })).statusCode).toBe(400);
    expect(ts.initFileDownload).not.toHaveBeenCalled();
  });

  it("are refused for anything but video and audio, before the server is asked", async () => {
    const { app, ts } = await build({
      files: { "/page.html": Buffer.from("<script>alert(1)</script>"), "/a.svg": Buffer.from("x") },
    });
    for (const path of ["/page.html", "/a.svg"]) {
      const res = await mediaTicket(app, { cid: "5", path });
      expect(res.statusCode, path).toBe(415);
      expect(res.json()).toEqual({ error: "not_media", message: "media.notMedia" });
    }
    expect(ts.initFileDownload).not.toHaveBeenCalled();
  });

  it("start the file once and answer a link with its size and type", async () => {
    const { app, ts } = await build();
    const res = await mediaTicket(app, { cid: "5", path: "/clip.webm", cpw: "pw" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const grant = res.json<FtMediaTicket>();
    expect(grant).toMatchObject({ size: 1_000, name: "clip.webm", type: "video/webm" });
    expect(grant.url).toMatch(/^\/api\/files\/media\/[A-Za-z0-9_-]{32}$/);
    // The password stays on the hub.
    expect(grant.url).not.toContain("pw");
    expect(ts.initFileDownload).toHaveBeenCalledWith({
      cid: "5",
      path: "/clip.webm",
      cpw: "pw",
      seekpos: 0,
    });
  });

  it("pass on the server's refusal, translated", async () => {
    const { app } = await build();
    const res = await mediaTicket(app, { cid: "5", path: "/clip.webm", cpw: "wrong" });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "781", message: "tsErr.channelPassword" });
    expect((await mediaTicket(app, { cid: "5", path: "/gone.webm" })).statusCode).toBe(404);
  });
});

describe("the media route", () => {
  it("answers a range 206 from its start to the end, inline, from that seek position", async () => {
    const { app, ts } = await build();
    const { url } = await link(app);
    const res = await get(app, url, { range: "bytes=600-" });
    expect(res.statusCode).toBe(206);
    expect(res.headers["content-range"]).toBe("bytes 600-999/1000");
    expect(res.headers["content-length"]).toBe("400");
    expect(res.headers["accept-ranges"]).toBe("bytes");
    expect(res.headers["content-type"]).toBe("video/webm");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-disposition"]).toBeUndefined();
    expect(res.rawPayload.equals(CLIP.subarray(600))).toBe(true);
    expect(ts.initFileDownload).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: "/clip.webm", seekpos: 600 }),
    );
  });

  it("answers a closed range as open-ended, since TeamSpeak cannot stop early", async () => {
    const { app } = await build();
    const { url } = await link(app);
    const res = await get(app, url, { range: "bytes=100-199" });
    expect(res.statusCode).toBe(206);
    expect(res.headers["content-range"]).toBe("bytes 100-999/1000");
    expect(res.rawPayload.equals(CLIP.subarray(100))).toBe(true);
  });

  it("reads a start announced as what is left of the file just the same", async () => {
    const { app } = await build({ announce: "rest" });
    const { url } = await link(app);
    const res = await get(app, url, { range: "bytes=250-" });
    expect(res.statusCode).toBe(206);
    expect(res.headers["content-range"]).toBe("bytes 250-999/1000");
    expect(res.rawPayload.equals(CLIP.subarray(250))).toBe(true);
  });

  it("uses the transfer the ticket started for the first request from byte 0", async () => {
    const { app, ts } = await build();
    const { url } = await link(app);
    const res = await get(app, url, { range: "bytes=0-" });
    expect(res.statusCode).toBe(206);
    expect(res.headers["content-range"]).toBe("bytes 0-999/1000");
    expect(res.rawPayload.equals(CLIP)).toBe(true);
    expect(ts.initFileDownload).toHaveBeenCalledTimes(1);
    // Only once: the next request is a transfer of its own.
    expect((await get(app, url, { range: "bytes=0-" })).statusCode).toBe(206);
    expect(ts.initFileDownload).toHaveBeenCalledTimes(2);
  });

  it("serves the whole file 200 without a range, and many times", async () => {
    const { app } = await build();
    const { url } = await link(app);
    for (let i = 0; i < 3; i++) {
      const res = await get(app, url);
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-range"]).toBeUndefined();
      expect(res.headers["content-length"]).toBe("1000");
      expect(res.rawPayload.equals(CLIP)).toBe(true);
    }
  });

  it("answers HEAD from what the link knows, without asking the server", async () => {
    const { app, ts } = await build();
    const { url } = await link(app);
    const res = await app.inject({ method: "HEAD", url, headers: { range: "bytes=10-" } });
    expect(res.statusCode).toBe(206);
    expect(res.headers["content-range"]).toBe("bytes 10-999/1000");
    expect(res.headers["content-length"]).toBe("990");
    expect(res.headers["content-type"]).toBe("video/webm");
    expect(res.body).toBe("");
    expect(ts.initFileDownload).toHaveBeenCalledTimes(1);
  });

  it("says 416 for a range past the end, with the file's length", async () => {
    const { app } = await build();
    const { url } = await link(app);
    const res = await get(app, url, { range: "bytes=1000-" });
    expect(res.statusCode).toBe(416);
    expect(res.headers["content-range"]).toBe("bytes */1000");
    expect(res.headers["content-type"]).toBe("text/plain; charset=utf-8");
  });

  it("serves an empty file as an empty 200, not as an expired link", async () => {
    const { app, ts } = await build({ files: { "/empty.mp4": Buffer.alloc(0) } });
    const { url, size } = await link(app, "/empty.mp4");
    expect(size).toBe(0);
    for (const headers of [{}, { range: "bytes=0-" }, { range: "bytes=-5" }]) {
      const res = await get(app, url, headers);
      expect(res.statusCode, JSON.stringify(headers)).toBe(200);
      expect(res.headers["content-length"]).toBe("0");
      expect(res.headers["content-range"]).toBeUndefined();
      expect(res.headers["content-type"]).toBe("video/mp4");
      expect(res.rawPayload.length).toBe(0);
    }
    const head = await app.inject({ method: "HEAD", url, headers: { range: "bytes=0-" } });
    expect(head.statusCode).toBe(200);
    expect(head.headers["content-length"]).toBe("0");
    // Nothing to fetch: no transfer beyond the ticket's own.
    expect(ts.initFileDownload).toHaveBeenCalledTimes(1);
  });

  it("refuses a link that does not exist, as plain text", async () => {
    const { app } = await build();
    for (const url of ["/api/files/media/" + "a".repeat(32), "/api/files/media/nope"]) {
      const res = await get(app, url, { range: "bytes=0-" });
      expect(res.statusCode).toBe(410);
      expect(res.headers["content-type"]).toBe("text/plain; charset=utf-8");
      expect(res.headers["content-disposition"]).toBeUndefined();
    }
  });

  it("is a different credential from a download link, in both directions", async () => {
    const { app } = await build();
    const download = await app.inject({
      method: "POST",
      url: "/api/files/download-ticket",
      headers: { "x-session-id": "s1", "content-type": "application/json" },
      payload: JSON.stringify({ cid: "5", path: "/clip.webm" }),
    });
    const ticket = download.json<FtDownloadTicket>().url.split("/").pop()!;
    expect((await get(app, `/api/files/media/${ticket}`)).statusCode).toBe(410);
    const media = (await link(app)).url.split("/").pop()!;
    expect((await get(app, `/api/files/download/${media}`)).statusCode).toBe(410);
  });

  it("never honours a range on the download route, which stays an attachment", async () => {
    const { app } = await build();
    const download = await app.inject({
      method: "POST",
      url: "/api/files/download-ticket",
      headers: { "x-session-id": "s1", "content-type": "application/json" },
      payload: JSON.stringify({ cid: "5", path: "/clip.webm" }),
    });
    const res = await get(app, download.json<FtDownloadTicket>().url, { range: "bytes=10-" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-range"]).toBeUndefined();
    expect(String(res.headers["content-disposition"])).toMatch(/^attachment;/);
    expect(res.headers["content-type"]).toBe("application/octet-stream");
  });

  it("refuses a request another site makes, before the server is asked", async () => {
    const { app, ts } = await build();
    const { url } = await link(app);
    for (const site of ["cross-site", "same-site"]) {
      const res = await get(app, url, { range: "bytes=5-", "sec-fetch-site": site });
      expect(res.statusCode, site).toBe(403);
    }
    expect(ts.initFileDownload).toHaveBeenCalledTimes(1);
    const own = await get(app, url, { range: "bytes=5-", "sec-fetch-site": "same-origin" });
    expect(own.statusCode).toBe(206);
  });

  it("stops working when its session goes, or is connected somewhere else", async () => {
    const { app, sessions, ts } = await build();
    const first = await link(app);
    const second = await link(app, "/clip.webm", "s2");
    sessions.delete("s1");
    expect((await get(app, first.url, { range: "bytes=1-" })).statusCode).toBe(410);
    // The session reconnects: another TeamSpeak connection under the same id.
    sessions.set("s1", { id: "s1", tsSession: { ...ts } } as unknown as Session);
    expect((await get(app, first.url, { range: "bytes=1-" })).statusCode).toBe(410);
    sessions.set("s2", { id: "s2", tsSession: { ...ts } } as unknown as Session);
    expect((await get(app, second.url, { range: "bytes=1-" })).statusCode).toBe(410);
  });

  it("stops working after its lifetime", async () => {
    let now = 1_000;
    const { app } = await build({ deps: { media: { now: () => now, ttlMs: 5_000 } } });
    const { url, expiresAt } = await link(app);
    expect(expiresAt).toBe(6_000);
    expect((await get(app, url, { range: "bytes=1-" })).statusCode).toBe(206);
    now = 6_000;
    expect((await get(app, url, { range: "bytes=1-" })).statusCode).toBe(410);
  });

  it("is replaced by a new link to the same file", async () => {
    const { app } = await build();
    const first = await link(app);
    const second = await link(app);
    expect((await get(app, first.url, { range: "bytes=1-" })).statusCode).toBe(410);
    expect((await get(app, second.url, { range: "bytes=1-" })).statusCode).toBe(206);
  });

  it("spends the session's opens, twelve a minute by default", async () => {
    const { app, ts } = await build();
    const { url } = await link(app); // one open
    const answers: number[] = [];
    for (let i = 1; i <= FT_MEDIA_OPENS_PER_MIN; i++) {
      answers.push((await get(app, url, { range: `bytes=${i}-` })).statusCode);
    }
    expect(answers.slice(0, FT_MEDIA_OPENS_PER_MIN - 1).every((s) => s === 206)).toBe(true);
    expect(answers.at(-1)).toBe(429);
    expect(ts.initFileDownload).toHaveBeenCalledTimes(FT_MEDIA_OPENS_PER_MIN);
    // Another session has its own budget.
    const theirs = await link(app, "/clip.webm", "s2");
    expect((await get(app, theirs.url, { range: "bytes=1-" })).statusCode).toBe(206);
  });

  it("charges every open to the transfer budget downloads spend, as well", async () => {
    // Per session alone, ten sessions from one address would reach ten times
    // the operator's HUB_FT_RATE_PER_MIN of ftinitdownload a minute.
    const { app, ts } = await build({
      deps: { limiter: new RateLimiter({ limit: 3, windowMs: 60_000 }) },
    });
    const { url } = await link(app); // one
    expect((await get(app, url, { range: "bytes=1-" })).statusCode).toBe(206); // two
    expect((await get(app, url, { range: "bytes=2-" })).statusCode).toBe(206); // three
    // The media bucket still has room; the transfer budget does not.
    const res = await get(app, url, { range: "bytes=3-" });
    expect(res.statusCode).toBe(429);
    expect(res.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(ts.initFileDownload).toHaveBeenCalledTimes(3);
    // Another session of the same user, from the same address, shares it.
    expect((await mediaTicket(app, { cid: "5", path: "/clip.webm" }, "s2")).statusCode).toBe(429);
    expect(ts.initFileDownload).toHaveBeenCalledTimes(3);
  });

  it("shares the address's transfer budget with downloads", async () => {
    const { app } = await build({
      deps: { limiter: new RateLimiter({ limit: 2, windowMs: 60_000 }) },
    });
    await link(app);
    const download = await app.inject({
      method: "POST",
      url: "/api/files/download-ticket",
      headers: { "x-session-id": "s1", "content-type": "application/json" },
      payload: JSON.stringify({ cid: "5", path: "/clip.webm" }),
    });
    expect(download.statusCode).toBe(200);
    expect((await mediaTicket(app, { cid: "5", path: "/clip.webm" })).statusCode).toBe(429);
  });

  it("uses the first request's primed transfer without spending the budget again", async () => {
    const { app } = await build({
      deps: { limiter: new RateLimiter({ limit: 1, windowMs: 60_000 }) },
    });
    const { url } = await link(app);
    expect((await get(app, url, { range: "bytes=0-" })).statusCode).toBe(206);
  });

  it("refuses a new ticket once the opens are spent", async () => {
    const { app } = await build({
      deps: { media: { limiter: new RateLimiter({ limit: 1, windowMs: 60_000 }) } },
    });
    await link(app);
    expect((await mediaTicket(app, { cid: "5", path: "/clip.webm" })).statusCode).toBe(429);
  });
});

const addresses = new WeakMap<App, Promise<string>>();

/** The app on a real port (once), for requests that stay open. */
function addressOf(app: App): Promise<string> {
  const known = addresses.get(app);
  if (known) return known;
  const address = app.listen({ port: 0, host: "127.0.0.1" });
  addresses.set(app, address);
  return address;
}

describe("media streams and transfer slots", () => {
  /** Opens a request whose bytes the fake file port holds back, like a player still reading. */
  async function openHeld(app: App, url: string, from: number) {
    const address = await addressOf(app);
    const controller = new AbortController();
    const response = fetch(`${address}${url}`, {
      headers: { range: `bytes=${from}-` },
      signal: controller.signal,
    });
    return { response, abort: () => controller.abort() };
  }

  it("hold one slot per link: a seek takes over the slot of the stream it cuts", async () => {
    const { app, ts } = await build({ hold: (_, from) => from > 0, maxTransfers: 2 });
    const { url } = await link(app);
    const first = await openHeld(app, url, 100);
    await vi.waitFor(() => expect(ts.initFileDownload).toHaveBeenCalledTimes(2));
    const firstRes = await first.response;
    expect(firstRes.status).toBe(206);
    // maxTransfers 2 leaves downloads one slot; the seek must not need a second.
    const second = await openHeld(app, url, 500);
    const secondRes = await second.response;
    expect(secondRes.status).toBe(206);
    expect(secondRes.headers.get("content-range")).toBe("bytes 500-999/1000");
    // The first stream was cut when the second took its slot.
    await expect(firstRes.arrayBuffer()).rejects.toThrow();
    second.abort();
  });

  it("refuse a second link busy while the first holds the session's only download slot", async () => {
    const { app } = await build({
      hold: (path) => path === "/a.webm",
      maxTransfers: 2,
      files: { "/a.webm": CLIP, "/b.webm": CLIP },
    });
    const a = await link(app, "/a.webm");
    const b = await link(app, "/b.webm");
    const held = await openHeld(app, a.url, 1);
    expect((await held.response).status).toBe(206);
    const res = await get(app, b.url, { range: "bytes=1-" });
    expect(res.statusCode).toBe(429);
    held.abort();
    // The slot comes back when the player goes away.
    await vi.waitFor(async () =>
      expect((await get(app, b.url, { range: "bytes=900-" })).statusCode).toBe(206),
    );
  });

  it("leave a running stream playing when a seek is refused for its budget", async () => {
    const { app } = await build({
      hold: (_, from) => from > 0,
      deps: { media: { limiter: new RateLimiter({ limit: 2, windowMs: 60_000 }) } },
    });
    const { url } = await link(app); // the first open
    const held = await openHeld(app, url, 1); // the second
    const res = await held.response;
    expect(res.status).toBe(206);
    expect((await get(app, url, { range: "bytes=0-" })).statusCode).toBe(429);
    // Still running: the held stream's first bytes arrive, and it has not ended.
    const reader = res.body!.getReader();
    expect((await reader.read()).value?.length).toBeGreaterThan(0);
    held.abort();
  });

  it("come back when the player goes away while its transfer is still starting", async () => {
    let letGo = () => undefined as void;
    const open = new Promise<void>((r) => (letGo = r));
    const { app, ts } = await build({
      maxTransfers: 2,
      gate: { from: 7, open },
      files: { "/a.webm": CLIP, "/b.webm": CLIP },
    });
    const a = await link(app, "/a.webm");
    const b = await link(app, "/b.webm");
    const early = await openHeld(app, a.url, 7);
    await vi.waitFor(() => expect(ts.initFileDownload).toHaveBeenCalledTimes(3));
    early.abort();
    await expect(early.response).rejects.toThrow();
    // Gone before its start arrived: the slot is free again, and stays free.
    await vi.waitFor(async () =>
      expect((await get(app, b.url, { range: "bytes=900-" })).statusCode).toBe(206),
    );
    letGo();
    await new Promise((r) => setTimeout(r, 50));
    expect((await get(app, b.url, { range: "bytes=950-" })).statusCode).toBe(206);
  });

  it("come back when the player went away before the handler ran", async () => {
    // The socket can close while the hooks before the handler still run; a
    // `close` listener attached after that never fires, and the slot the
    // handler took was never given back.
    let reached = () => undefined as void;
    const inHook = new Promise<void>((r) => (reached = r));
    const { app, ts } = await build({
      maxTransfers: 2,
      files: { "/a.webm": CLIP, "/b.webm": CLIP },
      beforeHandler: async (request, reply) => {
        if (request.headers["x-test-hang"] !== "1") return;
        reached();
        await new Promise((r) => reply.raw.once("close", r));
      },
    });
    const a = await link(app, "/a.webm");
    const b = await link(app, "/b.webm");
    const address = await addressOf(app);
    const controller = new AbortController();
    const early = fetch(`${address}${a.url}`, {
      headers: { range: "bytes=7-", "x-test-hang": "1" },
      signal: controller.signal,
    });
    await inHook;
    controller.abort();
    await expect(early).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 50));
    // Nothing was started for a player that had already gone…
    expect(ts.initFileDownload).toHaveBeenCalledTimes(2);
    // …and the session's only download slot is still free.
    expect((await get(app, b.url, { range: "bytes=900-" })).statusCode).toBe(206);
  });

  it("cut a running stream the moment its session ends", async () => {
    // Before, a kicked or disconnected user kept receiving bytes until the
    // next request or the 15 s sweep noticed the session had gone.
    const { app, registry } = await build({ hold: (_, from) => from > 0 });
    const { url } = await link(app);
    const held = await openHeld(app, url, 1);
    const res = await held.response;
    expect(res.status).toBe(206);
    registry.remove("s1");
    await expect(res.arrayBuffer()).rejects.toThrow();
    expect((await get(app, url, { range: "bytes=1-" })).statusCode).toBe(410);
  });

  it("cut a running stream the moment its TeamSpeak connection closes", async () => {
    const { app, registry, ts } = await build({ hold: (_, from) => from === 1, maxTransfers: 2 });
    const mine = await link(app);
    const theirs = await link(app, "/clip.webm", "s2");
    const held = await openHeld(app, mine.url, 1);
    const res = await held.response;
    expect(res.status).toBe(206);
    // Another connection closing, even one of the same session, is not this one.
    registry.connectionClosed("s1", { ...ts });
    expect((await app.inject({ method: "HEAD", url: mine.url })).statusCode).toBe(200);
    registry.connectionClosed("s1", ts);
    await expect(res.arrayBuffer()).rejects.toThrow();
    expect((await get(app, mine.url, { range: "bytes=1-" })).statusCode).toBe(410);
    // The other session's link is untouched…
    expect((await get(app, theirs.url, { range: "bytes=900-" })).statusCode).toBe(206);
    // …and the session's only download slot came back, for its next connection's link.
    const next = await link(app);
    expect((await get(app, next.url, { range: "bytes=900-" })).statusCode).toBe(206);
  });

  it("cut a running stream when its link is replaced", async () => {
    const { app } = await build({ hold: (_, from) => from > 0 });
    const first = await link(app);
    const held = await openHeld(app, first.url, 1);
    const res = await held.response;
    expect(res.status).toBe(206);
    await link(app);
    await expect(res.arrayBuffer()).rejects.toThrow();
  });
});
