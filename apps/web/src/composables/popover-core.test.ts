import { describe, expect, it, vi } from "vitest";
import { containsAny, createPopoverRegistry, keyDismisses, pointerDismisses } from "./popover-core";

describe("createPopoverRegistry", () => {
  it("closes the previously active popover when another one activates", () => {
    const registry = createPopoverRegistry();
    const closeA = vi.fn();
    const closeB = vi.fn();

    registry.activate(closeA);
    expect(registry.isActive(closeA)).toBe(true);

    registry.activate(closeB);
    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).not.toHaveBeenCalled();
    expect(registry.isActive(closeA)).toBe(false);
    expect(registry.isActive(closeB)).toBe(true);
    expect(registry.size()).toBe(1);
  });

  it("does not close a popover that re-activates itself", () => {
    const registry = createPopoverRegistry();
    const close = vi.fn();
    registry.activate(close);
    registry.activate(close);
    expect(close).not.toHaveBeenCalled();
    expect(registry.size()).toBe(1);
  });

  it("removes a popover from the registry on release", () => {
    const registry = createPopoverRegistry();
    const close = vi.fn();
    registry.activate(close);
    registry.release(close);
    expect(registry.isActive(close)).toBe(false);
    expect(registry.size()).toBe(0);
    // A later activation must not call a released closer.
    registry.activate(vi.fn());
    expect(close).not.toHaveBeenCalled();
  });

  it("tolerates releasing a closer that was never registered", () => {
    const registry = createPopoverRegistry();
    expect(() => registry.release(vi.fn())).not.toThrow();
    expect(registry.size()).toBe(0);
  });

  it("survives a closer that releases itself while being closed", () => {
    const registry = createPopoverRegistry();
    const closeA = vi.fn(() => registry.release(closeA));
    const closeB = vi.fn();
    registry.activate(closeA);
    registry.activate(closeB);
    expect(closeA).toHaveBeenCalledTimes(1);
    expect(registry.size()).toBe(1);
    expect(registry.isActive(closeB)).toBe(true);
  });
});

describe("pointerDismisses", () => {
  const inside = { id: "inside" };
  const outside = { id: "outside" };
  const contains = (target: unknown): boolean => target === inside;

  it("closes on a pointerdown outside the popover", () => {
    expect(pointerDismisses(outside, contains)).toBe(true);
  });

  it("does not close on a pointerdown inside the popover", () => {
    expect(pointerDismisses(inside, contains)).toBe(false);
  });

  it("treats a missing target as outside", () => {
    expect(pointerDismisses(null, contains)).toBe(true);
  });
});

describe("keyDismisses", () => {
  it("closes on Escape", () => {
    expect(keyDismisses("Escape")).toBe(true);
  });

  it("ignores other keys", () => {
    expect(keyDismisses("Enter")).toBe(false);
    expect(keyDismisses("Esc")).toBe(false);
    expect(keyDismisses("")).toBe(false);
  });
});

describe("containsAny", () => {
  const trigger = { id: "trigger" };
  const teleported = { id: "teleported" };
  const elsewhere = { id: "elsewhere" };
  const contains = containsAny([(t) => t === trigger, (t) => t === teleported]);

  it("counts a target inside any of the boxes as inside", () => {
    expect(contains(trigger)).toBe(true);
    expect(contains(teleported)).toBe(true);
  });

  it("counts everything else as outside", () => {
    expect(contains(elsewhere)).toBe(false);
    expect(contains(null)).toBe(false);
  });

  it("keeps a press in the teleported panel from dismissing the popover", () => {
    expect(pointerDismisses(teleported, contains)).toBe(false);
    expect(pointerDismisses(elsewhere, contains)).toBe(true);
  });

  it("treats a popover with no boxes to check as never containing anything", () => {
    expect(containsAny([])(trigger)).toBe(false);
  });
});
