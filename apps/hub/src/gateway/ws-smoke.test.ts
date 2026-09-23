/**
 * Protocol-level smoke test of the browser <-> hub message flow without a
 * TeamSpeak server: bad JSON, schema errors and commands issued while not
 * connected must all answer with structured errors instead of crashing.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import pino from "pino";
import { Session } from "../session/Session.js";
import { SessionRegistry } from "../session/registry.js";
import { AssetTokenStore } from "../session/asset-token.js";
import { loadConfig } from "../config.js";
import type { ServerMessage } from "@jinz/protocol";

let wss: WebSocketServer;
let port: number;
let tokens: AssetTokenStore;
let registry: SessionRegistry;

beforeAll(async () => {
  const config = loadConfig({ HUB_SESSION_SECRET: "x".repeat(32), BUILD_ID: "abc1234" });
  const logger = pino({ level: "silent" });
  tokens = new AssetTokenStore();
  registry = new SessionRegistry(tokens);
  wss = new WebSocketServer({ port: 0 });
  wss.on("connection", (socket) => new Session(socket, { config, logger, registry }));
  await new Promise<void>((r) => wss.once("listening", () => r()));
  port = (wss.address() as AddressInfo).port;
});

afterAll(() => {
  wss.close();
});

function open(): Promise<{ ws: WebSocket; next: () => Promise<ServerMessage> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const queue: ServerMessage[] = [];
    const waiters: Array<(m: ServerMessage) => void> = [];
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      const w = waiters.shift();
      if (w) w(m);
      else queue.push(m);
    });
    ws.on("error", reject);
    ws.on("open", () =>
      resolve({
        ws,
        next: () =>
          new Promise((res) => {
            const q = queue.shift();
            if (q) res(q);
            else waiters.push(res);
          }),
      }),
    );
  });
}

describe("hub websocket session", () => {
  it("greets with hello and rejects malformed input", async () => {
    const { ws, next } = await open();
    const hello = await next();
    expect(hello.type).toBe("hello");
    if (hello.type === "hello") {
      expect(hello.sessionId).toMatch(/[0-9a-f-]{36}/);
      expect(hello.assetToken.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(hello.assetToken.expiresAt).toBeGreaterThan(Date.now());
      expect(hello.build).toBe("abc1234");
    }

    ws.send("not json");
    const e1 = await next();
    expect(e1).toMatchObject({ type: "error", code: "bad_json" });

    ws.send(JSON.stringify({ type: "moveTo", channelId: "abc" }));
    const e2 = await next();
    expect(e2).toMatchObject({ type: "error", code: "bad_message" });

    ws.send(JSON.stringify({ type: "moveTo", channelId: "1" }));
    const e3 = await next();
    expect(e3).toMatchObject({ type: "error", code: "not_connected" });

    ws.send(JSON.stringify({ type: "ping", t: 42 }));
    const pong = await next();
    expect(pong).toEqual({ type: "pong", t: 42 });
    ws.close();
  });

  it("accepts room bookkeeping with no TeamSpeak session instead of erroring", async () => {
    // These are keyed by session, not by the TeamSpeak link, and the registry
    // is cleaned up server-side when a session ends. Answering them with
    // `not_connected` only put a red line in the user's log on every
    // reconnect, because the browser sends them while tearing the room down.
    const { ws, next } = await open();
    expect((await next()).type).toBe("hello");

    ws.send(JSON.stringify({ type: "rtc.publishing", camera: false, screen: false }));
    ws.send(JSON.stringify({ type: "rtc.leave" }));
    // A ping behind them: if either had answered, we would read that first.
    ws.send(JSON.stringify({ type: "ping", t: 7 }));
    expect(await next()).toEqual({ type: "pong", t: 7 });

    // A command that genuinely needs the session still says so.
    ws.send(JSON.stringify({ type: "moveTo", channelId: "1" }));
    expect(await next()).toMatchObject({ type: "error", code: "not_connected" });
    ws.close();
  });

  it("rotates the asset token on request and keeps both bound to the session", async () => {
    const { ws, next } = await open();
    const hello = await next();
    if (hello.type !== "hello") throw new Error(`expected hello, got ${hello.type}`);

    ws.send(JSON.stringify({ type: "assetToken.refresh" }));
    const rotated = await next();
    expect(rotated.type).toBe("assetToken");
    if (rotated.type !== "assetToken") throw new Error(`expected assetToken, got ${rotated.type}`);
    expect(rotated.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(rotated.token).not.toBe(hello.assetToken.token);
    expect(rotated.expiresAt).toBeGreaterThanOrEqual(hello.assetToken.expiresAt);

    // Without a TeamSpeak link the registry refuses both tokens...
    expect(registry.get(hello.sessionId)).toBeDefined();
    expect(registry.getConnectedByAssetToken(hello.assetToken.token)).toBeUndefined();
    expect(registry.getConnectedByAssetToken(rotated.token)).toBeUndefined();
    // ...but both are bound to this session: a registry sharing the same token
    // store, with a connected stand-in under the same id, answers for both.
    const connected = { id: hello.sessionId, tsSession: { selfClientId: 1 } } as unknown as Session;
    const probe = new SessionRegistry(tokens);
    probe.add(connected);
    expect(probe.getConnectedByAssetToken(hello.assetToken.token)).toBe(connected);
    expect(probe.getConnectedByAssetToken(rotated.token)).toBe(connected);
    ws.close();
  });

  it("stops a session from flooding the command queue", async () => {
    const config = loadConfig({
      HUB_SESSION_SECRET: "x".repeat(32),
      HUB_COMMAND_RATE_PER_MIN: "3",
    });
    const logger = pino({ level: "silent" });
    const local = new WebSocketServer({ port: 0 });
    local.on("connection", (socket) => {
      new Session(socket, { config, logger, registry: new SessionRegistry() });
    });
    await new Promise<void>((r) => local.once("listening", () => r()));
    const p = (local.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${p}/ws`);
    const messages: ServerMessage[] = [];
    await new Promise<void>((resolve) => {
      ws.on("message", (d) => {
        messages.push(JSON.parse(d.toString()) as ServerMessage);
        if (messages.length === 5) resolve();
      });
      ws.on("open", () => {
        for (let i = 0; i < 6; i++) ws.send(JSON.stringify({ type: "ping", t: i }));
      });
    });
    // hello, three pongs, then the budget is spent.
    expect(messages.slice(1, 4).map((m) => m.type)).toEqual(["pong", "pong", "pong"]);
    expect(messages[4]).toMatchObject({ type: "error", code: "rate_limited" });
    ws.close();
    local.close();
  });

  it("answers every ts.cmd with a result under its id, even when refused", async () => {
    const config = loadConfig({
      HUB_SESSION_SECRET: "x".repeat(32),
      HUB_TS_CMD_RATE_PER_MIN: "2",
    });
    const logger = pino({ level: "silent" });
    const local = new WebSocketServer({ port: 0 });
    local.on("connection", (socket) => {
      new Session(socket, { config, logger, registry: new SessionRegistry() });
    });
    await new Promise<void>((r) => local.once("listening", () => r()));
    const p = (local.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${p}/ws`);
    const messages: ServerMessage[] = [];
    const cmd = (id: string, name: string, args: unknown) =>
      ws.send(JSON.stringify({ type: "ts.cmd", id, cmd: name, args }));
    await new Promise<void>((resolve) => {
      ws.on("message", (d) => {
        messages.push(JSON.parse(d.toString()) as ServerMessage);
        if (messages.length === 5) resolve();
      });
      ws.on("open", () => {
        // A field serveredit does not allow: refused by the schema, before any budget is spent.
        cmd("a", "serveredit", { virtualserver_password: "pwned" });
        cmd("b", "channelsubscribeall", {});
        cmd("c", "servergrouplist", {});
        cmd("d", "channelgrouplist", {});
      });
    });
    expect(messages.slice(1)).toEqual([
      { type: "ts.cmdResult", id: "a", ok: false, code: "bad_args", message: "tsErr.badArgs" },
      {
        type: "ts.cmdResult",
        id: "b",
        ok: false,
        code: "not_connected",
        message: "tsErr.notConnected",
      },
      {
        type: "ts.cmdResult",
        id: "c",
        ok: false,
        code: "not_connected",
        message: "tsErr.notConnected",
      },
      // The ts.cmd budget (2 a minute here) is spent.
      {
        type: "ts.cmdResult",
        id: "d",
        ok: false,
        code: "rate_limited",
        message: "hub.rateLimited",
      },
    ]);
    ws.close();
    local.close();
  });

  it("refuses servers outside the allow list", async () => {
    const config = loadConfig({
      HUB_SESSION_SECRET: "x".repeat(32),
      HUB_ALLOWED_TS_SERVERS: "ts.example.com:9987",
    });
    const logger = pino({ level: "silent" });
    const local = new WebSocketServer({ port: 0 });
    local.on("connection", (socket) => {
      new Session(socket, { config, logger, registry: new SessionRegistry() });
    });
    await new Promise<void>((r) => local.once("listening", () => r()));
    const p = (local.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${p}/ws`);
    const messages: ServerMessage[] = [];
    await new Promise<void>((resolve) => {
      ws.on("message", (d) => {
        messages.push(JSON.parse(d.toString()) as ServerMessage);
        if (messages.length === 2) resolve();
      });
      ws.on("open", () =>
        ws.send(JSON.stringify({ type: "connect", host: "evil.example.org", nickname: "Tester" })),
      );
    });
    expect(messages[1]).toMatchObject({ type: "error", code: "server_not_allowed" });
    ws.close();
    local.close();
  });
});
