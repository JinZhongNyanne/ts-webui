import { describe, expect, it } from "vitest";
import type { TsGroup } from "@jinz/protocol";
import { foldGroupRow } from "./group-list.js";

const group = (id: string, name = `g${id}`): TsGroup => ({
  id,
  name,
  type: 1,
  iconId: 0,
  sortId: 0,
  nameMode: 0,
});

/** Feeds the rows of one notify{server,channel}grouplist command. */
function feed(groups: Map<string, TsGroup>, rows: TsGroup[]): void {
  rows.forEach((g, i) => foldGroupRow(groups, g, i === 0));
}

describe("foldGroupRow", () => {
  it("builds the list from the welcome sequence", () => {
    const groups = new Map<string, TsGroup>();
    feed(groups, [group("6"), group("7"), group("8")]);
    expect([...groups.keys()]).toEqual(["6", "7", "8"]);
  });

  it("drops a group missing from the next full list (deleted on the server)", () => {
    const groups = new Map<string, TsGroup>();
    feed(groups, [group("6"), group("7"), group("9")]);
    feed(groups, [group("6"), group("7")]);
    expect([...groups.keys()]).toEqual(["6", "7"]);
  });

  it("picks up added and renamed groups", () => {
    const groups = new Map<string, TsGroup>();
    feed(groups, [group("6"), group("7", "Old")]);
    feed(groups, [group("6"), group("7", "New"), group("10")]);
    expect([...groups.values()].map((g) => g.name)).toEqual(["g6", "New", "g10"]);
  });

  it("keeps adding rows within one list", () => {
    const groups = new Map<string, TsGroup>([["6", group("6")]]);
    foldGroupRow(groups, group("7"), false);
    expect([...groups.keys()]).toEqual(["6", "7"]);
  });
});
