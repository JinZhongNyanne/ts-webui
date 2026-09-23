import { describe, expect, it } from "vitest";
import {
  dropPositionAt,
  isInSubtree,
  planChannelDrop,
  planChannelPlace,
  type ChannelPlace,
} from "./channel-drop";

const ch = (id: string, parentId: string, order: string): ChannelPlace => ({ id, parentId, order });

/**
 *   A(10)            root chain: 10 → 11 → 12
 *     A1(20)         under A: 20 → 21
 *     A2(21)
 *       A2x(30)
 *   B(11)
 *   C(12)
 */
const TREE = new Map(
  [
    ch("10", "0", "0"),
    ch("11", "0", "10"),
    ch("12", "0", "11"),
    ch("20", "10", "0"),
    ch("21", "10", "20"),
    ch("30", "21", "0"),
  ].map((c) => [c.id, c]),
);

describe("dropPositionAt", () => {
  it("splits a row into before / inside / after", () => {
    expect(dropPositionAt(0, 24)).toBe("before");
    expect(dropPositionAt(5, 24)).toBe("before");
    expect(dropPositionAt(12, 24)).toBe("inside");
    expect(dropPositionAt(19, 24)).toBe("after");
    expect(dropPositionAt(24, 24)).toBe("after");
  });

  it("has no 'after' on an expanded parent: its subchannels are drawn below it", () => {
    // "after" means after the whole subtree, nowhere near the row's bottom edge.
    expect(dropPositionAt(5, 24, false)).toBe("before");
    expect(dropPositionAt(19, 24, false)).toBe("inside");
    expect(dropPositionAt(24, 24, false)).toBe("inside");
  });
});

describe("planChannelDrop", () => {
  it("onto a channel: becomes its last subchannel", () => {
    expect(planChannelDrop(TREE, "12", "10", "inside")).toEqual({
      kind: "move",
      cid: "12",
      cpid: "10",
      order: "21",
    });
    // An empty target: first (and only).
    expect(planChannelDrop(TREE, "12", "11", "inside")).toEqual({
      kind: "move",
      cid: "12",
      cpid: "11",
      order: "0",
    });
  });

  it("onto its own parent: moves to the end of the siblings (a reorder)", () => {
    expect(planChannelDrop(TREE, "20", "10", "inside")).toEqual({
      kind: "reorder",
      cid: "20",
      order: "21",
    });
    expect(planChannelDrop(TREE, "21", "10", "inside")).toBeNull();
  });

  it("between rows of the same parent: a reorder with the new predecessor", () => {
    // C before B → after A.
    expect(planChannelDrop(TREE, "12", "11", "before")).toEqual({
      kind: "reorder",
      cid: "12",
      order: "10",
    });
    // A after C → last.
    expect(planChannelDrop(TREE, "10", "12", "after")).toEqual({
      kind: "reorder",
      cid: "10",
      order: "12",
    });
    // C before A → first.
    expect(planChannelDrop(TREE, "12", "10", "before")).toEqual({
      kind: "reorder",
      cid: "12",
      order: "0",
    });
  });

  it("between rows of another parent: a move with order", () => {
    expect(planChannelDrop(TREE, "30", "11", "after")).toEqual({
      kind: "move",
      cid: "30",
      cpid: "0",
      order: "11",
    });
    expect(planChannelDrop(TREE, "12", "20", "before")).toEqual({
      kind: "move",
      cid: "12",
      cpid: "10",
      order: "0",
    });
  });

  it("drops that leave everything where it is do nothing", () => {
    expect(planChannelDrop(TREE, "11", "11", "inside")).toBeNull();
    expect(planChannelDrop(TREE, "11", "10", "after")).toBeNull();
    expect(planChannelDrop(TREE, "10", "11", "before")).toBeNull();
    expect(planChannelDrop(TREE, "11", "11", "before")).toBeNull();
  });

  it("never moves a channel into itself or its own subchannels", () => {
    expect(planChannelDrop(TREE, "10", "20", "inside")).toBeNull();
    expect(planChannelDrop(TREE, "10", "30", "before")).toBeNull();
    expect(planChannelDrop(TREE, "21", "30", "inside")).toBeNull();
  });

  it("onto the server row: last top-level channel", () => {
    expect(planChannelDrop(TREE, "30", null, "inside")).toEqual({
      kind: "move",
      cid: "30",
      cpid: "0",
      order: "12",
    });
    expect(planChannelDrop(TREE, "12", null, "inside")).toBeNull();
  });

  it("ignores unknown channels", () => {
    expect(planChannelDrop(TREE, "99", "10", "inside")).toBeNull();
    expect(planChannelDrop(TREE, "10", "99", "inside")).toBeNull();
  });
});

describe("isInSubtree", () => {
  it("is the channel itself or anything below it", () => {
    expect(isInSubtree(TREE, "10", "10")).toBe(true);
    expect(isInSubtree(TREE, "30", "10")).toBe(true);
    expect(isInSubtree(TREE, "11", "10")).toBe(false);
    expect(isInSubtree(TREE, "10", "21")).toBe(false);
  });
});

describe("planChannelPlace (the move dialog: parent + predecessor)", () => {
  it("under another parent: a move, first or after a sibling", () => {
    expect(planChannelPlace(TREE, "12", "10", "0")).toEqual({
      kind: "move",
      cid: "12",
      cpid: "10",
      order: "0",
    });
    expect(planChannelPlace(TREE, "12", "10", "21")).toEqual({
      kind: "move",
      cid: "12",
      cpid: "10",
      order: "21",
    });
    expect(planChannelPlace(TREE, "30", "0", "12")).toEqual({
      kind: "move",
      cid: "30",
      cpid: "0",
      order: "12",
    });
  });

  it("under the same parent: a reorder, or nothing where it already is", () => {
    expect(planChannelPlace(TREE, "12", "0", "0")).toEqual({
      kind: "reorder",
      cid: "12",
      order: "0",
    });
    expect(planChannelPlace(TREE, "12", "0", "11")).toBeNull();
    expect(planChannelPlace(TREE, "10", "0", "0")).toBeNull();
  });

  it("refuses its own subtree, itself as predecessor, and unknown channels", () => {
    expect(planChannelPlace(TREE, "10", "21", "0")).toBeNull();
    expect(planChannelPlace(TREE, "10", "10", "0")).toBeNull();
    expect(planChannelPlace(TREE, "11", "0", "11")).toBeNull();
    expect(planChannelPlace(TREE, "99", "0", "0")).toBeNull();
    expect(planChannelPlace(TREE, "12", "99", "0")).toBeNull();
  });
});
