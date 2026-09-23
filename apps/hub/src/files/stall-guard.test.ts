import { PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StallGuard, StalledTransfer } from "./stall-guard.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const limits = { windowMs: 1000, minBytes: 100 };

/** Pumps `source` through a guard into a sink that is read (no backpressure). */
function run(expected: number) {
  const source = new PassThrough();
  const sink = new PassThrough();
  sink.resume();
  const guard = new StallGuard(expected, limits);
  const done = pipeline(source, guard, sink).then(
    () => null,
    (err: unknown) => err,
  );
  return { source, done };
}

describe("StallGuard", () => {
  it("passes a transfer that keeps moving", async () => {
    const { source, done } = run(300);
    for (let i = 0; i < 3; i++) {
      source.write(Buffer.alloc(100));
      await vi.advanceTimersByTimeAsync(900);
    }
    source.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(await done).toBeNull();
  });

  it("cuts off a trickle", async () => {
    const { source, done } = run(10_000);
    source.write(Buffer.alloc(100));
    await vi.advanceTimersByTimeAsync(1000);
    source.write(Buffer.alloc(1));
    await vi.advanceTimersByTimeAsync(2000);
    expect(await done).toBeInstanceOf(StalledTransfer);
  });

  it("cuts off a transfer that stops altogether", async () => {
    const { done } = run(10_000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await done).toBeInstanceOf(StalledTransfer);
  });

  it("asks a small transfer only for what is left of it", async () => {
    // Fewer bytes than the window wants, but the whole file.
    const { source, done } = run(10);
    await vi.advanceTimersByTimeAsync(900);
    source.write(Buffer.alloc(10));
    source.end();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await done).toBeNull();
  });

  it("cuts off a small transfer that never arrives", async () => {
    const { source, done } = run(10);
    source.write(Buffer.alloc(9));
    await vi.advanceTimersByTimeAsync(2000);
    expect(await done).toBeInstanceOf(StalledTransfer);
  });

  it("holds no timer past the transfer", async () => {
    const guard = new StallGuard(1, limits);
    guard.resume();
    guard.end(Buffer.alloc(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
