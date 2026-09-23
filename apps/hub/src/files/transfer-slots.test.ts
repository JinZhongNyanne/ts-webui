import { describe, expect, it } from "vitest";
import { TransferSlots } from "./transfer-slots.js";

describe("TransferSlots", () => {
  it("counts per session and hub-wide", () => {
    const slots = new TransferSlots(2, 3);
    expect(slots.acquire("a")).toBe(true);
    expect(slots.acquire("a")).toBe(true);
    // The session is full.
    expect(slots.acquire("a")).toBe(false);
    expect(slots.count("a")).toBe(2);
    expect(slots.acquire("b")).toBe(true);
    // The hub is full, whoever asks.
    expect(slots.acquire("b")).toBe(false);
    expect(slots.acquire("c")).toBe(false);
    slots.release("a");
    expect(slots.acquire("c")).toBe(true);
    expect(slots.inUse).toBe(3);
  });

  it("ignores a release for a session holding nothing", () => {
    const slots = new TransferSlots(2, 2);
    slots.release("a");
    slots.acquire("a");
    slots.release("a");
    slots.release("a");
    expect(slots.inUse).toBe(0);
    expect(slots.acquire("b")).toBe(true);
    expect(slots.acquire("a")).toBe(true);
  });
});
