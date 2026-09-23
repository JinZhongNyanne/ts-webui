import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_STICKER_BYTES,
  MAX_STICKER_PACKS,
  type ServerMessage,
  type Sticker,
  type StickerPack,
  type StickerSet,
} from "@jinz/protocol";
import type { Session } from "../session/Session.js";
import { RateLimiter } from "../security/limits.js";
import { registerSecurityHeaders } from "../security/headers.js";
import { registerEmptyBodyParser } from "../http/empty-body.js";
import { StickerStore } from "./store.js";
import { registerStickerRoutes, type StickerRegistry } from "./routes.js";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("first"),
]);
const GIF = Buffer.concat([Buffer.from("GIF89a", "latin1"), Buffer.alloc(32)]);

const sha = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

let dir: string;
beforeEach(() => (dir = mkdtempSync(path.join(tmpdir(), "jinz-sticker-routes-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/**
 * Three connected sessions: "a" and "a2" are the same identity on two
 * devices, "b" is somebody else, and "idle" is not connected at all.
 */
async function build(opts: { limit?: number; octetParser?: boolean } = {}) {
  const sent = new Map<string, ServerMessage[]>();
  const session = (id: string, connected: boolean, uid: string | undefined) => {
    sent.set(id, []);
    return {
      id,
      connected,
      tsSession: { selfNickname: `nick-${id}`, selfUid: uid },
      send: (m: ServerMessage) => sent.get(id)!.push(m),
    } as unknown as Session & { connected: boolean };
  };
  const sessions = [
    session("a", true, "uid-a"),
    session("a2", true, "uid-a"),
    session("b", true, "uid-b"),
    session("noid", true, undefined),
    session("idle", false, "uid-a"),
  ];
  const registry: StickerRegistry = {
    getConnected: (id) => sessions.find((s) => s.id === id && s.connected),
    getConnectedByAssetToken: (token) => (token === "tok" ? sessions[0] : undefined),
    values: () => sessions,
  };
  const store = new StickerStore(dir);
  const app = Fastify();
  registerSecurityHeaders(app, { isProd: false });
  registerEmptyBodyParser(app);
  // The soundboard registers this first on the real hub, with a larger cap.
  if (opts.octetParser) {
    app.addContentTypeParser(
      "application/octet-stream",
      { parseAs: "buffer", bodyLimit: 4 * MAX_STICKER_BYTES },
      (_req, body, done) => done(null, body),
    );
  }
  registerStickerRoutes(app, {
    store,
    registry,
    limiter: opts.limit ? new RateLimiter({ limit: opts.limit, windowMs: 60_000 }) : undefined,
  });
  await app.ready();
  return { app, store, sent };
}

type App = Awaited<ReturnType<typeof build>>["app"];

function upload(
  app: App,
  body: Buffer,
  { name = "Cat", scope = "shared", session = "a", pack = "", type = "" } = {},
) {
  const query = new URLSearchParams({ name });
  if (pack) query.set("pack", pack);
  return app.inject({
    method: "POST",
    url: `/api/stickers/${scope}?${query}`,
    headers: {
      "x-session-id": session,
      "content-type": type || "application/octet-stream",
    },
    payload: body,
  });
}

const stickerOf = (res: { json: <T>() => T }) => res.json<{ sticker: Sticker }>().sticker;
const packOf = (res: { json: <T>() => T }) => res.json<{ pack: StickerPack }>().pack;

function makePack(app: App, name: string, scope = "shared", session = "a") {
  return app.inject({
    method: "POST",
    url: `/api/sticker-packs/${scope}`,
    headers: { "x-session-id": session },
    payload: { name },
  });
}

function list(app: App, session = "a") {
  return app.inject({ url: "/api/stickers", headers: { "x-session-id": session } });
}

const sets = (res: { json: <T>() => T }) =>
  res.json<{ shared: StickerSet; personal: StickerSet }>();

describe("sticker routes: who may do what", () => {
  it("needs a connected session for everything", async () => {
    const { app } = await build();
    expect((await list(app, "idle")).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/stickers" })).statusCode).toBe(401);
    expect((await upload(app, PNG, { session: "idle" })).statusCode).toBe(401);
    expect((await makePack(app, "x", "shared", "nobody")).statusCode).toBe(401);
    const del = await app.inject({ method: "DELETE", url: "/api/stickers/shared/x" });
    expect(del.statusCode).toBe(401);
    // A picture is served on an asset token, and an unknown one is a miss.
    expect((await app.inject({ url: `/api/sticker-file/${sha(PNG)}` })).statusCode).toBe(404);
  });

  it("refuses a scope that is not one of the two", async () => {
    const { app } = await build();
    expect((await upload(app, PNG, { scope: "everyone" })).statusCode).toBe(404);
    expect((await makePack(app, "x", "global")).statusCode).toBe(404);
  });

  it("gives a session without an identity an empty personal set and no writes", async () => {
    const { app } = await build();
    expect(sets(await list(app, "noid")).personal).toEqual({
      scope: "personal",
      packs: [],
      stickers: [],
    });
    expect((await upload(app, PNG, { scope: "personal", session: "noid" })).statusCode).toBe(403);
  });
});

describe("sticker routes: shared scope", () => {
  it("uploads, remembers who did, and tells every connected session", async () => {
    const { app, sent } = await build();
    const res = await upload(app, PNG, { name: "  Happy   cat " });
    expect(res.statusCode).toBe(201);
    const added = stickerOf(res);
    expect(added).toMatchObject({
      name: "Happy cat",
      packId: null,
      hash: sha(PNG),
      contentType: "image/png",
      bytes: PNG.length,
      addedBy: "nick-a",
    });
    expect(sets(await list(app, "b")).shared.stickers).toEqual([added]);
    expect(sent.get("b")).toEqual([
      { type: "stickers.updated", set: { scope: "shared", packs: [], stickers: [added] } },
    ]);
    expect(sent.get("idle")).toEqual([]);
  });

  it("judges the type by the bytes, never by the header or the name", async () => {
    const { app } = await build();
    const html = Buffer.from("<html><script>alert(1)</script></html>");
    const refused = await upload(app, html, { name: "cat.png" });
    expect(refused.statusCode).toBe(415);
    expect(refused.json()).toEqual({ error: "type" });
    // An SVG is a document that can carry scripts; it is not a sticker.
    const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
    expect((await upload(app, svg, { name: "x.svg" })).statusCode).toBe(415);
    // Uploads are untyped; a body claiming a type the hub does not parse is refused.
    expect((await upload(app, GIF, { type: "image/gif" })).statusCode).toBe(415);
    expect(stickerOf(await upload(app, GIF)).contentType).toBe("image/gif");
  });

  it("keeps the byte cap when another route owns the raw-upload parser", async () => {
    // The soundboard's parser allows more than a sticker may be; the route must not.
    const { app } = await build({ octetParser: true });
    expect((await upload(app, PNG)).statusCode).toBe(201);
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_STICKER_BYTES)]);
    expect((await upload(app, big, { name: "big" })).statusCode).toBe(413);
  });

  it("refuses bad names and empty or oversized bodies", async () => {
    const { app } = await build();
    expect((await upload(app, PNG, { name: "   " })).json()).toEqual({ error: "name" });
    expect((await upload(app, PNG, { name: "x".repeat(33) })).json()).toEqual({ error: "name" });
    expect((await upload(app, Buffer.alloc(0))).statusCode).toBe(400);
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_STICKER_BYTES)]);
    expect((await upload(app, big)).statusCode).toBe(413);
  });

  it("lets anyone rename, move and delete, and pushes each change", async () => {
    const { app, sent } = await build();
    const id = stickerOf(await upload(app, PNG)).id;
    const pack = packOf(await makePack(app, "Memes"));

    const moved = await app.inject({
      method: "PATCH",
      url: `/api/stickers/shared/${id}`,
      headers: { "x-session-id": "b" },
      payload: { name: "Big cat", packId: pack.id },
    });
    expect(moved.statusCode).toBe(200);
    expect(stickerOf(moved)).toMatchObject({ name: "Big cat", packId: pack.id });

    const back = await app.inject({
      method: "PATCH",
      url: `/api/stickers/shared/${id}`,
      headers: { "x-session-id": "b" },
      payload: { packId: null },
    });
    expect(stickerOf(back).packId).toBeNull();

    const del = await app.inject({
      method: "DELETE",
      url: `/api/stickers/shared/${id}`,
      headers: { "x-session-id": "b" },
    });
    expect(del.statusCode).toBe(204);
    const last = sent.get("a")!.at(-1) as { set: StickerSet };
    expect(last.set.stickers).toEqual([]);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/stickers/shared/${id}`,
          headers: { "x-session-id": "b" },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("refuses an empty or malformed patch", async () => {
    const { app } = await build();
    const id = stickerOf(await upload(app, PNG)).id;
    const patch = (payload: object) =>
      app.inject({
        method: "PATCH",
        url: `/api/stickers/shared/${id}`,
        headers: { "x-session-id": "a" },
        payload,
      });
    expect((await patch({})).statusCode).toBe(400);
    expect((await patch({ name: "" })).statusCode).toBe(400);
    expect((await patch({ colour: "red" })).statusCode).toBe(400);
    expect((await patch({ packId: "no-such-pack" })).json()).toEqual({ error: "pack" });
  });
});

describe("sticker routes: personal scope", () => {
  it("keeps one identity's set out of another's, on every device", async () => {
    const { app, sent } = await build();
    const mine = stickerOf(await upload(app, PNG, { scope: "personal", session: "a" }));
    expect(sets(await list(app, "a")).personal.stickers).toEqual([mine]);
    expect(sets(await list(app, "a2")).personal.stickers).toEqual([mine]);
    expect(sets(await list(app, "b")).personal.stickers).toEqual([]);
    expect(sets(await list(app, "b")).shared.stickers).toEqual([]);

    // Only the owner's sessions hear about it; not the other user's, not the idle one.
    expect(sent.get("a2")).toHaveLength(1);
    expect(sent.get("b")).toEqual([]);
    expect(sent.get("idle")).toEqual([]);
  });

  it("does not let another identity touch it, even knowing the id", async () => {
    const { app } = await build();
    const mine = stickerOf(await upload(app, PNG, { scope: "personal", session: "a" }));
    const asBob = (method: "PATCH" | "DELETE", payload?: object) =>
      app.inject({
        method,
        url: `/api/stickers/personal/${mine.id}`,
        headers: { "x-session-id": "b" },
        ...(payload ? { payload } : {}),
      });
    expect((await asBob("PATCH", { name: "stolen" })).statusCode).toBe(404);
    expect((await asBob("DELETE")).statusCode).toBe(404);
    // And the shared scope is not a way in either.
    const viaShared = await app.inject({
      method: "DELETE",
      url: `/api/stickers/shared/${mine.id}`,
      headers: { "x-session-id": "a" },
    });
    expect(viaShared.statusCode).toBe(404);
    expect(sets(await list(app, "a")).personal.stickers).toHaveLength(1);
  });
});

describe("sticker routes: packs", () => {
  it("creates, renames and deletes, ungrouping or deleting the stickers", async () => {
    const { app } = await build();
    const pack = packOf(await makePack(app, "  Memes  "));
    expect(pack).toMatchObject({ name: "Memes" });
    expect((await makePack(app, "memes")).json()).toEqual({ error: "duplicate" });
    expect((await makePack(app, "  ")).json()).toEqual({ error: "name" });

    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/sticker-packs/shared/${pack.id}`,
      headers: { "x-session-id": "b" },
      payload: { name: "Reaction" },
    });
    expect(packOf(renamed)).toMatchObject({ name: "Reaction" });

    const inside = stickerOf(await upload(app, PNG, { pack: pack.id }));
    const del = (stickers: string) =>
      app.inject({
        method: "DELETE",
        url: `/api/sticker-packs/shared/${pack.id}?stickers=${stickers}`,
        headers: { "x-session-id": "a" },
      });
    expect((await del("nonsense")).statusCode).toBe(400);
    expect((await del("ungroup")).statusCode).toBe(204);
    const after = sets(await list(app)).shared;
    expect(after.packs).toEqual([]);
    expect(after.stickers.map((s) => [s.id, s.packId])).toEqual([[inside.id, null]]);
    expect((await del("ungroup")).statusCode).toBe(404);
  });

  it("deletes a pack with its stickers when asked", async () => {
    const { app } = await build();
    const pack = packOf(await makePack(app, "Memes"));
    await upload(app, PNG, { pack: pack.id });
    await app.inject({
      method: "DELETE",
      url: `/api/sticker-packs/shared/${pack.id}?stickers=delete`,
      headers: { "x-session-id": "a" },
    });
    expect(sets(await list(app)).shared.stickers).toEqual([]);
    expect((await app.inject({ url: `/api/sticker-file/${sha(PNG)}?token=tok` })).statusCode).toBe(
      404,
    );
  });

  it("refuses an upload into a pack that is not in this scope, and a full scope", async () => {
    const { app } = await build();
    const mine = packOf(await makePack(app, "mine", "personal", "a"));
    expect((await upload(app, PNG, { pack: mine.id })).json()).toEqual({ error: "pack" });
    for (let i = 0; i < MAX_STICKER_PACKS; i++) await makePack(app, `p${i}`);
    const full = await makePack(app, "one more");
    expect(full.statusCode).toBe(409);
    expect(full.json()).toEqual({ error: "full" });
  });
});

describe("sticker routes: pictures", () => {
  it("serves one file per picture, cached hard and never sniffable", async () => {
    const { app } = await build();
    await upload(app, PNG, { name: "one" });
    const res = await app.inject({ url: `/api/sticker-file/${sha(PNG)}?token=tok` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toContain("immutable");
    expect(res.rawPayload).toEqual(PNG);
    expect((await app.inject({ url: `/api/sticker-file/${sha(PNG)}?token=bad` })).statusCode).toBe(
      404,
    );
    expect((await app.inject({ url: `/api/sticker-file/nope?token=tok` })).statusCode).toBe(404);
  });

  it("gives the same picture one file and each entry its own id", async () => {
    const { app, store } = await build();
    const first = stickerOf(await upload(app, PNG, { name: "one" }));
    const second = stickerOf(await upload(app, PNG, { name: "two", session: "b" }));
    const personal = stickerOf(await upload(app, PNG, { name: "mine", scope: "personal" }));
    expect(new Set([first.hash, second.hash, personal.hash]).size).toBe(1);
    expect(new Set([first.id, second.id, personal.id]).size).toBe(3);
    expect(store.references(first.hash)).toBe(3);
  });

  it("keeps the picture until the last entry pointing at it goes", async () => {
    const { app } = await build();
    const shared = stickerOf(await upload(app, PNG, { name: "one" }));
    const personal = stickerOf(await upload(app, PNG, { name: "mine", scope: "personal" }));
    const url = `/api/sticker-file/${sha(PNG)}?token=tok`;
    const drop = (scope: string, id: string) =>
      app.inject({
        method: "DELETE",
        url: `/api/stickers/${scope}/${id}`,
        headers: { "x-session-id": "a" },
      });
    expect((await drop("shared", shared.id)).statusCode).toBe(204);
    expect((await app.inject({ url })).statusCode).toBe(200);
    expect((await drop("personal", personal.id)).statusCode).toBe(204);
    expect((await app.inject({ url })).statusCode).toBe(404);
  });
});

describe("sticker routes: budgets", () => {
  it("rate-limits writes per session, and leaves reads alone", async () => {
    const { app } = await build({ limit: 2 });
    expect((await upload(app, PNG, { name: "a" })).statusCode).toBe(201);
    expect((await makePack(app, "p")).statusCode).toBe(201);
    expect((await upload(app, PNG, { name: "c" })).statusCode).toBe(429);
    expect((await list(app)).statusCode).toBe(200);
    // Another session has its own budget.
    expect((await upload(app, PNG, { name: "d", session: "b" })).statusCode).toBe(201);
  });
});
