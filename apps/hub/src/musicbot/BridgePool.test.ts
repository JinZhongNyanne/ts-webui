import { describe, expect, it, vi } from "vitest";
import { BridgePool, type PooledBridge } from "./BridgePool.js";
import type { BotBridgeOptions } from "./BotBridge.js";
import type { Logger } from "../logger.js";
import { MAX_POOLED_BRIDGES } from "./target.js";

const silent = {
  info: () => undefined,
  warn: () => undefined,
  debug: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  trace: () => undefined,
  child: () => silent,
} as unknown as Logger;

interface StubBridge extends PooledBridge {
  opts: BotBridgeOptions;
  stop: ReturnType<typeof vi.fn>;
}

function makeHarness(config: Partial<ConstructorParameters<typeof BridgePool>[0]["config"]> = {}) {
  const created: StubBridge[] = [];
  const factory = (opts: BotBridgeOptions): PooledBridge => {
    const bridge: StubBridge = {
      opts,
      available: true,
      summaries: () => [],
      subscribe: () => () => undefined,
      request: async () => ({ status: 200, body: {} }),
      start: async () => undefined,
      stop: vi.fn(),
      radioOf: (id) => opts.state?.radios.get(id) ?? null,
      setRadio: (id, radio) =>
        void (radio ? opts.state?.radios.set(id, radio) : opts.state?.radios.delete(id)),
      queueOf: () => [],
      refreshQueue: async () => [],
      credit: () => undefined,
      relabel: (_path, body) => body,
    };
    created.push(bridge);
    return bridge;
  };
  const pool = new BridgePool({
    config: {
      MUSICBOT_URL: "",
      MUSICBOT_USERNAME: "",
      MUSICBOT_PASSWORD: "",
      MUSICBOT_INSECURE_TLS: false,
      ...config,
    },
    logger: silent,
    factory,
  });
  return { pool, created };
}

describe("BridgePool", () => {
  // Personal FM keeps playing on the bot after the last browser leaves, so the
  // lock on its play mode must still be there when someone comes back.
  it("keeps a bot's radio across the bridge being stopped and recreated", async () => {
    const { pool, created } = makeHarness();
    const first = await pool.acquire("http://bot:3000");
    first.setRadio("b1", "fm");
    pool.release("http://bot:3000");
    expect(created[0]!.stop).toHaveBeenCalled();

    const second = await pool.acquire("http://bot:3000");
    expect(second).not.toBe(first);
    expect(second.radioOf("b1")).toBe("fm");
    expect((await pool.acquire("http://other:3000")).radioOf("b1")).toBeNull();
  });

  it("shares one bridge between sessions on the same url", async () => {
    const { pool, created } = makeHarness();
    const a = await pool.acquire("http://bot:3000");
    const b = await pool.acquire("http://bot:3000");
    expect(a).toBe(b);
    expect(created).toHaveLength(1);
    expect(pool.refs("http://bot:3000")).toBe(2);
  });

  it("creates separate bridges for different urls", async () => {
    const { pool, created } = makeHarness();
    await pool.acquire("http://bot-a:3000");
    await pool.acquire("http://bot-b:3000");
    expect(created).toHaveLength(2);
  });

  it("stops the bridge only when the last reference is released", async () => {
    const { pool, created } = makeHarness();
    await pool.acquire("http://bot:3000");
    await pool.acquire("http://bot:3000");
    pool.release("http://bot:3000");
    expect(created[0]!.stop).not.toHaveBeenCalled();
    expect(pool.refs("http://bot:3000")).toBe(1);
    pool.release("http://bot:3000");
    expect(created[0]!.stop).toHaveBeenCalledTimes(1);
    expect(pool.refs("http://bot:3000")).toBe(0);
  });

  it("creates a fresh bridge after the old one was dropped", async () => {
    const { pool, created } = makeHarness();
    const first = await pool.acquire("http://bot:3000");
    pool.release("http://bot:3000");
    const second = await pool.acquire("http://bot:3000");
    expect(second).not.toBe(first);
    expect(created).toHaveLength(2);
  });

  it("ignores a release for an unknown url", () => {
    const { pool } = makeHarness();
    expect(() => pool.release("http://nobody:3000")).not.toThrow();
  });

  it("uses guest mode for an arbitrary bot", async () => {
    const { pool, created } = makeHarness({
      MUSICBOT_URL: "http://musicbot:3000",
      MUSICBOT_USERNAME: "svc",
      MUSICBOT_PASSWORD: "pw",
      MUSICBOT_INSECURE_TLS: true,
    });
    await pool.acquire("http://other:3000");
    expect(created[0]!.opts.username).toBe("");
    expect(created[0]!.opts.password).toBe("");
    expect(created[0]!.opts.insecureTls).toBe(false);
  });

  it("reuses the configured credentials for the operator's bot", async () => {
    const { pool, created } = makeHarness({
      MUSICBOT_URL: "http://musicbot:3000/",
      MUSICBOT_USERNAME: "svc",
      MUSICBOT_PASSWORD: "pw",
      MUSICBOT_INSECURE_TLS: true,
    });
    await pool.acquire("http://musicbot:3000");
    expect(created[0]!.opts.username).toBe("svc");
    expect(created[0]!.opts.password).toBe("pw");
    expect(created[0]!.opts.insecureTls).toBe(true);
  });

  it("still hands out the bridge when its start attempt fails", async () => {
    const { pool } = makeHarness();
    const failing = new BridgePool({
      config: {
        MUSICBOT_URL: "",
        MUSICBOT_USERNAME: "",
        MUSICBOT_PASSWORD: "",
        MUSICBOT_INSECURE_TLS: false,
      },
      logger: silent,
      factory: (opts) => ({
        available: false,
        summaries: () => [],
        subscribe: () => () => undefined,
        request: async () => ({ status: 502, body: null }),
        start: async () => {
          throw new Error(`boom ${opts.baseUrl}`);
        },
        stop: () => undefined,
      }),
    });
    const bridge = await failing.acquire("http://bot:3000");
    expect(bridge.available).toBe(false);
    expect(pool.refs("http://bot:3000")).toBe(0);
  });

  it("stopAll stops every bridge and forgets them", async () => {
    const { pool, created } = makeHarness();
    await pool.acquire("http://bot-a:3000");
    await pool.acquire("http://bot-b:3000");
    pool.stopAll();
    expect(created.every((b) => b.stop.mock.calls.length === 1)).toBe(true);
    expect(pool.refs("http://bot-a:3000")).toBe(0);
  });

  it("passes the pinned address to the bridge it creates", async () => {
    const { pool, created } = makeHarness();
    await pool.acquire("http://bot:3000", "203.0.113.5");
    expect(created[0]?.opts.pinnedAddress).toBe("203.0.113.5");
  });

  it("refuses to bridge more than MAX_POOLED_BRIDGES distinct bots", async () => {
    const { pool } = makeHarness();
    for (let i = 0; i < MAX_POOLED_BRIDGES; i++) await pool.acquire(`http://bot-${i}:3000`);
    await expect(pool.acquire("http://one-too-many:3000")).rejects.toThrow("hub.musicUnreachable");
    // An already pooled bot is still shareable when the pool is full.
    await expect(pool.acquire("http://bot-0:3000")).resolves.toBeDefined();
  });
});
