import { describe, expect, it } from "vitest";
import {
  EMPTY_QUEUE,
  cancelTransfer,
  clearFinished,
  deferTransfer,
  enqueue,
  failTransfer,
  finishTransfer,
  isFinished,
  nextToStart,
  progressTransfer,
  runningCount,
  startTransfer,
  MAX_FINISHED,
  type NewTransfer,
} from "./transfer-queue";

const upload = (id: string, size = 100): NewTransfer => ({
  id,
  kind: "upload",
  cid: "5",
  path: `/${id}.bin`,
  name: `${id}.bin`,
  size,
});

describe("transfer queue", () => {
  it("queues new transfers in order and never changes the old state", () => {
    const q1 = enqueue(EMPTY_QUEUE, upload("a"));
    const q2 = enqueue(q1, upload("b"));
    expect(q1.items).toHaveLength(1);
    expect(q2.items.map((t) => [t.id, t.state, t.loaded])).toEqual([
      ["a", "queued", 0],
      ["b", "queued", 0],
    ]);
  });

  it("starts at most `max` at once, oldest first", () => {
    let q = ["a", "b", "c"].reduce((acc, id) => enqueue(acc, upload(id)), EMPTY_QUEUE);
    expect(nextToStart(q, 2, 0).map((t) => t.id)).toEqual(["a", "b"]);
    q = startTransfer(q, "a", 1);
    expect(runningCount(q)).toBe(1);
    expect(nextToStart(q, 2, 0).map((t) => t.id)).toEqual(["b"]);
    q = startTransfer(q, "b", 2);
    expect(nextToStart(q, 2, 0)).toEqual([]);
    q = finishTransfer(q, "a", 3);
    expect(nextToStart(q, 2, 0).map((t) => t.id)).toEqual(["c"]);
  });

  it("tracks progress of a running transfer, clamped to its size", () => {
    let q = startTransfer(enqueue(EMPTY_QUEUE, upload("a", 100)), "a", 1);
    q = progressTransfer(q, "a", 40);
    expect(q.items[0]!.loaded).toBe(40);
    q = progressTransfer(q, "a", 400);
    expect(q.items[0]!.loaded).toBe(100);
  });

  it("finishing fills the progress; failing keeps the reason", () => {
    let q = enqueue(enqueue(EMPTY_QUEUE, upload("a")), upload("b"));
    q = finishTransfer(startTransfer(q, "a", 1), "a", 5);
    q = failTransfer(q, "b", "Wrong channel password", 6);
    expect(q.items[0]).toMatchObject({ state: "done", loaded: 100, finishedAt: 5 });
    expect(q.items[1]).toMatchObject({ state: "failed", error: "Wrong channel password" });
  });

  it("cancels queued and running ones, and nothing that has finished", () => {
    let q = enqueue(enqueue(EMPTY_QUEUE, upload("a")), upload("b"));
    q = startTransfer(q, "a", 1);
    q = cancelTransfer(q, "a", 2);
    q = cancelTransfer(q, "b", 2);
    expect(q.items.map((t) => t.state)).toEqual(["cancelled", "cancelled"]);
    const done = finishTransfer(startTransfer(enqueue(EMPTY_QUEUE, upload("c")), "c", 1), "c", 2);
    expect(cancelTransfer(done, "c", 3)).toBe(done);
  });

  it("ignores events for unknown ids and out-of-order events", () => {
    const q = enqueue(EMPTY_QUEUE, upload("a"));
    expect(progressTransfer(q, "a", 5)).toBe(q); // not running yet
    expect(finishTransfer(q, "zz", 1)).toBe(q);
    const cancelled = cancelTransfer(q, "a", 1);
    // A late answer after a cancel changes nothing.
    expect(finishTransfer(cancelled, "a", 2)).toBe(cancelled);
    expect(failTransfer(cancelled, "a", "x", 2)).toBe(cancelled);
    expect(startTransfer(cancelled, "a", 2)).toBe(cancelled);
  });

  it("keeps the reason's code next to its text", () => {
    const q = failTransfer(enqueue(EMPTY_QUEUE, upload("a")), "a", "File exists", 1, "2050");
    expect(q.items[0]).toMatchObject({ state: "failed", error: "File exists", code: "2050" });
  });

  it("puts a transfer that has to wait back in line, not before its time", () => {
    let q = ["a", "b"].reduce((acc, id) => enqueue(acc, upload(id)), EMPTY_QUEUE);
    q = startTransfer(q, "a", 1);
    q = progressTransfer(q, "a", 30);
    q = deferTransfer(q, "a", 1_000);
    expect(q.items[0]).toMatchObject({ state: "queued", loaded: 0, waitUntil: 1_000 });
    expect(nextToStart(q, 2, 999).map((t) => t.id)).toEqual(["b"]);
    expect(nextToStart(q, 2, 1_000).map((t) => t.id)).toEqual(["a", "b"]);
    // Started again, it no longer waits.
    expect(startTransfer(q, "a", 1_000).items[0]!.waitUntil).toBeUndefined();
  });

  it("starts internal transfers first and past the limit", () => {
    let q = ["a", "b"].reduce((acc, id) => enqueue(acc, upload(id)), EMPTY_QUEUE);
    q = startTransfer(startTransfer(q, "a", 1), "b", 1);
    q = enqueue(q, upload("c"));
    q = enqueue(q, { ...upload("avatar"), origin: "internal" });
    expect(nextToStart(q, 2, 0).map((t) => t.id)).toEqual(["avatar"]);
    q = startTransfer(q, "avatar", 2);
    // A running internal one does not hold up the others either.
    q = finishTransfer(q, "a", 3);
    expect(nextToStart(q, 2, 0).map((t) => t.id)).toEqual(["c"]);
  });

  it("remembers where a transfer came from", () => {
    const q = enqueue(enqueue(EMPTY_QUEUE, upload("a")), { ...upload("b"), origin: "chat" });
    expect(q.items.map((t) => t.origin)).toEqual(["browser", "chat"]);
  });

  it(`keeps at most ${MAX_FINISHED} finished transfers, dropping the oldest`, () => {
    let q = EMPTY_QUEUE;
    for (let i = 0; i < MAX_FINISHED + 5; i++) {
      q = failTransfer(enqueue(q, upload(`f${i}`)), `f${i}`, "x", i);
    }
    q = enqueue(q, upload("new"));
    expect(q.items).toHaveLength(MAX_FINISHED + 1);
    expect(q.items[0]!.id).toBe("f5");
    expect(q.items.at(-1)!.id).toBe("new");
  });

  it("clears the finished ones only", () => {
    let q = ["a", "b", "c"].reduce((acc, id) => enqueue(acc, upload(id)), EMPTY_QUEUE);
    q = finishTransfer(startTransfer(q, "a", 1), "a", 2);
    q = failTransfer(q, "b", "x", 2);
    q = clearFinished(q);
    expect(q.items.map((t) => t.id)).toEqual(["c"]);
    expect(isFinished(q.items[0]!)).toBe(false);
  });
});
