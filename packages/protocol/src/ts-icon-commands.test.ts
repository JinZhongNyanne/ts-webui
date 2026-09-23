import { describe, expect, it } from "vitest";
import { TsCmdRequestSchema, TS_CMD_NAMES } from "./ts-commands.js";

const cmd = (name: string, args: unknown) => ({ type: "ts.cmd", id: "c1", cmd: name, args });
const ok = (name: string, args: unknown) => TsCmdRequestSchema.safeParse(cmd(name, args)).success;

describe("icon commands (M3)", () => {
  it("are on the allow list", () => {
    for (const name of [
      "servergroupaddperm",
      "servergroupdelperm",
      "channelgroupaddperm",
      "channelgroupdelperm",
      "clientaddperm",
      "clientdelperm",
      "ftdeleteicon",
      "ftdeleteavatar",
    ]) {
      expect(TS_CMD_NAMES).toContain(name);
    }
    // The file browser's generic delete exists, but never for channel 0.
  });

  it("set i_icon_id and nothing else", () => {
    const value = { permsid: "i_icon_id", permvalue: 3421780262 };
    expect(ok("servergroupaddperm", { sgid: "8", ...value })).toBe(true);
    expect(ok("channelgroupaddperm", { cgid: "8", ...value })).toBe(true);
    expect(ok("clientaddperm", { cldbid: "12", ...value })).toBe(true);
    expect(ok("servergroupaddperm", { sgid: "8", permsid: "b_client_kick", permvalue: 1 })).toBe(
      false,
    );
    expect(
      ok("clientaddperm", { cldbid: "12", permsid: "i_client_talk_power", permvalue: 1 }),
    ).toBe(false);
    expect(ok("servergroupaddperm", { sgid: "8", ...value, permskip: true })).toBe(false);
  });

  it("take signed or unsigned ids within 32 bits", () => {
    expect(ok("servergroupaddperm", { sgid: "8", permsid: "i_icon_id", permvalue: -5 })).toBe(true);
    expect(ok("servergroupaddperm", { sgid: "8", permsid: "i_icon_id", permvalue: 2 ** 32 })).toBe(
      false,
    );
    expect(ok("servergroupaddperm", { sgid: "8", permsid: "i_icon_id", permvalue: 1.5 })).toBe(
      false,
    );
  });

  it("remove the icon permission by target", () => {
    expect(ok("servergroupdelperm", { sgid: "8", permsid: "i_icon_id" })).toBe(true);
    expect(ok("channelgroupdelperm", { cgid: "8", permsid: "i_icon_id" })).toBe(true);
    expect(ok("clientdelperm", { cldbid: "12", permsid: "i_icon_id" })).toBe(true);
    expect(ok("clientdelperm", { cldbid: "x", permsid: "i_icon_id" })).toBe(false);
    expect(ok("clientdelperm", { cldbid: "12", permsid: "b_x" })).toBe(false);
  });

  it("delete an icon file by id, never a built-in one", () => {
    expect(ok("ftdeleteicon", { iconId: 3421780262 })).toBe(true);
    expect(ok("ftdeleteicon", { iconId: 500 })).toBe(false);
    expect(ok("ftdeleteicon", { iconId: -5 })).toBe(false);
    expect(ok("ftdeleteicon", { iconId: 3421780262, path: "/x" })).toBe(false);
  });

  it("delete only one's own avatar (the hub names it)", () => {
    expect(ok("ftdeleteavatar", {})).toBe(true);
    expect(ok("ftdeleteavatar", { uid: "abc=" })).toBe(false);
  });

  it("clientupdate sets or clears the avatar flag as an md5", () => {
    expect(ok("clientupdate", { client_flag_avatar: "0123456789abcdef0123456789abcdef" })).toBe(
      true,
    );
    expect(ok("clientupdate", { client_flag_avatar: "" })).toBe(true);
    expect(ok("clientupdate", { client_flag_avatar: "nope" })).toBe(false);
  });
});
