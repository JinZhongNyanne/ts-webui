import { describe, expect, it } from "vitest";
import { relinkOnEnter, relinkOnLeave, relinkOnMove, type ChannelPlace } from "./channel-order.js";

const place = (id: string, parentId: string, order: string): ChannelPlace => ({
  id,
  parentId,
  order,
});

/** Root 1 holds A(10) → B(11) → C(12); channel 20 lives under B. */
const TREE = [
  place("10", "1", "0"),
  place("11", "1", "10"),
  place("12", "1", "11"),
  place("20", "11", "0"),
];

/** Applies fixes and returns the sibling chain under `parent`, first to last. */
function chain(channels: ChannelPlace[], parent: string): string[] {
  const out: string[] = [];
  let cursor = "0";
  for (;;) {
    const next = channels.find((c) => c.parentId === parent && c.order === cursor);
    if (!next || out.includes(next.id)) return out;
    out.push(next.id);
    cursor = next.id;
  }
}

function apply(channels: ChannelPlace[], fixes: { id: string; order: string }[]): ChannelPlace[] {
  return channels.map((c) => {
    const fix = fixes.find((f) => f.id === c.id);
    return fix ? { ...c, order: fix.order } : c;
  });
}

describe("channel order relinking", () => {
  it("a created channel pushes the one that followed its predecessor down", () => {
    // The server creates 13 after A and silently makes B follow 13.
    const created = place("13", "1", "10");
    const fixes = relinkOnEnter(TREE, created);
    expect(fixes).toEqual([{ id: "11", order: "13" }]);
    expect(chain(apply([...TREE, created], fixes), "1")).toEqual(["10", "13", "11", "12"]);
  });

  it("appending last changes nothing", () => {
    expect(relinkOnEnter(TREE, place("13", "1", "12"))).toEqual([]);
  });

  it("a deleted channel's successor takes its place", () => {
    const fixes = relinkOnLeave(TREE, place("11", "1", "10"));
    expect(fixes).toEqual([{ id: "12", order: "10" }]);
    const rest = apply(
      TREE.filter((c) => c.id !== "11"),
      fixes,
    );
    expect(chain(rest, "1")).toEqual(["10", "12"]);
  });

  it("reorders within the same parent", () => {
    // Move A after B.
    const after = place("10", "1", "11");
    const fixes = relinkOnMove(TREE, TREE[0]!, after);
    const next = apply(
      TREE.map((c) => (c.id === "10" ? after : c)),
      fixes,
    );
    expect(chain(next, "1")).toEqual(["11", "10", "12"]);
  });

  it("moves to the top of the same parent", () => {
    const after = place("12", "1", "0");
    const next = apply(
      TREE.map((c) => (c.id === "12" ? after : c)),
      relinkOnMove(TREE, TREE[2]!, after),
    );
    expect(chain(next, "1")).toEqual(["12", "10", "11"]);
  });

  it("moves to another parent, closing the gap it left", () => {
    const after = place("10", "11", "0");
    const next = apply(
      TREE.map((c) => (c.id === "10" ? after : c)),
      relinkOnMove(TREE, TREE[0]!, after),
    );
    expect(chain(next, "1")).toEqual(["11", "12"]);
    expect(chain(next, "11")).toEqual(["10", "20"]);
  });

  it("an unchanged place needs no fixes", () => {
    expect(relinkOnMove(TREE, TREE[1]!, { ...TREE[1]! })).toEqual([]);
  });
});
