import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerProfileRoutes, type ProfileRegistry } from "./routes.js";
import { ProfileStore } from "./store.js";
import type { Session } from "../session/Session.js";

const TOKEN = "t".repeat(32);
const SESSION_ID = "s1";
const UID = "uid=";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Accepts exactly one token and one session id; anything else is unknown. */
function fakeRegistry(sent: unknown[]): ProfileRegistry {
  const session = {
    id: SESSION_ID,
    tsSession: { selfUid: UID },
    send: (msg: unknown) => sent.push(msg),
  } as unknown as Session;
  return {
    getConnected: (id) => (id === SESSION_ID ? session : undefined),
    getConnectedByAssetToken: (token) => (token === TOKEN ? session : undefined),
    values: () => [session],
  };
}

async function build() {
  const sent: unknown[] = [];
  const store = new ProfileStore(mkdtempSync(path.join(tmpdir(), "jinz-profile-routes-")));
  const app = Fastify();
  registerProfileRoutes(app, { store, registry: fakeRegistry(sent) });
  await app.ready();
  return { app, store, sent };
}

describe("profile routes", () => {
  it("lists profiles for the session named in the header", async () => {
    const { app, store } = await build();
    store.save(UID, "icon", PNG, "image/png");
    const res = await app.inject({
      method: "GET",
      url: "/api/profiles",
      headers: { "x-session-id": SESSION_ID },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ profiles: [{ uid: UID, icon: 1, sound: null }] });
    await app.close();
  });

  it("refuses the roster without the header, or with it only in the query", async () => {
    const { app } = await build();
    const missing = await app.inject({ method: "GET", url: "/api/profiles" });
    const query = await app.inject({ method: "GET", url: `/api/profiles?session=${SESSION_ID}` });
    expect(missing.statusCode).toBe(401);
    expect(query.statusCode).toBe(401);
    expect(missing.json()).toEqual({ error: "not connected" });
    await app.close();
  });

  it("serves an asset for a valid token", async () => {
    const { app, store } = await build();
    store.save(UID, "icon", PNG, "image/png");
    const res = await app.inject({
      method: "GET",
      url: `/api/profile/icon?uid=${encodeURIComponent(UID)}&rev=1&token=${TOKEN}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["cache-control"]).toBe("private, max-age=604800");
    expect(res.rawPayload.equals(PNG)).toBe(true);
    await app.close();
  });

  it("refuses an asset GET with the session id, no token, ?session=, or the header", async () => {
    const { app, store } = await build();
    store.save(UID, "icon", PNG, "image/png");
    const uid = encodeURIComponent(UID);
    const asToken = await app.inject({
      method: "GET",
      url: `/api/profile/icon?uid=${uid}&token=${SESSION_ID}`,
    });
    const none = await app.inject({ method: "GET", url: `/api/profile/icon?uid=${uid}` });
    const legacy = await app.inject({
      method: "GET",
      url: `/api/profile/icon?uid=${uid}&session=${SESSION_ID}`,
    });
    const header = await app.inject({
      method: "GET",
      url: `/api/profile/icon?uid=${uid}`,
      headers: { "x-session-id": SESSION_ID },
    });
    for (const res of [asToken, none, legacy, header]) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "not connected" });
    }
    await app.close();
  });

  it("uploads with the header and broadcasts the new revision", async () => {
    const { app, store, sent } = await build();
    const res = await app.inject({
      method: "POST",
      url: "/api/profile/icon",
      headers: { "x-session-id": SESSION_ID, "content-type": "image/png" },
      payload: PNG,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ uid: UID, icon: 1, sound: null });
    expect(store.read(UID, "icon")?.contentType).toBe("image/png");
    expect(sent).toEqual([
      { type: "profile.updated", profile: { uid: UID, icon: 1, sound: null } },
    ]);
    await app.close();
  });

  it("refuses an upload that names the session only in the query", async () => {
    const { app, store } = await build();
    const res = await app.inject({
      method: "POST",
      url: `/api/profile/icon?session=${SESSION_ID}`,
      headers: { "content-type": "image/png" },
      payload: PNG,
    });
    expect(res.statusCode).toBe(401);
    expect(store.read(UID, "icon")).toBeNull();
    await app.close();
  });

  it("deletes with the header and refuses without it", async () => {
    const { app, store } = await build();
    store.save(UID, "icon", PNG, "image/png");
    const denied = await app.inject({ method: "DELETE", url: "/api/profile/icon" });
    expect(denied.statusCode).toBe(401);
    expect(store.read(UID, "icon")).not.toBeNull();
    const res = await app.inject({
      method: "DELETE",
      url: "/api/profile/icon",
      headers: { "x-session-id": SESSION_ID },
    });
    expect(res.statusCode).toBe(200);
    expect(store.read(UID, "icon")).toBeNull();
    await app.close();
  });
});
