import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerHubAuth } from "./auth-routes.js";
import { HUB_AUTH_COOKIE, HubAuth } from "../security/hub-auth.js";
import { RateLimiter } from "../security/limits.js";
import type { Logger } from "../logger.js";

const silent = {
  info: () => undefined,
  warn: () => undefined,
  child: () => silent,
} as unknown as Logger;

async function build(password: string, loginLimit = 10) {
  const app = Fastify();
  await registerHubAuth(app, {
    auth: new HubAuth({ password, secret: "a-secret-that-is-long-enough" }),
    loginLimiter: new RateLimiter({ limit: loginLimit, windowMs: 60_000 }),
    logger: silent,
  });
  app.get("/api/config", async () => ({ ok: true }));
  app.get("/api/health", async () => ({ ok: true }));
  app.get("/index.html", async () => "page");
  await app.ready();
  return app;
}

function passCookie(res: { cookies: Array<{ name: string; value: string }> }): string {
  const cookie = res.cookies.find((c) => c.name === HUB_AUTH_COOKIE);
  return `${HUB_AUTH_COOKIE}=${cookie?.value ?? ""}`;
}

describe("hub password routes", () => {
  it("leaves everything open without a password", async () => {
    const app = await build("");
    expect((await app.inject("/api/auth")).json()).toEqual({
      required: false,
      authenticated: true,
    });
    expect((await app.inject("/api/config")).statusCode).toBe(200);
    await app.close();
  });

  it("guards the api until the right password is given", async () => {
    const app = await build("hunter2");
    expect((await app.inject("/api/auth")).json()).toEqual({
      required: true,
      authenticated: false,
    });
    expect((await app.inject("/api/config")).statusCode).toBe(401);
    expect((await app.inject("/api/config?x=1")).statusCode).toBe(401);
    // The router decodes escapes; the gate must see the same path it does.
    expect((await app.inject("/%61pi/config")).statusCode).toBe(401);
    expect((await app.inject({ method: "HEAD", url: "/%61pi/config" })).statusCode).toBe(401);
    // Health checks and the page itself stay reachable.
    expect((await app.inject("/api/health")).statusCode).toBe(200);
    expect((await app.inject("/index.html")).statusCode).toBe(200);

    const wrong = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "nope" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.cookies).toHaveLength(0);

    const right = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "hunter2" },
    });
    expect(right.statusCode).toBe(200);
    const set = right.cookies.find((c) => c.name === HUB_AUTH_COOKIE);
    expect(set).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/" });

    const cookie = passCookie(right);
    expect((await app.inject({ url: "/api/config", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/auth", headers: { cookie } })).json()).toMatchObject({
      authenticated: true,
    });
    expect(
      (await app.inject({ url: "/api/config", headers: { cookie: `${cookie}x` } })).statusCode,
    ).toBe(401);
    await app.close();
  });

  it("marks the cookie Secure when the page is on https", async () => {
    const app = await build("hunter2");
    const login = (origin?: string) =>
      app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: origin ? { origin } : {},
        payload: { password: "hunter2" },
      });
    const secureOf = (res: Awaited<ReturnType<typeof login>>) =>
      res.cookies.find((c) => c.name === HUB_AUTH_COOKIE)?.secure ?? false;
    expect(secureOf(await login("https://ts.example.com"))).toBe(true);
    expect(secureOf(await login("http://192.168.1.10:5173"))).toBe(false);
    expect(secureOf(await login())).toBe(false);
    await app.close();
  });

  it("clears the cookie on logout", async () => {
    const app = await build("hunter2");
    const res = await app.inject({ method: "POST", url: "/api/auth/logout" });
    expect(res.statusCode).toBe(200);
    const cleared = res.cookies.find((c) => c.name === HUB_AUTH_COOKIE);
    expect(cleared?.value).toBe("");
    expect(cleared?.expires?.getTime()).toBe(0);
    await app.close();
  });

  it("rejects malformed bodies and rate-limits guessing", async () => {
    const app = await build("hunter2", 2);
    const bad = await app.inject({ method: "POST", url: "/api/auth/login", payload: { pw: 1 } });
    expect(bad.statusCode).toBe(400);
    await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "a" } });
    const limited = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "hunter2" },
    });
    expect(limited.statusCode).toBe(429);
    await app.close();
  });
});
