import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkCoverUrl } from "./cover-url.js";
import { CoverCache } from "./cover-cache.js";
import { registerCoverRoutes, type AddressResolver } from "./cover-routes.js";
import type { AssetRegistry } from "../session/asset-registry.js";
import type { Session } from "../session/Session.js";
import type { Logger } from "../logger.js";

const silent = {
  info: () => undefined,
  warn: () => undefined,
  debug: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  trace: () => undefined,
  child: () => silent,
} as unknown as Logger;

describe("cover url validation", () => {
  it("accepts plain http and https CDN links", () => {
    const http = checkCoverUrl("http://p4.music.126.net/2026/abc.jpg");
    expect(http.ok).toBe(true);
    expect(http.ok && http.host).toBe("p4.music.126.net");
    expect(checkCoverUrl("https://p4.music.126.net/abc.jpg").ok).toBe(true);
  });

  it("refuses non-http schemes, credentials and junk", () => {
    expect(checkCoverUrl("file:///etc/passwd")).toEqual({ ok: false, reason: "scheme" });
    expect(checkCoverUrl("ftp://example.com/a.jpg")).toEqual({ ok: false, reason: "scheme" });
    expect(checkCoverUrl("data:image/png;base64,AA")).toEqual({ ok: false, reason: "scheme" });
    expect(checkCoverUrl("http://user:pw@example.com/a.jpg")).toEqual({
      ok: false,
      reason: "userinfo",
    });
    expect(checkCoverUrl("/relative.jpg")).toEqual({ ok: false, reason: "unparsable" });
    expect(checkCoverUrl(undefined)).toEqual({ ok: false, reason: "missing" });
  });

  it("unwraps bracketed IPv6 hosts for the address guard", () => {
    const parsed = checkCoverUrl("http://[::1]/a.jpg");
    expect(parsed.ok && parsed.host).toBe("::1");
  });
});

describe("cover cache", () => {
  it("evicts the least recently used entry past the cap", () => {
    const cache = new CoverCache({ maxEntries: 2 });
    const cover = (n: string) => ({ contentType: "image/png", body: Buffer.from(n) });
    cache.set("a", cover("a"));
    cache.set("b", cover("b"));
    cache.get("a"); // "b" is now the oldest
    cache.set("c", cover("c"));
    expect(cache.get("a")).toBeTruthy();
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBeTruthy();
  });

  it("expires entries once the ttl has passed", () => {
    const cache = new CoverCache({ ttlMs: 1000 });
    cache.set("a", { contentType: "image/png", body: Buffer.from("x") }, 0);
    expect(cache.get("a", 500)).toBeTruthy();
    expect(cache.get("a", 1500)).toBeUndefined();
  });
});

describe("cover proxy route", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const session = { id: "s1" } as unknown as Session;

  function build(opts: { resolve?: AddressResolver; token?: string } = {}) {
    const app = Fastify();
    const good = opts.token ?? "tok";
    const registry: AssetRegistry = {
      getConnected: () => undefined,
      getConnectedByAssetToken: (token) => (token === good ? session : undefined),
    };
    registerCoverRoutes(app, {
      registry,
      logger: silent,
      resolve: opts.resolve ?? (async () => ["203.0.113.7"]),
      cache: new CoverCache(),
    });
    return app;
  }

  function ask(app: ReturnType<typeof build>, url: string, token = "tok") {
    return app.inject({
      method: "GET",
      url: `/api/music-bot-cover/${token}?url=${encodeURIComponent(url)}`,
    });
  }

  function imageResponse(body: string | Uint8Array, type = "image/jpeg"): Response {
    return new Response(body, { status: 200, headers: { "content-type": type } });
  }

  it("serves the upstream bytes with its content type and nosniff", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => imageResponse("PNGDATA", "image/png")),
    );
    const app = build();
    const res = await ask(app, "http://p4.music.126.net/a.jpg");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toBe("private, max-age=3600");
    expect(res.rawPayload.toString()).toBe("PNGDATA");
    await app.close();
  });

  it("answers 404 for an unknown token, like a missing icon", async () => {
    const upstream = vi.fn(async () => imageResponse("X"));
    vi.stubGlobal("fetch", upstream);
    const app = build();
    const res = await ask(app, "http://p4.music.126.net/a.jpg", "nope");
    expect(res.statusCode).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
    await app.close();
  });

  it("answers 400 for a missing url, a bad scheme or embedded credentials", async () => {
    const upstream = vi.fn(async () => imageResponse("X"));
    vi.stubGlobal("fetch", upstream);
    const app = build();
    expect((await app.inject({ url: "/api/music-bot-cover/tok" })).statusCode).toBe(400);
    expect((await ask(app, "file:///etc/passwd")).statusCode).toBe(400);
    expect((await ask(app, "ftp://example.com/a.jpg")).statusCode).toBe(400);
    expect((await ask(app, "http://user:pw@example.com/a.jpg")).statusCode).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
    await app.close();
  });

  it("answers 400 when the host resolves into a private range", async () => {
    const upstream = vi.fn(async () => imageResponse("X"));
    vi.stubGlobal("fetch", upstream);
    const app = build({ resolve: async () => ["169.254.169.254"] });
    const res = await ask(app, "http://metadata.example.com/a.jpg");
    expect(res.statusCode).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
    await app.close();
  });

  it("refuses a host whose answers mix a public and a private address", async () => {
    const upstream = vi.fn(async () => imageResponse("X"));
    vi.stubGlobal("fetch", upstream);
    const app = build({ resolve: async () => ["203.0.113.7", "127.0.0.1"] });
    expect((await ask(app, "http://rebind.example.com/a.jpg")).statusCode).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
    await app.close();
  });

  it("answers 502 when upstream is not an image", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }),
      ),
    );
    const app = build();
    const res = await ask(app, "http://p4.music.126.net/a.jpg");
    expect(res.statusCode).toBe(502);
    await app.close();
  });

  it("answers 502 when the body runs past the 2 MB ceiling", async () => {
    const huge = new Uint8Array(3 * 1024 * 1024);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => imageResponse(huge, "image/jpeg")),
    );
    const app = build();
    const res = await ask(app, "http://p4.music.126.net/big.jpg");
    expect(res.statusCode).toBe(502);
    await app.close();
  });

  it("answers 502 when the declared content-length is over the ceiling", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("small", {
            status: 200,
            headers: { "content-type": "image/jpeg", "content-length": String(9 * 1024 * 1024) },
          }),
      ),
    );
    const app = build();
    expect((await ask(app, "http://p4.music.126.net/a.jpg")).statusCode).toBe(502);
    await app.close();
  });

  it("serves a repeated url from cache without a second upstream fetch", async () => {
    const upstream = vi.fn(async () => imageResponse("BYTES", "image/png"));
    vi.stubGlobal("fetch", upstream);
    const app = build();
    const first = await ask(app, "http://p4.music.126.net/a.jpg");
    const second = await ask(app, "http://p4.music.126.net/a.jpg");
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.rawPayload.toString()).toBe("BYTES");
    expect(upstream).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
