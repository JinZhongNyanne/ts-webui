import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_APPS, type ServerMessage, type SharedApp } from "@jinz/protocol";
import type { Session } from "../session/Session.js";
import type { Logger } from "../logger.js";
import { RateLimiter } from "../security/limits.js";
import { AppStore } from "./store.js";
import { registerAppRoutes, type AppRegistry } from "./routes.js";

const silent = {
  info: () => undefined,
  warn: () => undefined,
  debug: () => undefined,
  error: () => undefined,
  child: () => silent,
} as unknown as Logger;

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

let dir: string;
beforeEach(() => (dir = mkdtempSync(path.join(tmpdir(), "jinz-apps-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function build(
  opts: {
    fetchIcon?: (u: URL) => Promise<{ contentType: string; body: Buffer } | null>;
    limit?: number;
  } = {},
) {
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
  const registry: AppRegistry = {
    getConnected: (id) => sessions.find((s) => s.id === id && s.connected),
    getConnectedByAssetToken: (token) => (token === "tok" ? sessions[0] : undefined),
    values: () => sessions,
  };
  const store = new AppStore(dir, silent);
  const app = Fastify();
  registerAppRoutes(app, {
    store,
    registry,
    logger: silent,
    ownOrigins: ["https://ts.example.com"],
    limiter: opts.limit ? new RateLimiter({ limit: opts.limit, windowMs: 60_000 }) : undefined,
    fetchIcon: opts.fetchIcon ?? (async () => null),
  });
  return { app, store, sent };
}

function add(app: ReturnType<typeof build>["app"], body: object, session = "a") {
  return app.inject({
    method: "POST",
    url: "/api/apps",
    headers: { "x-session-id": session },
    payload: body,
  });
}

describe("app routes", () => {
  it("needs a connected session", async () => {
    const { app } = build();
    expect((await app.inject({ url: "/api/apps" })).statusCode).toBe(401);
    expect((await add(app, { url: "https://a.org" }, "idle")).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/api/apps/x",
          headers: { "x-session-id": "zz" },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("adds a site, remembers who added it and tells every connected session", async () => {
    const { app, sent } = build();
    const res = await add(app, { url: "wiki.example.org", name: "Wiki" });
    expect(res.statusCode).toBe(201);
    const added = res.json<{ app: SharedApp }>().app;
    expect(added).toMatchObject({
      name: "Wiki",
      url: "https://wiki.example.org/",
      addedBy: "nick-a",
      iconRev: null,
    });

    const list = await app.inject({ url: "/api/apps", headers: { "x-session-id": "b" } });
    expect(list.json<{ apps: SharedApp[] }>().apps).toEqual([added]);
    expect(sent.get("b")).toEqual([{ type: "apps.updated", apps: [added] }]);
    expect(sent.get("idle")).toEqual([]);
  });

  it("refuses bad addresses, the app's own origins and duplicates", async () => {
    const { app } = build();
    expect((await add(app, { url: "javascript:alert(1)" })).json()).toEqual({ error: "invalid" });
    expect((await add(app, { url: "https://ts.example.com/x" })).json()).toEqual({
      error: "sameOrigin",
    });
    // The origin the request actually came in on counts too.
    const viaHost = await app.inject({
      method: "POST",
      url: "/api/apps",
      headers: { "x-session-id": "a", host: "10.0.0.2:8080" },
      payload: { url: "http://10.0.0.2:8080/" },
    });
    expect(viaHost.json()).toEqual({ error: "sameOrigin" });
    expect((await add(app, { nope: 1 })).statusCode).toBe(400);
    expect((await add(app, { url: "https://a.org" })).statusCode).toBe(201);
    expect((await add(app, { url: "https://a.org/" })).json()).toEqual({ error: "exists" });
  });

  it("stops at the cap", async () => {
    const { app } = build();
    for (let i = 0; i < MAX_APPS; i++) {
      expect((await add(app, { url: `https://s${i}.org` })).statusCode).toBe(201);
    }
    expect((await add(app, { url: "https://one-more.org" })).json()).toEqual({ error: "full" });
  });

  it("fetches the icon afterwards, pushes it, and serves it with an asset token", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const fetchIcon = vi.fn(async () => {
      await gate;
      return { contentType: "image/png", body: PNG };
    });
    const { app, sent } = build({ fetchIcon });
    const added = (await add(app, { url: "https://a.org" })).json<{ app: SharedApp }>().app;
    expect(added.iconRev).toBeNull();
    release();
    await vi.waitFor(() => expect(sent.get("b")).toHaveLength(2));
    const update = sent.get("b")![1] as { type: "apps.updated"; apps: SharedApp[] };
    expect(update.apps[0]!.iconRev).toBe(1);

    const icon = await app.inject({ url: `/api/app-icon/${added.id}?token=tok` });
    expect(icon.statusCode).toBe(200);
    expect(icon.headers["content-type"]).toBe("image/png");
    expect(icon.rawPayload).toEqual(PNG);
    expect((await app.inject({ url: `/api/app-icon/${added.id}?token=bad` })).statusCode).toBe(404);
  });

  it("removes a site for everyone", async () => {
    const { app, sent } = build();
    const added = (await add(app, { url: "https://a.org" })).json<{ app: SharedApp }>().app;
    const res = await app.inject({
      method: "DELETE",
      url: `/api/apps/${added.id}`,
      headers: { "x-session-id": "b" },
    });
    expect(res.statusCode).toBe(204);
    expect(sent.get("a")!.at(-1)).toEqual({ type: "apps.updated", apps: [] });
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/apps/${added.id}`,
          headers: { "x-session-id": "b" },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("keeps the list across a restart", async () => {
    const { app } = build();
    await add(app, { url: "https://a.org", name: "A" });
    const again = new AppStore(dir, silent);
    expect(again.list().map((a) => a.name)).toEqual(["A"]);
  });

  it("rate-limits writes per session", async () => {
    const { app } = build({ limit: 2 });
    expect((await add(app, { url: "https://a.org" })).statusCode).toBe(201);
    expect((await add(app, { url: "https://b.org" })).statusCode).toBe(201);
    expect((await add(app, { url: "https://c.org" })).statusCode).toBe(429);
  });
});
