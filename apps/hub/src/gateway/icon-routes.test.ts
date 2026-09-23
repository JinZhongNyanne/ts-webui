import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerIconRoutes } from "./icon-routes.js";
import type { AssetRegistry } from "../session/asset-registry.js";
import type { Session } from "../session/Session.js";

const TOKEN = "t".repeat(32);
const SESSION_ID = "s1";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Accepts exactly one token and one session id; anything else is unknown. */
function fakeRegistry(): AssetRegistry {
  const session = {
    id: SESSION_ID,
    tsSession: {
      fetchIcon: async (id: number) => (id === 5 ? PNG : null),
      fetchAvatar: async (hash: string) => (hash === "abc" ? PNG : null),
    },
  } as unknown as Session;
  return {
    getConnected: (id) => (id === SESSION_ID ? session : undefined),
    getConnectedByAssetToken: (token) => (token === TOKEN ? session : undefined),
  };
}

async function build() {
  const app = Fastify();
  registerIconRoutes(app, fakeRegistry());
  await app.ready();
  return app;
}

describe("icon routes", () => {
  it("serves an icon for a valid token", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: `/api/ts/${TOKEN}/icon/5` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["cache-control"]).toBe("private, max-age=86400");
    expect(res.rawPayload.equals(PNG)).toBe(true);
    await app.close();
  });

  it("serves an avatar for a valid token", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: `/api/ts/${TOKEN}/avatar/abc` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["cache-control"]).toBe("private, max-age=3600");
    await app.close();
  });

  it("refuses the session id in the token slot", async () => {
    const app = await build();
    const icon = await app.inject({ method: "GET", url: `/api/ts/${SESSION_ID}/icon/5` });
    const avatar = await app.inject({ method: "GET", url: `/api/ts/${SESSION_ID}/avatar/abc` });
    expect(icon.statusCode).toBe(404);
    expect(avatar.statusCode).toBe(404);
    await app.close();
  });

  it("refuses an unknown token and an empty token slot", async () => {
    const app = await build();
    const unknown = await app.inject({ method: "GET", url: "/api/ts/nope/icon/5" });
    const empty = await app.inject({ method: "GET", url: "/api/ts//icon/5" });
    expect(unknown.statusCode).toBe(404);
    expect(empty.statusCode).toBe(404);
    await app.close();
  });

  it("answers 404 for a missing icon or an unsafe avatar hash", async () => {
    const app = await build();
    const missing = await app.inject({ method: "GET", url: `/api/ts/${TOKEN}/icon/6` });
    const unsafe = await app.inject({ method: "GET", url: `/api/ts/${TOKEN}/avatar/..%2Fx` });
    expect(missing.statusCode).toBe(404);
    expect(unsafe.statusCode).toBe(404);
    await app.close();
  });
});
