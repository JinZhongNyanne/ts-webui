import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_CSP, cspFor, registerSecurityHeaders, SERVICE_WORKER_PATH } from "./headers.js";

const app = Fastify();

beforeAll(async () => {
  registerSecurityHeaders(app, { isProd: false });
  app.get("/", async (_req, reply) =>
    reply.type("text/html; charset=utf-8").send("<!doctype html>"),
  );
  app.get("/api/x", async () => ({ ok: true }));
  app.get(SERVICE_WORKER_PATH, async (_req, reply) =>
    reply.type("text/javascript; charset=utf-8").send("// sw"),
  );
  await app.ready();
});
afterAll(() => app.close());

function directives(csp: string): Map<string, string> {
  return new Map(
    csp.split(";").map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name!, values.join(" ")];
    }),
  );
}

describe("content security policy", () => {
  it("lets the page frame other sites (the Apps window) but not be framed itself", async () => {
    const res = await app.inject({ url: "/" });
    const csp = directives(String(res.headers["content-security-policy"]));
    expect(csp.get("frame-src")).toContain("https:");
    expect(csp.get("frame-src")).not.toContain("'self'");
    expect(csp.get("frame-ancestors")).toBe("'none'");
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });

  it("lets the page show https images, which the page loads only after consent", async () => {
    // The host banner and a chat [img] are external; with `img-src 'self'`
    // the hub-served build blocked every one of them after the viewer said
    // "load" (the vite dev server sends no CSP, so only production broke).
    const res = await app.inject({ url: "/" });
    const img = String(directives(String(res.headers["content-security-policy"])).get("img-src"));
    expect(img.split(" ").sort()).toEqual(["'self'", "blob:", "data:", "https:"]);
    // Not plain http: an https page cannot load it anyway (mixed content).
    expect(img).not.toContain("http:");
  });

  it("widens nothing but img-src for the page", () => {
    const csp = directives(APP_CSP);
    expect([...csp.keys()]).toEqual([
      "default-src",
      "base-uri",
      "object-src",
      "frame-ancestors",
      "form-action",
      "script-src",
      "style-src",
      "frame-src",
      "img-src",
      "media-src",
      "font-src",
      "worker-src",
      "connect-src",
    ]);
    expect(csp.get("default-src")).toBe("'self'");
    expect(csp.get("script-src")).toBe("'self' 'wasm-unsafe-eval' blob:");
    expect(csp.get("media-src")).toBe("'self' data: blob:");
    expect(csp.get("connect-src")).toBe("'self' ws: wss: blob:");
    expect(csp.get("font-src")).toBe("'self' data:");
  });

  it("keeps API responses locked down", async () => {
    const res = await app.inject({ url: "/api/x" });
    const csp = directives(String(res.headers["content-security-policy"]));
    expect(csp.get("default-src")).toBe("'none'");
    expect(csp.has("frame-src")).toBe(false);
    expect(csp.has("img-src")).toBe(false);
  });
});

describe("the service worker's own policy", () => {
  it("lets the worker script fetch and import from this origin", async () => {
    const res = await app.inject({ url: SERVICE_WORKER_PATH });
    const csp = directives(String(res.headers["content-security-policy"]));
    expect(csp.get("default-src")).toBe("'none'");
    expect(csp.get("script-src")).toBe("'self'");
    expect(csp.get("connect-src")).toBe("'self'");
  });

  it("does not hand that policy to any other script", () => {
    expect(cspFor("/assets/index-abc.js", "text/javascript")).not.toContain("connect-src");
    expect(cspFor("/", "text/html; charset=utf-8")).toBe(APP_CSP);
  });
});
