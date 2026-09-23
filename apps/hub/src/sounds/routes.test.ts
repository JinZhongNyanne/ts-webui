import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_SOUND_BYTES, MAX_SOUNDS, type ServerMessage, type SharedSound } from "@jinz/protocol";
import type { Session } from "../session/Session.js";
import { RateLimiter } from "../security/limits.js";
import { registerSecurityHeaders } from "../security/headers.js";
import { registerEmptyBodyParser } from "../http/empty-body.js";
import { SoundStore } from "./store.js";
import { registerSoundRoutes, type SoundRegistry } from "./routes.js";

const WAV = Buffer.concat([
  Buffer.from("RIFF\x24\x00\x00\x00WAVEfmt ", "latin1"),
  Buffer.alloc(32),
]);
const OGG = Buffer.concat([Buffer.from("OggS", "latin1"), Buffer.alloc(60)]);

let dir: string;
beforeEach(() => (dir = mkdtempSync(path.join(tmpdir(), "jinz-sound-routes-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function build(opts: { limit?: number } = {}) {
  const sent = new Map<string, ServerMessage[]>();
  const session = (id: string, connected: boolean) => {
    sent.set(id, []);
    return {
      id,
      connected,
      tsSession: { selfNickname: `nick-${id}` },
      send: (m: ServerMessage) => sent.get(id)!.push(m),
    } as unknown as Session & { connected: boolean };
  };
  const sessions = [session("a", true), session("b", true), session("idle", false)];
  const registry: SoundRegistry = {
    getConnected: (id) => sessions.find((s) => s.id === id && s.connected),
    getConnectedByAssetToken: (token) => (token === "tok" ? sessions[0] : undefined),
    values: () => sessions,
  };
  const store = new SoundStore(dir);
  const app = Fastify();
  registerSecurityHeaders(app, { isProd: false });
  registerEmptyBodyParser(app);
  registerSoundRoutes(app, {
    store,
    registry,
    limiter: opts.limit ? new RateLimiter({ limit: opts.limit, windowMs: 60_000 }) : undefined,
  });
  await app.ready();
  return { app, store, sent };
}

type App = Awaited<ReturnType<typeof build>>["app"];

function upload(app: App, body: Buffer, name = "Horn", session = "a", type?: string) {
  return app.inject({
    method: "POST",
    url: `/api/sounds?name=${encodeURIComponent(name)}`,
    headers: { "x-session-id": session, "content-type": type ?? "application/octet-stream" },
    payload: body,
  });
}

function patch(app: App, id: string, body: object, session = "b") {
  return app.inject({
    method: "PATCH",
    url: `/api/sounds/${id}`,
    headers: { "x-session-id": session },
    payload: body,
  });
}

describe("sound routes", () => {
  it("needs a connected session for everything", async () => {
    const { app } = await build();
    expect((await app.inject({ url: "/api/sounds" })).statusCode).toBe(401);
    expect((await upload(app, WAV, "x", "idle")).statusCode).toBe(401);
    expect((await patch(app, "x", { name: "y" }, "zz")).statusCode).toBe(401);
    const del = await app.inject({ method: "DELETE", url: "/api/sounds/x" });
    expect(del.statusCode).toBe(401);
    expect((await app.inject({ url: "/api/sound-file/x" })).statusCode).toBe(404);
  });

  it("uploads a clip, remembers who did and tells every connected session", async () => {
    const { app, sent } = await build();
    const res = await upload(app, WAV, "  Air  horn ");
    expect(res.statusCode).toBe(201);
    const added = res.json<{ sound: SharedSound }>().sound;
    expect(added).toMatchObject({
      name: "Air horn",
      volume: 100,
      contentType: "audio/wav",
      addedBy: "nick-a",
    });
    const list = await app.inject({ url: "/api/sounds", headers: { "x-session-id": "b" } });
    expect(list.json<{ sounds: SharedSound[] }>().sounds).toEqual([added]);
    expect(sent.get("b")).toEqual([{ type: "sounds.updated", sounds: [added] }]);
    expect(sent.get("idle")).toEqual([]);
  });

  it("judges the type by the bytes, not the header", async () => {
    const { app } = await build();
    const html = Buffer.from("<html><script>alert(1)</script></html>");
    const refused = await upload(app, html, "x.wav");
    expect(refused.statusCode).toBe(415);
    expect(refused.json()).toEqual({ error: "type" });
    // Uploads are untyped; a body claiming a type the hub does not parse is refused outright.
    expect((await upload(app, OGG, "x", "a", "text/html")).statusCode).toBe(415);
    const res = await upload(app, OGG, "x.wav");
    expect(res.statusCode).toBe(201);
    expect(res.json<{ sound: SharedSound }>().sound.contentType).toBe("audio/ogg");
  });

  it("refuses bad names, empty and oversized bodies, and a full board", async () => {
    const { app } = await build();
    expect((await upload(app, WAV, "   ")).json()).toEqual({ error: "name" });
    expect((await upload(app, WAV, "x".repeat(33))).json()).toEqual({ error: "name" });
    expect((await upload(app, Buffer.alloc(0))).statusCode).toBe(400);
    const big = Buffer.concat([WAV, Buffer.alloc(MAX_SOUND_BYTES)]);
    expect((await upload(app, big)).statusCode).toBe(413);
    for (let i = 0; i < MAX_SOUNDS; i++)
      expect((await upload(app, WAV, `s${i}`)).statusCode).toBe(201);
    const full = await upload(app, WAV, "one more");
    expect(full.statusCode).toBe(409);
    expect(full.json()).toEqual({ error: "full" });
  });

  it("lets anyone rename and re-level a clip, and pushes the change", async () => {
    const { app, sent } = await build();
    const id = (await upload(app, WAV)).json<{ sound: SharedSound }>().sound.id;
    const renamed = await patch(app, id, { name: "Honk" });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json<{ sound: SharedSound }>().sound).toMatchObject({ name: "Honk" });
    const louder = await patch(app, id, { volume: 180 });
    expect(louder.json<{ sound: SharedSound }>().sound).toMatchObject({
      name: "Honk",
      volume: 180,
    });
    const last = sent.get("a")!.at(-1) as { type: string; sounds: SharedSound[] };
    expect(last.sounds[0]).toMatchObject({ name: "Honk", volume: 180, addedBy: "nick-a" });

    expect((await patch(app, id, { volume: 201 })).statusCode).toBe(400);
    expect((await patch(app, id, { volume: 1.5 })).statusCode).toBe(400);
    expect((await patch(app, id, { name: "" })).statusCode).toBe(400);
    expect((await patch(app, id, {})).statusCode).toBe(400);
    expect(
      (await patch(app, "0e1a2b3c-0000-4000-8000-000000000000", { name: "x" })).statusCode,
    ).toBe(404);
  });

  it("serves the file with an asset token, never sniffable", async () => {
    const { app } = await build();
    const id = (await upload(app, WAV)).json<{ sound: SharedSound }>().sound.id;
    const res = await app.inject({ url: `/api/sound-file/${id}?token=tok` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("audio/wav");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.rawPayload).toEqual(WAV);
    expect((await app.inject({ url: `/api/sound-file/${id}?token=bad` })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/sound-file/nope?token=tok` })).statusCode).toBe(404);
  });

  it("deletes a clip for everyone", async () => {
    const { app, sent } = await build();
    const id = (await upload(app, WAV)).json<{ sound: SharedSound }>().sound.id;
    const del = () =>
      app.inject({ method: "DELETE", url: `/api/sounds/${id}`, headers: { "x-session-id": "b" } });
    expect((await del()).statusCode).toBe(204);
    expect(sent.get("a")!.at(-1)).toEqual({ type: "sounds.updated", sounds: [] });
    expect((await del()).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/sound-file/${id}?token=tok` })).statusCode).toBe(404);
  });

  it("rate-limits writes per session", async () => {
    const { app } = await build({ limit: 2 });
    expect((await upload(app, WAV, "a")).statusCode).toBe(201);
    expect((await upload(app, WAV, "b")).statusCode).toBe(201);
    expect((await upload(app, WAV, "c")).statusCode).toBe(429);
    // Another session has its own budget.
    expect((await upload(app, WAV, "d", "b")).statusCode).toBe(201);
  });
});
