import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cardActions,
  cardMenuItems,
  registerCardAction,
  resetCardActions,
  type CardMenuTarget,
} from "./card-menu";

const target = (over: Partial<CardMenuTarget> = {}): CardMenuTarget => ({
  card: {} as HTMLElement,
  file: { cid: "5", path: "/cat.png", size: 100 },
  name: "cat.png",
  url: "blob:x",
  ...over,
});

beforeEach(() => resetCardActions());

describe("the card action registry", () => {
  it("keeps what was registered, in order", () => {
    const run = vi.fn();
    registerCardAction({ id: "a", label: () => "A", run });
    registerCardAction({ id: "b", label: () => "B", run });
    expect(cardActions().map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("registers an id once, so a reloaded module does not double the menu", () => {
    registerCardAction({ id: "a", label: () => "A", run: vi.fn() });
    registerCardAction({ id: "a", label: () => "again", run: vi.fn() });
    expect(cardActions()).toHaveLength(1);
    expect(cardActions()[0]!.label(target())).toBe("A");
  });

  it("hands out a copy, so a caller cannot reorder the registry", () => {
    registerCardAction({ id: "a", label: () => "A", run: vi.fn() });
    const list = cardActions() as unknown as unknown[];
    expect(() => list.push(1)).toThrow();
  });
});

describe("cardMenuItems", () => {
  it("turns every action into an item that runs it on the target", () => {
    const run = vi.fn();
    registerCardAction({ id: "a", label: (t) => `Save ${t.name}`, icon: "💾", run });
    const t = target();
    const items = cardMenuItems(t);
    expect(items).toMatchObject([{ label: "Save cat.png", icon: "💾", testId: "a" }]);
    items[0]!.action!();
    expect(run).toHaveBeenCalledWith(t);
  });

  it("leaves out what does not apply to this target", () => {
    registerCardAction({ id: "a", label: () => "A", run: vi.fn() });
    registerCardAction({
      id: "b",
      label: () => "B",
      enabled: (t) => t.url !== undefined,
      run: vi.fn(),
    });
    expect(cardMenuItems(target()).map((i) => i.label)).toEqual(["A", "B"]);
    expect(cardMenuItems(target({ url: undefined })).map((i) => i.label)).toEqual(["A"]);
  });

  it("is empty when nothing is registered", () => {
    expect(cardMenuItems(target())).toEqual([]);
  });
});
