import { createHash } from "node:crypto";
import net from "node:net";
import { Readable } from "node:stream";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { dialFileTransfer } from "@honeybbq/teamspeak-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { crc32, FT_PASSWORD_HEADER, type FtDownloadTicket } from "@jinz/protocol";
import { TsCommandFailure } from "../gateway/commands.js";
import { parsePermissionList } from "../gateway/perms.js";
import { registerEmptyBodyParser } from "../http/empty-body.js";
import { RateLimiter } from "../security/limits.js";
import { registerSecurityHeaders } from "../security/headers.js";
import type { Session } from "../session/Session.js";
import type { FtTarget, FtUploadTarget } from "./ft-init.js";
import { registerFileRoutes, type FileRouteDeps } from "./routes.js";
import { DownloadTickets } from "./tickets.js";

const KEY_LENGTH = 32;
const catalog = parsePermissionList([{ permid: "236", permname: "i_ft_needed_file_upload_power" }]);
/** The fake session's UID, and its avatar file name (see ts-internal-files.ts). */
const OWN_UID = "rto1GjL3NJJZuUcHrfrMEs2lszg=";
const OWN_AVATAR = "konkdfbkdcphdejcfjljehahknpkmmbcmnkflddi";

/**
 * A stand-in for TeamSpeak's file port: reads the 32-byte key, then sends the
 * file for a download key or takes the bytes of an upload key.
 */
async function fakeFilePort(files: Map<string, Buffer>, opts: { cutAfter?: number } = {}) {
  const uploads = new Map<string, Buffer>();
  const server = net.createServer((socket) => {
    let buf = Buffer.alloc(0);
    let key: string | null = null;
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (key === null && buf.length >= KEY_LENGTH) {
        key = buf.subarray(0, KEY_LENGTH).toString();
        buf = buf.subarray(KEY_LENGTH);
        const file = files.get(key);
        if (file) {
          const sent = opts.cutAfter === undefined ? file : file.subarray(0, opts.cutAfter);
          socket.end(sent);
        }
      }
    });
    socket.on("end", () => {
      if (key && !files.has(key)) uploads.set(key, buf);
      socket.end();
    });
    socket.on("error", () => undefined);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  return { port, uploads, close: () => new Promise((r) => server.close(r)) };
}

const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

async function build(
  opts: {
    files?: Record<string, string>;
    cutAfter?: number;
    deps?: Partial<FileRouteDeps>;
    initError?: unknown;
    quotaMb?: number;
    /** i_client_max_avatar_filesize, when the server told us. */
    avatarLimit?: number;
    /** Runs before every handler, as the hub's own async hooks do. */
    beforeHandler?: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  } = {},
) {
  // Download keys are named after the path they serve.
  const keyOf = (path: string) =>
    `D${createHash("sha1").update(path).digest("hex")}`.slice(0, KEY_LENGTH);
  const files = new Map(
    Object.entries(opts.files ?? {}).map(([p, c]) => [keyOf(p), Buffer.from(c)]),
  );
  const port = await fakeFilePort(files, { cutAfter: opts.cutAfter });
  closers.push(port.close);
  let uploadSeq = 0;
  const ts = {
    fileTransferHost: "127.0.0.1",
    selfUid: OWN_UID,
    initFileDownload: vi.fn(async (t: FtTarget) => {
      if (opts.initError) throw opts.initError;
      const file = files.get(keyOf(t.path));
      if (!file) throw new TsCommandFailure("2051", "file not found", null);
      return { serverFtId: 1, key: keyOf(t.path), port: port.port, size: file.length };
    }),
    initFileUpload: vi.fn(async (_t: FtUploadTarget) => {
      if (opts.initError) throw opts.initError;
      const key = `U${++uploadSeq}`.padEnd(KEY_LENGTH, "_");
      return { serverFtId: 2, key, port: port.port, size: 0 };
    }),
    deleteFile: vi.fn(async () => undefined),
    forgetAsset: vi.fn(),
    ownPermission: (name: string) => {
      if (name === "i_ft_quota_mb_upload_per_client") return opts.quotaMb;
      return name === "i_client_max_avatar_filesize" ? opts.avatarLimit : undefined;
    },
    permissionCatalog: async () => catalog,
  };
  // Two sessions of the same user (the same TeamSpeak identity behind them).
  const sessions = new Map<string, Session>(
    ["s1", "s2"].map((id) => [id, { id, tsSession: ts } as unknown as Session]),
  );
  const app = Fastify();
  registerSecurityHeaders(app, { isProd: false });
  registerEmptyBodyParser(app);
  // The soundboard buffers octet-stream bodies app-wide; uploads must not be.
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: 10 },
    (_r, b, d) => d(null, b),
  );
  if (opts.beforeHandler) app.addHook("preHandler", opts.beforeHandler);
  await registerFileRoutes(app, {
    registry: {
      getConnected: (id) => (id === undefined ? undefined : sessions.get(id)),
      onEnd: () => () => undefined,
    },
    limits: { maxUploadBytes: 1024, maxTransfers: 2 },
    ...opts.deps,
  });
  await app.ready();
  closers.push(() => app.close());
  return { app, ts, uploads: port.uploads };
}

type App = Awaited<ReturnType<typeof build>>["app"];

const ticket = (app: App, body: unknown, session = "s1") =>
  app.inject({
    method: "POST",
    url: "/api/files/download-ticket",
    headers: { "x-session-id": session, "content-type": "application/json" },
    payload: JSON.stringify(body),
  });

const upload = (
  app: App,
  query: string,
  body: Buffer | Readable,
  headers: Record<string, string> = {},
) =>
  app.inject({
    method: "PUT",
    url: `/api/files/upload?${query}`,
    headers: {
      "x-session-id": "s1",
      "content-type": "application/octet-stream",
      ...(Buffer.isBuffer(body) ? { "content-length": String(body.length) } : {}),
      ...headers,
    },
    payload: body,
  });

describe("download tickets", () => {
  it("need a connected session and a valid request", async () => {
    const { app } = await build({ files: { "/a.txt": "hello" } });
    expect((await ticket(app, { cid: "5", path: "/a.txt" }, "nobody")).statusCode).toBe(401);
    expect((await ticket(app, { cid: "5", path: "/../a.txt" })).statusCode).toBe(400);
    expect((await ticket(app, { cid: "5", path: "/" })).statusCode).toBe(400);
  });

  it("stream the file once, as an attachment", async () => {
    const { app, ts } = await build({ files: { "/d/报告 1.html": "<script>x</script>" } });
    const res = await ticket(app, { cid: "5", path: "/d/报告 1.html", cpw: "pw" });
    expect(res.statusCode).toBe(200);
    const grant = res.json<FtDownloadTicket>();
    expect(grant).toMatchObject({ size: 18, name: "报告 1.html" });
    expect(grant.url).toMatch(/^\/api\/files\/download\/[A-Za-z0-9_-]{32}$/);
    expect(ts.initFileDownload).toHaveBeenCalledWith({
      cid: "5",
      path: "/d/报告 1.html",
      cpw: "pw",
    });

    const file = await app.inject({ method: "GET", url: grant.url });
    expect(file.statusCode).toBe(200);
    expect(file.body).toBe("<script>x</script>");
    expect(file.headers["content-type"]).toBe("application/octet-stream");
    expect(file.headers["content-length"]).toBe("18");
    expect(file.headers["x-content-type-options"]).toBe("nosniff");
    expect(file.headers["cache-control"]).toBe("no-store");
    expect(String(file.headers["content-disposition"])).toMatch(
      /^attachment; filename="__ 1.html"; filename\*=UTF-8''%E6%8A%A5/,
    );

    const again = await app.inject({ method: "GET", url: grant.url });
    expect(again.statusCode).toBe(410);
  });

  it("are not spent by a HEAD request", async () => {
    const { app } = await build({ files: { "/a.txt": "hello" } });
    const { url } = (await ticket(app, { cid: "5", path: "/a.txt" })).json<FtDownloadTicket>();
    expect((await app.inject({ method: "HEAD", url })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url })).body).toBe("hello");
  });

  it("pass on the server's refusal, translated", async () => {
    const { app } = await build({ initError: new TsCommandFailure("781", "invalid", null) });
    const res = await ticket(app, { cid: "5", path: "/a.txt", cpw: "wrong" });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "781", message: "tsErr.channelPassword" });
  });

  it("say not found for a missing file", async () => {
    const { app } = await build();
    const res = await ticket(app, { cid: "5", path: "/missing" });
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toBe("tsErr.fileNotFound");
  });

  it("are rate limited per user, not only per session", async () => {
    // One user with a handful of sessions must not drain the hub-wide
    // TeamSpeak command budget every transfer init spends (server-guard.ts).
    const { app } = await build({
      files: { "/a.txt": "hello" },
      deps: { limiter: new RateLimiter({ limit: 1, windowMs: 60_000 }) },
    });
    expect((await ticket(app, { cid: "5", path: "/a.txt" }, "s1")).statusCode).toBe(200);
    const other = await ticket(app, { cid: "5", path: "/a.txt" }, "s2");
    expect(other.statusCode).toBe(429);
    expect(other.json().error).toBe("rate_limited");
  });

  it("are rate limited per session", async () => {
    const { app } = await build({
      files: { "/a.txt": "hello" },
      deps: { limiter: new RateLimiter({ limit: 1, windowMs: 60_000 }) },
    });
    const first = await ticket(app, { cid: "5", path: "/a.txt" });
    expect(first.statusCode).toBe(200);
    // Used, so its slot is free again and only the init budget is in the way.
    await app.inject({ method: "GET", url: first.json<FtDownloadTicket>().url });
    await new Promise((r) => setTimeout(r, 20));
    const second = await ticket(app, { cid: "5", path: "/a.txt" });
    expect(second.statusCode).toBe(429);
    expect(second.json().error).toBe("rate_limited");
  });

  it("break the download when the file port closes early", async () => {
    const { app } = await build({ files: { "/a.txt": "hello world" }, cutAfter: 4 });
    const { url } = (await ticket(app, { cid: "5", path: "/a.txt" })).json<FtDownloadTicket>();
    const res = await app.inject({ method: "GET", url }).catch((e: unknown) => e);
    // Either the response is cut off or it never completes as a whole file.
    if (!(res instanceof Error)) expect((res as { body: string }).body).not.toBe("hello world");
  });
});

describe("the hub-wide transfer cap", () => {
  it("refuses a transfer once the whole hub is busy, whoever asks", async () => {
    const { app, ts } = await build({ deps: { maxHubTransfers: 1 } });
    const held = new Readable({ read() {} });
    held.push(Buffer.from("abc"));
    const running = upload(app, "cid=5&path=%2Fheld", held, { "content-length": "6" });
    await vi.waitFor(() => expect(ts.initFileUpload).toHaveBeenCalledTimes(1));

    const busy = await upload(app, "cid=5&path=%2Fb", Buffer.from("x"), { "x-session-id": "s2" });
    expect(busy.statusCode).toBe(429);
    expect(busy.json().error).toBe("busy");

    held.push(Buffer.from("def"));
    held.push(null);
    expect((await running).statusCode).toBe(201);
    // The slot is free again.
    expect((await upload(app, "cid=5&path=%2Fb", Buffer.from("x"))).statusCode).toBe(201);
  });
});

describe("transfer slots", () => {
  /** Waits for the stream behind a GET to close and give its slot back. */
  const settle = () => new Promise((r) => setTimeout(r, 20));

  it("are taken when a link is handed out, so its download is never refused", async () => {
    const { app } = await build({ files: { "/a.txt": "hello", "/b.txt": "world" } });
    const a = await ticket(app, { cid: "5", path: "/a.txt" });
    expect(a.statusCode).toBe(200);
    // Two slots, one of them kept for uploads: a second link waits.
    const b = await ticket(app, { cid: "5", path: "/b.txt" });
    expect(b.statusCode).toBe(429);
    expect(b.json().error).toBe("busy");
    const file = await app.inject({ method: "GET", url: a.json<FtDownloadTicket>().url });
    expect(file.body).toBe("hello");
    await settle();
    expect((await ticket(app, { cid: "5", path: "/b.txt" })).statusCode).toBe(200);
  });

  it("do not use up the inits per minute when they answer busy", async () => {
    const { app } = await build({
      files: { "/a.txt": "hello" },
      deps: { limiter: new RateLimiter({ limit: 2, windowMs: 60_000 }) },
    });
    const first = await ticket(app, { cid: "5", path: "/a.txt" });
    expect(first.statusCode).toBe(200);
    expect((await ticket(app, { cid: "5", path: "/a.txt" })).statusCode).toBe(429);
    await app.inject({ method: "GET", url: first.json<FtDownloadTicket>().url });
    await settle();
    // The refused one spent nothing, so the second init is still there.
    expect((await ticket(app, { cid: "5", path: "/a.txt" })).statusCode).toBe(200);
  });

  it("leave room for an upload while downloads hold theirs", async () => {
    const { app } = await build({ files: { "/a.txt": "hello" } });
    expect((await ticket(app, { cid: "5", path: "/a.txt" })).statusCode).toBe(200);
    expect((await upload(app, "cid=5&path=%2Fu.txt", Buffer.from("up"))).statusCode).toBe(201);
  });

  it("come back when a link expires unused", async () => {
    const { app } = await build({
      files: { "/a.txt": "hello" },
      deps: { tickets: new DownloadTickets(Date.now, 30) },
    });
    const { url } = (await ticket(app, { cid: "5", path: "/a.txt" })).json<FtDownloadTicket>();
    expect((await ticket(app, { cid: "5", path: "/a.txt" })).statusCode).toBe(429);
    await new Promise((r) => setTimeout(r, 80));
    expect((await ticket(app, { cid: "5", path: "/a.txt" })).statusCode).toBe(200);
    // The expired link itself stays dead.
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(410);
  });

  it("come back when the server refuses the download", async () => {
    const { app } = await build({ files: { "/a.txt": "hello" } });
    expect((await ticket(app, { cid: "5", path: "/missing" })).statusCode).toBe(404);
    expect((await ticket(app, { cid: "5", path: "/a.txt" })).statusCode).toBe(200);
  });

  /**
   * Leaves a GET of a fresh link while its dial is held back, then lets the
   * dial finish (`outcome`), and says what the next two links got.
   */
  async function leaveWhileDialling(outcome: "connects" | "fails") {
    let letGo = () => undefined as void;
    const open = new Promise<void>((r) => (letGo = r));
    // The file port answers only once the spec says so, like a slow dial.
    const dial = vi.fn(async (host: string, port: number, key: string) => {
      await open;
      if (outcome === "fails") throw new Error("ECONNREFUSED");
      return dialFileTransfer(host, port, key);
    });
    const { app } = await build({
      files: { "/a.txt": "hello", "/b.txt": "world", "/c.txt": "again" },
      deps: { dial },
    });
    const a = (await ticket(app, { cid: "5", path: "/a.txt" })).json<FtDownloadTicket>();
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const controller = new AbortController();
    const early = fetch(`${address}${a.url}`, { signal: controller.signal });
    await vi.waitFor(() => expect(dial).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(early).rejects.toThrow();
    // Gone before the file port answered: the link's slot is free again…
    await vi.waitFor(async () =>
      expect((await ticket(app, { cid: "5", path: "/b.txt" })).statusCode).toBe(200),
    );
    letGo();
    await settle();
    // …and given back only once: the late dial must not free the slot the
    // next link holds now.
    expect((await ticket(app, { cid: "5", path: "/c.txt" })).statusCode).toBe(429);
  }

  it("come back when the browser goes away while its download is still starting", () =>
    leaveWhileDialling("connects"));

  it("come back only once when the dial fails after the browser went away", () =>
    leaveWhileDialling("fails"));

  it("come back when the browser went away before the handler ran", async () => {
    // The socket can close while the hooks before the handler still run; a
    // `close` listener attached after that never fires.
    let reached = () => undefined as void;
    const inHook = new Promise<void>((r) => (reached = r));
    const dial = vi.fn(dialFileTransfer);
    const { app } = await build({
      files: { "/a.txt": "hello", "/b.txt": "world" },
      deps: { dial },
      beforeHandler: async (request, reply) => {
        if (request.headers["x-test-hang"] !== "1") return;
        reached();
        await new Promise((r) => reply.raw.once("close", r));
      },
    });
    const a = (await ticket(app, { cid: "5", path: "/a.txt" })).json<FtDownloadTicket>();
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const controller = new AbortController();
    const early = fetch(`${address}${a.url}`, {
      headers: { "x-test-hang": "1" },
      signal: controller.signal,
    });
    await inHook;
    controller.abort();
    await expect(early).rejects.toThrow();
    await settle();
    // Nobody to send it to: the file port is not dialled, and the slot is free.
    expect(dial).not.toHaveBeenCalled();
    expect((await ticket(app, { cid: "5", path: "/b.txt" })).statusCode).toBe(200);
  });

  it("answer a failed download as plain text, never as a file to save", async () => {
    const { app } = await build({ files: { "/a.txt": "hello" } });
    const { url } = (await ticket(app, { cid: "5", path: "/a.txt" })).json<FtDownloadTicket>();
    await app.inject({ method: "GET", url });
    const again = await app.inject({ method: "GET", url });
    expect(again.statusCode).toBe(410);
    expect(again.headers["content-type"]).toMatch(/^text\/plain/);
    expect(again.headers["content-disposition"]).toBeUndefined();
    expect(again.body.length).toBeLessThan(100);
  });
});

describe("uploads", () => {
  it("need a connected session", async () => {
    const { app } = await build();
    const res = await upload(app, "cid=5&path=%2Fa.txt", Buffer.from("x"), {
      "x-session-id": "nobody",
    });
    expect(res.statusCode).toBe(401);
  });

  it("stream the body to the file port and answer with what was stored", async () => {
    const { app, ts, uploads } = await build();
    const body = Buffer.from("hello upload");
    const res = await upload(app, "cid=5&path=%2Fsub%2Fa.txt&overwrite=1", body, {
      [FT_PASSWORD_HEADER]: encodeURIComponent("pw é"),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ path: "/sub/a.txt", size: body.length });
    expect(ts.initFileUpload).toHaveBeenCalledWith({
      cid: "5",
      path: "/sub/a.txt",
      cpw: "pw é",
      size: body.length,
      overwrite: true,
    });
    expect([...uploads.values()][0]?.toString()).toBe("hello upload");
  });

  it("refuse bad paths and queries", async () => {
    const { app } = await build();
    const bad = ["cid=5&path=%2F..%2Fa", "cid=5&path=a.txt", "cid=x&path=%2Fa", "cid=5&path=%2F"];
    for (const q of bad) expect((await upload(app, q, Buffer.from("x"))).statusCode).toBe(400);
    const pw = await upload(app, "cid=5&path=%2Fa", Buffer.from("x"), {
      [FT_PASSWORD_HEADER]: "%E0%A4%A",
    });
    expect(pw.statusCode).toBe(400);
  });

  it("want a length up front", async () => {
    const { app } = await build();
    const res = await upload(app, "cid=5&path=%2Fa", Readable.from([Buffer.from("xyz")]));
    expect(res.statusCode).toBe(411);
    expect(res.json().error).toBe("length_required");
  });

  it("refuse more than the hub or the quota allows, before asking the server", async () => {
    const { app, ts } = await build();
    const res = await upload(app, "cid=5&path=%2Fa", Buffer.alloc(1025));
    expect(res.statusCode).toBe(413);
    expect(res.json().message).toContain("ft.tooLarge");
    expect(ts.initFileUpload).not.toHaveBeenCalled();

    const quota = await build({ quotaMb: 0 });
    expect((await upload(quota.app, "cid=5&path=%2Fa", Buffer.alloc(1))).statusCode).toBe(413);
  });

  it("are not buffered by the app-wide octet-stream parser", async () => {
    const { app } = await build();
    // Bigger than that parser's 10-byte limit, within the file limit.
    expect((await upload(app, "cid=5&path=%2Fa", Buffer.alloc(500, 1))).statusCode).toBe(201);
  });

  it("need the octet-stream type", async () => {
    const { app } = await build();
    const res = await upload(app, "cid=5&path=%2Fa", Buffer.from("xyz"), {
      "content-type": "text/html",
    });
    expect(res.statusCode).toBe(415);
  });

  it("pass on a refusal with the permission's name", async () => {
    const { app } = await build({ initError: new TsCommandFailure("2568", "insufficient", 236) });
    const res = await upload(app, "cid=5&path=%2Fa", Buffer.from("xyz"));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error: "2568",
      failedPermission: "i_ft_needed_file_upload_power",
    });
  });

  it("keep an old file when an overwrite fails before any byte went in", async () => {
    const { app, ts } = await build({
      deps: { dial: () => Promise.reject(new Error("ECONNREFUSED")) },
    });
    const res = await upload(app, "cid=5&path=%2Fa&overwrite=1", Buffer.from("xyz"));
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: "failed", message: "ft.failed" });
    expect(ts.deleteFile).not.toHaveBeenCalled();
  });

  it("clean up after a body that ends short", async () => {
    const { app, ts } = await build();
    const res = await upload(app, "cid=5&path=%2Fa", Readable.from([Buffer.from("abc")]), {
      "content-length": "10",
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    await vi.waitFor(() =>
      expect(ts.deleteFile).toHaveBeenCalledWith({ cid: "5", path: "/a", cpw: "" }),
    );
  });

  it("take only the caller's own avatar and icon files in channel 0", async () => {
    // The server itself lets anyone overwrite anyone's avatar (seen live).
    const { app, ts } = await build();
    const own = encodeURIComponent(`/avatar_${OWN_AVATAR}`);
    expect((await upload(app, `cid=0&path=${own}&overwrite=1`, Buffer.from("x"))).statusCode).toBe(
      201,
    );
    const icon = encodeURIComponent("/icon_2363233923");
    expect((await upload(app, `cid=0&path=${icon}`, Buffer.from("x"))).statusCode).toBe(201);
    const refused = [`/avatar_${"a".repeat(40)}`, "/icon_42", "/notes.txt", "/icons/icon_5000"];
    for (const path of refused) {
      const res = await upload(app, `cid=0&path=${encodeURIComponent(path)}`, Buffer.from("x"));
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toBe("ft.forbidden");
    }
    expect(ts.initFileUpload).toHaveBeenCalledTimes(2);
    // The hub's icon cache may remember the new icon as missing.
    expect(ts.forgetAsset).toHaveBeenCalledWith("/icon_2363233923");
  });

  it("refuse channel 0 spelled with leading zeros", async () => {
    const { app, ts } = await build();
    for (const cid of ["00", "007"]) {
      const path = encodeURIComponent("/notes.txt");
      const res = await upload(app, `cid=${cid}&path=${path}`, Buffer.from("x"));
      expect(res.statusCode).toBe(400);
    }
    expect(ts.initFileUpload).not.toHaveBeenCalled();
  });

  it("never replace an icon (its name is its bytes' CRC-32)", async () => {
    const { app, ts } = await build();
    const icon = encodeURIComponent("/icon_2363233923");
    const res = await upload(app, `cid=0&path=${icon}&overwrite=1`, Buffer.from("x"));
    expect(res.statusCode).toBe(403);
    expect(ts.initFileUpload).not.toHaveBeenCalled();
  });

  it("cut off a body that stops moving, and clean up after it", async () => {
    const { app, ts } = await build({
      deps: { stall: { windowMs: 20, minBytes: 1024 } },
    });
    // Three bytes of ten, then nothing: a slot and a file-port socket held.
    const trickle = new Readable({ read() {} });
    trickle.push(Buffer.from("abc"));
    // The body is cut off, which reaches the caller as our refusal or as a
    // broken request, depending on how far its bytes got (as a short body does).
    const res = await upload(app, "cid=5&path=%2Fa", trickle, {
      "content-length": "10",
    }).catch((e: unknown) => e);
    if (!(res instanceof Error)) expect((res as { statusCode: number }).statusCode).toBe(400);
    await vi.waitFor(() =>
      expect(ts.deleteFile).toHaveBeenCalledWith({ cid: "5", path: "/a", cpw: "" }),
    );
    trickle.push(null);
  });

  it("close the connection on a refusal of the hub's, drain only the server's", async () => {
    const limited = await build({
      deps: { limiter: new RateLimiter({ limit: 1, windowMs: 60_000 }) },
    });
    expect((await upload(limited.app, "cid=5&path=%2Fa", Buffer.from("xyz"))).statusCode).toBe(201);
    const busy = await upload(limited.app, "cid=5&path=%2Fa", Buffer.from("xyz"));
    expect(busy.statusCode).toBe(429);
    expect(busy.headers["connection"]).toBe("close");

    const refused = await build({ initError: new TsCommandFailure("2050", "exists", null) });
    const res = await upload(refused.app, "cid=5&path=%2Fa", Buffer.from("xyz"));
    expect(res.statusCode).toBe(409);
    expect(res.headers["connection"]).not.toBe("close");
  });

  it("cap what goes into channel 0 well below the channel file limit", async () => {
    const { app, ts } = await build({ deps: { limits: { maxUploadBytes: 8e6, maxTransfers: 2 } } });
    const avatar = encodeURIComponent(`/avatar_${OWN_AVATAR}`);
    const big = await upload(
      app,
      `cid=0&path=${avatar}&overwrite=1`,
      Buffer.alloc(1024 * 1024 + 1),
    );
    expect(big.statusCode).toBe(413);
    const icon = encodeURIComponent("/icon_3000000000");
    expect((await upload(app, `cid=0&path=${icon}`, Buffer.alloc(64 * 1024 + 1))).statusCode).toBe(
      413,
    );
    expect(ts.initFileUpload).not.toHaveBeenCalled();
    // A channel file of the same size is fine.
    expect((await upload(app, "cid=5&path=%2Fa", Buffer.alloc(1024 * 1024 + 1))).statusCode).toBe(
      201,
    );
  });

  it("follow i_client_max_avatar_filesize when the server told us", async () => {
    const { app } = await build({
      deps: { limits: { maxUploadBytes: 8e6, maxTransfers: 2 } },
      avatarLimit: 20_000,
    });
    const avatar = encodeURIComponent(`/avatar_${OWN_AVATAR}`);
    const res = await upload(app, `cid=0&path=${avatar}&overwrite=1`, Buffer.alloc(20_001));
    expect(res.statusCode).toBe(413);
    expect(
      (await upload(app, `cid=0&path=${avatar}&overwrite=1`, Buffer.alloc(20_000))).statusCode,
    ).toBe(201);
  });

  it("take an icon only under the name its own bytes give it", async () => {
    const { app, ts, uploads } = await build();
    const bytes = Buffer.from("icon bytes");
    const wrong = encodeURIComponent(`/icon_${crc32(Buffer.from("other"))}`);
    const refused = await upload(app, `cid=0&path=${wrong}`, bytes);
    expect(refused.statusCode).toBe(400);
    expect(ts.initFileUpload).not.toHaveBeenCalled();

    const right = encodeURIComponent(`/icon_${crc32(bytes)}`);
    expect((await upload(app, `cid=0&path=${right}`, bytes)).statusCode).toBe(201);
    expect([...uploads.values()][0]).toEqual(bytes);
  });

  it("delete a cut-off avatar by the base64 UID, the name ftdeletefile takes", async () => {
    const { app, ts } = await build();
    const own = encodeURIComponent(`/avatar_${OWN_AVATAR}`);
    await upload(app, `cid=0&path=${own}&overwrite=1`, Readable.from([Buffer.from("abc")]), {
      "content-length": "10",
    });
    await vi.waitFor(() =>
      expect(ts.deleteFile).toHaveBeenCalledWith({ cid: "0", path: `/avatar_${OWN_UID}`, cpw: "" }),
    );
  });
});
