import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerTtsRoutes, type Synthesizer } from "./routes.js";
import type { AssetRegistry } from "../session/asset-registry.js";
import type { Session } from "../session/Session.js";
import type { Logger } from "../logger.js";
import { RateLimiter } from "../security/limits.js";

const TOKEN = "t".repeat(32);
const SESSION_ID = "s1";
const MP3 = Buffer.from("mp3-bytes");

const silent = {
  info: () => undefined,
  warn: () => undefined,
  debug: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  trace: () => undefined,
  child: () => silent,
} as unknown as Logger;

/** Accepts exactly one token and one session id; anything else is unknown. */
function fakeRegistry(): AssetRegistry {
  const session = { id: SESSION_ID, tsSession: {} } as unknown as Session;
  return {
    getConnected: (id) => (id === SESSION_ID ? session : undefined),
    getConnectedByAssetToken: (token) => (token === TOKEN ? session : undefined),
  };
}

async function build(opts: { limiter?: RateLimiter; fail?: boolean } = {}) {
  const calls: Array<[string, string, string]> = [];
  const synthesize: Synthesizer = async (text, voice, rate) => {
    calls.push([text, voice, rate]);
    if (opts.fail) throw new Error("edge down");
    return MP3;
  };
  const app = Fastify();
  registerTtsRoutes(app, { registry: fakeRegistry(), logger: silent, synthesize, ...opts });
  await app.ready();
  return { app, calls };
}

describe("tts speak route", () => {
  it("synthesizes for a valid token", async () => {
    const { app, calls } = await build();
    const res = await app.inject({
      method: "GET",
      url: `/api/tts/speak?text=hello&voice=en-US-AriaNeural&rate=%2B10%25&token=${TOKEN}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("audio/mpeg");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.rawPayload.equals(MP3)).toBe(true);
    expect(calls).toEqual([["hello", "en-US-AriaNeural", "+10%"]]);
    await app.close();
  });

  it("falls back to the default voice and rate for odd values", async () => {
    const { app, calls } = await build();
    const res = await app.inject({
      method: "GET",
      url: `/api/tts/speak?text=hi&voice=<bad>&rate=fast&token=${TOKEN}`,
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([["hi", "zh-CN-XiaoxiaoNeural", "+0%"]]);
    await app.close();
  });

  it("refuses the session id in the token slot, no token, or ?session=", async () => {
    const { app, calls } = await build();
    const asToken = await app.inject({
      method: "GET",
      url: `/api/tts/speak?text=hi&token=${SESSION_ID}`,
    });
    const none = await app.inject({ method: "GET", url: "/api/tts/speak?text=hi" });
    const legacy = await app.inject({
      method: "GET",
      url: `/api/tts/speak?text=hi&session=${SESSION_ID}`,
    });
    for (const res of [asToken, none, legacy]) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "connect first" });
    }
    expect(calls).toEqual([]);
    await app.close();
  });

  it("answers 400 without text and 502 when synthesis fails", async () => {
    const { app } = await build({ fail: true });
    const empty = await app.inject({ method: "GET", url: `/api/tts/speak?token=${TOKEN}` });
    expect(empty.statusCode).toBe(400);
    const failed = await app.inject({
      method: "GET",
      url: `/api/tts/speak?text=hi&token=${TOKEN}`,
    });
    expect(failed.statusCode).toBe(502);
    await app.close();
  });

  it("rate-limits per session, not per token", async () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 60_000 });
    const { app } = await build({ limiter });
    const first = await app.inject({ method: "GET", url: `/api/tts/speak?text=a&token=${TOKEN}` });
    const second = await app.inject({
      method: "GET",
      url: `/api/tts/speak?text=b&token=${TOKEN}`,
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
    expect(limiter.take(SESSION_ID)).toBe(false);
    await app.close();
  });
});
