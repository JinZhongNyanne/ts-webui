import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  HASHED_ASSET_CACHE,
  HTML_CACHE,
  REVALIDATE_CACHE,
  registerWebUi,
  webUiCacheControl,
} from "./web-ui.js";

describe("webUiCacheControl", () => {
  it("never lets HTML or errors be cached", () => {
    expect(webUiCacheControl("/", 200, "text/html; charset=utf-8")).toBe(HTML_CACHE);
    expect(webUiCacheControl("/assets/x.js", 404, "text/plain")).toBe(HTML_CACHE);
  });

  it("keeps hashed assets for good and revalidates the rest", () => {
    expect(webUiCacheControl("/assets/index-abc.js", 200, "application/javascript")).toBe(
      HASHED_ASSET_CACHE,
    );
    expect(webUiCacheControl("/worklets/mixer.js", 200, "application/javascript")).toBe(
      REVALIDATE_CACHE,
    );
  });

  it("keeps the service worker and the manifest revalidating, never immutable", () => {
    // A service worker pinned by an immutable header could not be replaced,
    // so a bad one would outlive every redeploy.
    expect(webUiCacheControl("/sw.js", 200, "text/javascript")).toBe(REVALIDATE_CACHE);
    expect(webUiCacheControl("/manifest.webmanifest", 200, "application/manifest+json")).toBe(
      REVALIDATE_CACHE,
    );
  });

  it("leaves the API alone", () => {
    expect(webUiCacheControl("/api/config", 200, "application/json")).toBeNull();
    expect(webUiCacheControl("/ws", 404, "application/json")).toBeNull();
  });
});

describe("registerWebUi", () => {
  let root: string;
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), "webui-"));
    mkdirSync(path.join(root, "assets"));
    mkdirSync(path.join(root, "worklets"));
    writeFileSync(path.join(root, "index.html"), "<!doctype html><title>t</title>");
    writeFileSync(path.join(root, "assets", "index-NEW.js"), "console.log(1)");
    writeFileSync(path.join(root, "worklets", "mixer.js"), "// worklet");
    app = Fastify();
    await registerWebUi(app, root);
    app.get("/api/config", async () => ({ ok: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("serves the page uncached, at the root and on client routes", async () => {
    for (const url of ["/", "/index.html", "/some/client/route"]) {
      const res = await app.inject(url);
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["content-type"], url).toContain("text/html");
      expect(res.headers["cache-control"], url).toBe(HTML_CACHE);
    }
  });

  it("caches hashed assets for good and revalidates worklets", async () => {
    const asset = await app.inject("/assets/index-NEW.js");
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["cache-control"]).toBe(HASHED_ASSET_CACHE);
    const worklet = await app.inject("/worklets/mixer.js");
    expect(worklet.headers["cache-control"]).toBe(REVALIDATE_CACHE);
  });

  it("answers a previous build's script with a 404, not the page", async () => {
    for (const url of ["/assets/index-OLD.js", "/assets/style-OLD.css", "/favicon.ico"]) {
      const res = await app.inject(url);
      expect(res.statusCode, url).toBe(404);
      expect(res.headers["content-type"], url).not.toContain("text/html");
      expect(res.headers["cache-control"], url).toBe(HTML_CACHE);
    }
  });

  it("404s a missing worker or manifest instead of answering with the page", async () => {
    // The browser refuses HTML for either, but a 200 would make the failure
    // silent: registration would report success on a page it cannot run.
    for (const url of ["/sw.js", "/manifest.webmanifest", "/icons/icon-192.png"]) {
      const res = await app.inject(url);
      expect(res.statusCode, url).toBe(404);
      expect(res.headers["content-type"], url).not.toContain("text/html");
    }
  });

  it("keeps API 404s as JSON and does not touch API caching", async () => {
    const missing = await app.inject("/api/nope");
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "not found" });
    const ok = await app.inject("/api/config");
    expect(ok.headers["cache-control"]).toBeUndefined();
  });
});
