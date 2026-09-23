import { describe, expect, it } from "vitest";
import type { TsChannel, TsGroup } from "@jinz/protocol";
import type { ChannelNode } from "./tree";
import { assignableGroups, channelPickerRows, dropDecision, stepPick } from "./moderation";

const group = (id: string, type: number, sortId: number): TsGroup => ({
  id,
  name: `g${id}`,
  type,
  iconId: 0,
  sortId,
  nameMode: 0,
});

function channel(id: string, name: string, extra: Partial<TsChannel> = {}): TsChannel {
  return {
    id,
    parentId: "0",
    order: "0",
    name,
    topic: "",
    codec: 4,
    codecQuality: 6,
    maxClients: -1,
    maxFamilyClients: -1,
    neededTalkPower: 0,
    iconId: 0,
    flags: {
      permanent: true,
      semiPermanent: false,
      default: false,
      password: false,
      maxClientsUnlimited: true,
      maxFamilyClientsUnlimited: true,
      maxFamilyClientsInherited: false,
    },
    subscribed: true,
    ...extra,
  };
}

const node = (ch: TsChannel, depth: number, children: ChannelNode[] = []): ChannelNode => ({
  channel: ch,
  depth,
  children,
  clients: [],
});

describe("assignableGroups", () => {
  it("keeps regular groups only, in the server's display order", () => {
    const groups = [group("3", 1, 20), group("1", 2, 0), group("9", 0, 5), group("2", 1, 10)];
    expect(assignableGroups(groups).map((g) => g.id)).toEqual(["2", "3"]);
  });

  it("breaks sort id ties by id", () => {
    expect(assignableGroups([group("10", 1, 0), group("9", 1, 0)]).map((g) => g.id)).toEqual([
      "9",
      "10",
    ]);
  });
});

describe("channelPickerRows", () => {
  const lobby = channel("1", "Lobby");
  const games = channel("2", "Games");
  const cs = channel("3", "Counter-Strike", { parentId: "2" });
  const spacer = channel("4", "[spacer0]---");
  const tree = [node(lobby, 0), node(spacer, 0), node(games, 0, [node(cs, 1)])];

  it("flattens the tree in order with depth, leaving spacers out", () => {
    expect(channelPickerRows(tree, "").map((r) => [r.channel.id, r.depth])).toEqual([
      ["1", 0],
      ["2", 0],
      ["3", 1],
    ]);
  });

  it("filters by name, ignoring case and surrounding space", () => {
    expect(channelPickerRows(tree, "  strike ").map((r) => r.channel.id)).toEqual(["3"]);
    expect(channelPickerRows(tree, "nothing")).toEqual([]);
  });
});

describe("stepPick", () => {
  const ids = ["1", "2", "3", "4"];

  it("starts at the first row going down and the last going up", () => {
    expect(stepPick(ids, null, 1)).toBe("1");
    expect(stepPick(ids, null, -1)).toBe("4");
    expect(stepPick(ids, "gone", 1)).toBe("1");
  });

  it("moves one row, stopping at either end", () => {
    expect(stepPick(ids, "2", 1)).toBe("3");
    expect(stepPick(ids, "2", -1)).toBe("1");
    expect(stepPick(ids, "4", 1)).toBe("4");
    expect(stepPick(ids, "1", -1)).toBe("1");
  });

  it("jumps over the row that cannot be picked", () => {
    expect(stepPick(ids, "2", 1, "3")).toBe("4");
    expect(stepPick(ids, null, 1, "1")).toBe("2");
    expect(stepPick(ids, "4", -1, "3")).toBe("2");
  });

  it("has nothing to pick in an empty list", () => {
    expect(stepPick([], null, 1)).toBeNull();
    expect(stepPick(["1"], null, 1, "1")).toBeNull();
  });
});

describe("dropDecision", () => {
  const target = channel("7", "Target");
  const locked = channel("8", "Locked", { flags: { ...target.flags, password: true } });
  const who = (isSelf: boolean) => ({ isSelf, channelId: "1" });

  it("does nothing when dropped on the channel the client is already in", () => {
    expect(dropDecision(who(true), channel("1", "Here"), true)).toBe("none");
    expect(dropDecision(who(false), channel("1", "Here"), true)).toBe("none");
  });

  it("joins for ourselves, whatever the move power says", () => {
    expect(dropDecision(who(true), target, false)).toBe("join");
    expect(dropDecision(who(true), locked, false)).toBe("join");
  });

  it("moves someone else only with the power to", () => {
    expect(dropDecision(who(false), target, true)).toBe("move");
    expect(dropDecision(who(false), target, false)).toBe("none");
  });

  it("asks (in the move dialog) where the target has a password", () => {
    expect(dropDecision(who(false), locked, true)).toBe("dialog");
  });
});
