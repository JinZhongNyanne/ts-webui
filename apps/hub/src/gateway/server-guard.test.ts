import { describe, expect, it } from "vitest";
import {
  CATALOG_RETRY_MS,
  CONNECT_SPACING_MS,
  FLOOD_BACKOFF_MS,
  FLOOD_BAN_COOLDOWN_MS,
  PACE_QUEUE_MAX,
  SPACING_MS,
  ServerGuard,
  GuardBusyError,
  TS_CMD_BURST,
  TS_CMD_MAX_WAIT_MS,
  TS_CMD_REFILL_MS,
  TS_CMD_SPACING_MS,
  guardFor,
  isFloodBan,
  type Clock,
} from "./server-guard.js";

/** A clock whose sleeps advance time instantly, recording when things ran. */
function fakeClock(): Clock & { t: number } {
  const clock = {
    t: 1_000_000,
    now: () => clock.t,
    sleep: async (ms: number) => {
      clock.t += ms;
    },
  };
  return clock;
}

describe("ServerGuard", () => {
  it("spaces optional commands from every session", async () => {
    const clock = fakeClock();
    const guard = new ServerGuard(clock);
    const at: number[] = [];
    await Promise.all([1, 2, 3].map(() => guard.paced(async () => void at.push(clock.t))));
    expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(SPACING_MS);
    expect(at[2]! - at[1]!).toBeGreaterThanOrEqual(SPACING_MS);
  });

  it("keeps pacing after a failed command", async () => {
    const guard = new ServerGuard(fakeClock());
    await expect(guard.paced(async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    await expect(guard.paced(async () => 42)).resolves.toBe(42);
  });

  it("refuses optional work once the pace queue is full, never required work", async () => {
    const guard = new ServerGuard(fakeClock());
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    // One running (held open), the rest waiting behind it.
    const queued = Array.from({ length: PACE_QUEUE_MAX }, () =>
      guard.paced(() => gate, { optional: true }),
    );
    expect(guard.pacedDepth).toBe(PACE_QUEUE_MAX);
    const refused = guard.paced(async () => 1, { optional: true });
    await expect(refused).rejects.toBeInstanceOf(GuardBusyError);
    // Required work (a permission lookup, a subscribe) still queues.
    const required = guard.paced(async () => 2);
    expect(guard.pacedDepth).toBe(PACE_QUEUE_MAX + 1);
    release();
    await Promise.all(queued);
    await expect(required).resolves.toBe(2);
    expect(guard.pacedDepth).toBe(0);
    await expect(guard.paced(async () => 3, { optional: true })).resolves.toBe(3);
  });

  it("lets handshakes start one at a time", async () => {
    const clock = fakeClock();
    const guard = new ServerGuard(clock);
    const at: number[] = [];
    await Promise.all([1, 2, 3].map(() => guard.connectSlot().then(() => at.push(clock.t))));
    expect(at[2]! - at[0]!).toBeGreaterThanOrEqual(2 * CONNECT_SPACING_MS);
  });

  it("remembers a flood warning, a flood ban and a refused catalog for a while", () => {
    const clock = fakeClock();
    const guard = new ServerGuard(clock);
    expect(guard.flooded).toBe(false);
    guard.noteFlood();
    expect(guard.flooded).toBe(true);
    clock.t += FLOOD_BACKOFF_MS + 1;
    expect(guard.flooded).toBe(false);

    guard.noteFloodBan();
    expect(guard.banCooldownMs).toBe(FLOOD_BAN_COOLDOWN_MS);
    expect(guard.flooded).toBe(true);
    clock.t += FLOOD_BAN_COOLDOWN_MS;
    expect(guard.banCooldownMs).toBe(0);

    guard.noteCatalogRefused();
    expect(guard.catalogRefused).toBe(true);
    clock.t += CATALOG_RETRY_MS + 1;
    expect(guard.catalogRefused).toBe(false);
  });

  it("is shared per server", () => {
    expect(guardFor("a:9987")).toBe(guardFor("a:9987"));
    expect(guardFor("a:9987")).not.toBe(guardFor("b:9987"));
  });
});

describe("ServerGuard: the hub-wide ts.cmd budget", () => {
  /** Asks for `n` slots at once and returns when each was granted, relative to the start. */
  async function burst(guard: ServerGuard, clock: { t: number }, n: number) {
    const t0 = clock.t;
    // Each ask is made at the same instant, as from many sessions at once.
    return Promise.all(Array.from({ length: n }, () => guard.tsCmdSlot().then(() => clock.t - t0)));
  }

  it("lets a burst through quickly, a small gap apart", async () => {
    const clock = fakeClock();
    const guard = new ServerGuard(clock);
    const at = await burst(guard, clock, TS_CMD_BURST);
    expect(at[0]).toBe(0);
    for (let i = 1; i < at.length; i++) {
      expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(TS_CMD_SPACING_MS);
    }
    expect(at[at.length - 1]).toBeLessThan(TS_CMD_REFILL_MS * 2);
  });

  it("queues past the burst at the refill rate, across every session", async () => {
    const clock = fakeClock();
    const guard = new ServerGuard(clock);
    const at = await burst(guard, clock, TS_CMD_BURST + 3);
    const extra = at.slice(TS_CMD_BURST);
    expect(extra[0]).toBeGreaterThanOrEqual(TS_CMD_REFILL_MS);
    expect(extra[1]! - extra[0]!).toBeGreaterThanOrEqual(TS_CMD_REFILL_MS);
    expect(extra[2]! - extra[1]!).toBeGreaterThanOrEqual(TS_CMD_REFILL_MS);
  });

  it("refuses rather than queue longer than the page would wait, without spending budget", async () => {
    const clock = fakeClock();
    const guard = new ServerGuard(clock);
    const queued = Math.floor(TS_CMD_MAX_WAIT_MS / TS_CMD_REFILL_MS);
    const asks = Array.from({ length: TS_CMD_BURST + queued }, () => guard.tsCmdSlot());
    await expect(guard.tsCmdSlot()).rejects.toBeInstanceOf(GuardBusyError);
    await expect(guard.tsCmdSlot()).rejects.toBeInstanceOf(GuardBusyError);
    await Promise.all(asks);
    // Once the queue has drained and the bucket refilled, a full burst goes again.
    clock.t += TS_CMD_BURST * TS_CMD_REFILL_MS;
    const at = await burst(guard, clock, TS_CMD_BURST);
    expect(at[at.length - 1]).toBeLessThan(TS_CMD_REFILL_MS * 2);
  });

  it("says how long the caller waited", async () => {
    const clock = fakeClock();
    const guard = new ServerGuard(clock);
    expect(await guard.tsCmdSlot()).toBe(0);
    expect(await guard.tsCmdSlot()).toBe(TS_CMD_SPACING_MS);
  });
});

describe("ServerGuard: what the hub itself is on the server", () => {
  it("tracks the client ids of its own sessions", () => {
    const guard = new ServerGuard(fakeClock());
    guard.addHubClient(12);
    guard.addHubClient(40);
    expect(guard.isHubClient(12)).toBe(true);
    expect(guard.isHubClient(13)).toBe(false);
    guard.removeHubClient(12);
    expect(guard.isHubClient(12)).toBe(false);
    expect(guard.isHubClient(40)).toBe(true);
  });

  it("counts: an id released late by one session stays taken by the next", () => {
    const guard = new ServerGuard(fakeClock());
    guard.addHubClient(12);
    guard.addHubClient(12);
    guard.removeHubClient(12);
    expect(guard.isHubClient(12)).toBe(true);
    guard.removeHubClient(12);
    guard.removeHubClient(12);
    expect(guard.isHubClient(12)).toBe(false);
    guard.addHubClient(12);
    expect(guard.isHubClient(12)).toBe(true);
  });

  it("remembers the address the server sees for the hub, if it is one", () => {
    const guard = new ServerGuard(fakeClock());
    expect(guard.hubAddress).toBeNull();
    guard.noteHubAddress("garbage");
    expect(guard.hubAddress).toBeNull();
    guard.noteHubAddress("172.17.0.1");
    expect(guard.hubAddress).toBe("172.17.0.1");
  });
});

describe("isFloodBan", () => {
  it("tells a flood ban from an ordinary ban", () => {
    expect(isFloodBan("3329", "flood prevention, please try again later")).toBe(true);
    expect(isFloodBan("3329", undefined)).toBe(false);
    expect(isFloodBan("3329", "you were banned by admin")).toBe(false);
    expect(isFloodBan("3331", "flood")).toBe(false);
  });
});
