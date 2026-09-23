import { describe, expect, it } from "vitest";
import { TsCmdRequestSchema, type TsCmdRequest } from "@jinz/protocol";
import {
  prepareTsCommand,
  runTsCmd,
  type PreparedCommand,
  type TsCommandTarget,
} from "./commands.js";

function req(cmd: string, args: unknown): TsCmdRequest {
  return TsCmdRequestSchema.parse({ type: "ts.cmd", id: "r1", cmd, args });
}

const UID = "rto1GjL3NJJZuUcHrfrMEs2lszg=";
const text = (cmd: string, args: unknown, selfUid = UID) =>
  prepareTsCommand(req(cmd, args), { selfUid }).text;

describe("icon permission builders (M3)", () => {
  it("sets a group's icon as a live server takes it, int32 on the wire", () => {
    expect(
      text("servergroupaddperm", { sgid: "8", permsid: "i_icon_id", permvalue: 1472049519 }),
    ).toBe(
      "servergroupaddperm sgid=8 permsid=i_icon_id permvalue=1472049519 permnegated=0 permskip=0",
    );
    expect(
      text("channelgroupaddperm", { cgid: "8", permsid: "i_icon_id", permvalue: 3421780262 }),
    ).toBe(
      "channelgroupaddperm cgid=8 permsid=i_icon_id permvalue=-873187034 permnegated=0 permskip=0",
    );
  });

  it("sets a client's icon on the identity", () => {
    expect(
      text("clientaddperm", { cldbid: "12", permsid: "i_icon_id", permvalue: 4294967295 }),
    ).toBe("clientaddperm cldbid=12 permsid=i_icon_id permvalue=-1 permskip=0");
  });

  it("removes the icon permission", () => {
    expect(text("servergroupdelperm", { sgid: "8", permsid: "i_icon_id" })).toBe(
      "servergroupdelperm sgid=8 permsid=i_icon_id",
    );
    expect(text("channelgroupdelperm", { cgid: "8", permsid: "i_icon_id" })).toBe(
      "channelgroupdelperm cgid=8 permsid=i_icon_id",
    );
    expect(text("clientdelperm", { cldbid: "12", permsid: "i_icon_id" })).toBe(
      "clientdelperm cldbid=12 permsid=i_icon_id",
    );
  });
});

describe("icon and avatar file deletes (M3)", () => {
  it("deletes an icon file in channel 0 by its unsigned id", () => {
    expect(text("ftdeleteicon", { iconId: 3421780262 })).toBe(
      "ftdeletefile cid=0 cpw= name=\\/icon_3421780262",
    );
  });

  it("deletes the caller's own avatar by base64 UID, the form ftdeletefile takes", () => {
    expect(text("ftdeleteavatar", {})).toBe(`ftdeletefile cid=0 cpw= name=\\/avatar_${UID}`);
    expect(text("ftdeleteavatar", {}, "ab/c+d=")).toBe(
      "ftdeletefile cid=0 cpw= name=\\/avatar_ab\\/c+d=",
    );
  });

  it("refuses an avatar delete while the session's UID is unknown", () => {
    expect(() => text("ftdeleteavatar", {}, "")).toThrow(/tsErr/);
  });

  it("drops a deleted icon from the hub's cache, and only after the server agreed", async () => {
    const forgotten: string[] = [];
    let fail = false;
    const target: TsCommandTarget = {
      selfUid: UID,
      runCommand: async (_p: PreparedCommand) => {
        if (fail) throw new Error("boom");
        return [];
      },
      permissionCatalog: async () => ({ entries: [], byId: new Map(), groupEnds: [] }),
      forgetAsset: (path) => forgotten.push(path),
    };
    const done = await runTsCmd(target, req("ftdeleteicon", { iconId: 3421780262 }));
    expect(done.ok).toBe(true);
    expect(forgotten).toEqual(["/icon_3421780262"]);
    fail = true;
    await runTsCmd(target, req("ftdeleteicon", { iconId: 1472049519 }));
    expect(forgotten).toEqual(["/icon_3421780262"]);
  });
});
