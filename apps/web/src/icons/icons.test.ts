import { describe, expect, it } from "vitest";
import type { FtEntry } from "@jinz/protocol";
import { ICON_DEFAULT_LIMIT, iconByteLimit, iconPlan, sniffImageType } from "./icon-image";
import {
  iconCommand,
  iconIdsFromListing,
  iconIdsInUse,
  mergeIconIds,
  targetIconId,
  type IconTarget,
} from "./icon-set";
import { iconGates } from "./icon-gates";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("sniffImageType", () => {
  it("knows PNG, JPEG and GIF by their magic bytes", () => {
    expect(sniffImageType(Uint8Array.from([...PNG, 0]))).toBe("image/png");
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(new TextEncoder().encode("GIF89a..."))).toBe("image/gif");
  });

  it("refuses the rest, whatever the file is called", () => {
    expect(sniffImageType(new TextEncoder().encode("<svg>"))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("RIFF....WEBP"))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe("iconByteLimit", () => {
  it("follows i_max_icon_filesize, 0 meaning none", () => {
    expect(iconByteLimit(8192)).toBe(8192);
    expect(iconByteLimit(0)).toBeNull();
    expect(iconByteLimit(undefined)).toBe(ICON_DEFAULT_LIMIT);
    expect(iconByteLimit(-1)).toBe(ICON_DEFAULT_LIMIT);
  });
});

describe("iconPlan", () => {
  const png = { type: "image/png" as const, width: 16, height: 16, size: 600 };

  it("uploads a small icon byte for byte (so its CRC-32 is the native id)", () => {
    expect(iconPlan(png, 8192)).toEqual({ kind: "asIs" });
    expect(iconPlan({ ...png, width: 12, height: 16 }, 8192)).toEqual({ kind: "asIs" });
  });

  it("scales a bigger image down to 16 px, keeping its shape", () => {
    expect(iconPlan({ ...png, width: 64, height: 32 }, 8192)).toEqual({
      kind: "resize",
      width: 16,
      height: 8,
    });
    expect(iconPlan({ ...png, width: 10, height: 300 }, 8192)).toEqual({
      kind: "resize",
      width: 1,
      height: 16,
    });
  });

  it("re-encodes an icon of the right size that is too heavy", () => {
    expect(iconPlan({ ...png, size: 9000 }, 8192)).toEqual({
      kind: "resize",
      width: 16,
      height: 16,
    });
  });

  it("refuses what is not an image", () => {
    expect(iconPlan({ ...png, type: null }, 8192)).toEqual({ kind: "refuse", reason: "badType" });
    expect(iconPlan({ ...png, width: 0 }, 8192)).toEqual({ kind: "refuse", reason: "badType" });
  });
});

describe("icon ids", () => {
  const entry = (name: string, isDir = false): FtEntry => ({ name, size: 1, datetime: 0, isDir });

  it("reads uploaded icons from the /icons listing", () => {
    const ids = iconIdsFromListing([
      entry("icon_3421780262"),
      entry("icon_1472049519"),
      entry("notes.txt"),
      entry("icon_5", true),
      entry("icon_42"),
    ]);
    expect(ids).toEqual([1472049519, 3421780262]);
  });

  it("collects the icons in use (signed or not), leaving out built-in ones", () => {
    const ids = iconIdsInUse({
      server: { iconId: 0 },
      serverGroups: [{ iconId: 500 }, { iconId: -873187034 }],
      channelGroups: [{ iconId: 100 }],
      channels: [{ iconId: 1472049519 }],
      clients: [{ iconId: 0 }, { iconId: 1472049519 }],
    });
    expect(ids).toEqual([1472049519, 3421780262]);
  });

  it("merges lists without duplicates", () => {
    expect(mergeIconIds([5000, 7000], [7000, 6000])).toEqual([5000, 6000, 7000]);
  });
});

describe("iconCommand", () => {
  const sg: IconTarget = { kind: "serverGroup", id: "8", name: "Guest" };
  const cg: IconTarget = { kind: "channelGroup", id: "4", name: "Guest" };
  const ch: IconTarget = { kind: "channel", id: "12", name: "Lobby" };
  const cl: IconTarget = { kind: "client", dbId: "30", name: "alice" };

  it("sets i_icon_id on the target", () => {
    expect(iconCommand(sg, 3421780262)).toEqual({
      cmd: "servergroupaddperm",
      args: { sgid: "8", permsid: "i_icon_id", permvalue: 3421780262 },
    });
    expect(iconCommand(cg, 5000).cmd).toBe("channelgroupaddperm");
    expect(iconCommand(ch, 5000)).toEqual({
      cmd: "channeladdperm",
      args: { cid: "12", permsid: "i_icon_id", permvalue: 5000 },
    });
    expect(iconCommand(cl, 5000)).toEqual({
      cmd: "clientaddperm",
      args: { cldbid: "30", permsid: "i_icon_id", permvalue: 5000 },
    });
  });

  it("removes it with the matching delperm", () => {
    expect(iconCommand(sg, null)).toEqual({
      cmd: "servergroupdelperm",
      args: { sgid: "8", permsid: "i_icon_id" },
    });
    expect(iconCommand(cg, null).cmd).toBe("channelgroupdelperm");
    expect(iconCommand(ch, null).cmd).toBe("channeldelperm");
    expect(iconCommand(cl, null)).toEqual({
      cmd: "clientdelperm",
      args: { cldbid: "30", permsid: "i_icon_id" },
    });
  });
});

describe("targetIconId", () => {
  const state = {
    serverGroups: new Map([["8", { iconId: -873187034 }]]),
    channelGroups: new Map([["4", { iconId: 0 }]]),
    channels: new Map([["12", { iconId: 5000 }]]),
    clients: [{ databaseId: "30", iconId: 7000 }],
  };

  it("reads the target's icon, unsigned, or null when out of view", () => {
    expect(targetIconId({ kind: "serverGroup", id: "8", name: "" }, state)).toBe(3421780262);
    expect(targetIconId({ kind: "channelGroup", id: "4", name: "" }, state)).toBe(0);
    expect(targetIconId({ kind: "channel", id: "12", name: "" }, state)).toBe(5000);
    expect(targetIconId({ kind: "client", dbId: "30", name: "" }, state)).toBe(7000);
    expect(targetIconId({ kind: "client", dbId: "31", name: "" }, state)).toBeNull();
    expect(targetIconId({ kind: "channel", id: "99", name: "" }, state)).toBeNull();
  });
});

describe("iconGates", () => {
  const src = (loaded: boolean, values: Record<string, number>) => ({
    loaded,
    has: (n: string) => (values[n] ?? 0) >= 1,
    mayUse: (n: string) => !loaded || !(n in values) || values[n]! > 0,
  });

  it("offers the manager on b_icon_manage, and everything before perms load", () => {
    expect(iconGates(src(false, {})).manage()).toBe(true);
    expect(iconGates(src(true, {})).manage()).toBe(false);
    expect(iconGates(src(true, { b_icon_manage: 1 })).manage()).toBe(true);
  });

  it("offers setting an icon unless a needed power is known to be 0", () => {
    const g = iconGates(src(true, { i_permission_modify_power: 75 }));
    expect(g.assign("serverGroup")).toBe(true);
    expect(g.assign("client")).toBe(true);
    const none = iconGates(src(true, { i_permission_modify_power: 0 }));
    expect(none.assign("channel")).toBe(false);
    const noGroup = iconGates(src(true, { i_group_modify_power: 0 }));
    expect(noGroup.assign("serverGroup")).toBe(false);
    expect(noGroup.assign("channelGroup")).toBe(false);
    expect(noGroup.assign("client")).toBe(true);
    const noClient = iconGates(src(true, { i_client_permission_modify_power: 0 }));
    expect(noClient.assign("client")).toBe(false);
    const noChannel = iconGates(src(true, { i_channel_permission_modify_power: 0 }));
    expect(noChannel.assign("channel")).toBe(false);
  });
});
