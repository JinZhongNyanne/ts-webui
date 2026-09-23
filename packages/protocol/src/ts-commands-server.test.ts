import { describe, expect, it } from "vitest";
import { TS_CMD_NAMES, TsCmdRequestSchema } from "./ts-commands.js";
import {
  GROUP_NAME_MAX,
  LOG_LINES_MAX,
  SERVER_EDIT_FIELDS,
  SERVER_NAME_MAX,
  WELCOME_MESSAGE_MAX_BYTES,
} from "./ts-commands-server.js";

const ok = (name: string, args: unknown) =>
  TsCmdRequestSchema.safeParse({ type: "ts.cmd", id: "c1", cmd: name, args }).success;

const TOKEN = "EZygCxCxCBCZMKCDjI13LZFOxw86JYchNJv6KVAj";

describe("M4 server commands", () => {
  it("are all on the allow list", () => {
    for (const name of [
      "privilegekeyuse",
      "privilegekeylist",
      "privilegekeyadd",
      "privilegekeydelete",
      "servergroupadd",
      "servergroupdel",
      "servergrouprename",
      "servergroupcopy",
      "channelgroupadd",
      "channelgroupdel",
      "channelgrouprename",
      "channelgroupcopy",
      "serveredit",
      "servergetvariables",
      "logview",
      "serverrequestconnectioninfo",
    ]) {
      expect(TS_CMD_NAMES).toContain(name);
    }
  });

  it("privilege keys: a base64 token, nothing else", () => {
    expect(ok("privilegekeyuse", { token: TOKEN })).toBe(true);
    expect(ok("privilegekeyuse", { token: "a+b/c=" })).toBe(true);
    expect(ok("privilegekeyuse", { token: "" })).toBe(false);
    expect(ok("privilegekeyuse", { token: "abc token=x" })).toBe(false);
    expect(ok("privilegekeyuse", { token: "x".repeat(101) })).toBe(false);
    expect(ok("privilegekeyuse", { token: TOKEN, sgid: "6" })).toBe(false);
    expect(ok("privilegekeylist", {})).toBe(true);
    expect(ok("privilegekeydelete", { token: TOKEN })).toBe(true);
    expect(ok("privilegekeydelete", {})).toBe(false);
  });

  it("privilege keys are added for a server group, or a channel group in one channel", () => {
    expect(
      ok("privilegekeyadd", { tokentype: 0, tokenid1: "6", tokendescription: "for bob" }),
    ).toBe(true);
    expect(
      ok("privilegekeyadd", { tokentype: 1, tokenid1: "5", tokenid2: "12", tokendescription: "" }),
    ).toBe(true);
    // A channel group key needs its channel; a server group key has none.
    expect(ok("privilegekeyadd", { tokentype: 1, tokenid1: "5", tokendescription: "" })).toBe(
      false,
    );
    expect(
      ok("privilegekeyadd", { tokentype: 0, tokenid1: "6", tokenid2: "3", tokendescription: "" }),
    ).toBe(false);
    expect(ok("privilegekeyadd", { tokentype: 2, tokenid1: "6", tokendescription: "" })).toBe(
      false,
    );
    expect(
      ok("privilegekeyadd", { tokentype: 0, tokenid1: "6", tokendescription: "x".repeat(256) }),
    ).toBe(false);
  });

  it("groups: add, rename, copy and delete with names of at most 30 characters", () => {
    expect(ok("servergroupadd", { name: "Moderators" })).toBe(true);
    expect(ok("servergroupadd", { name: "x".repeat(GROUP_NAME_MAX) })).toBe(true);
    expect(ok("servergroupadd", { name: "x".repeat(GROUP_NAME_MAX + 1) })).toBe(false);
    expect(ok("servergroupadd", { name: "   " })).toBe(false);
    // Template and query groups are the instance admin's business, not ours.
    expect(ok("servergroupadd", { name: "Mods", type: 0 })).toBe(false);
    expect(ok("servergrouprename", { sgid: "9", name: "Mods" })).toBe(true);
    expect(ok("servergrouprename", { sgid: "9 sgid=6", name: "Mods" })).toBe(false);
    expect(ok("servergroupcopy", { ssgid: "9", name: "Mods 2" })).toBe(true);
    expect(ok("servergroupcopy", { ssgid: "9" })).toBe(false);
    expect(ok("servergroupdel", { sgid: "9", force: true })).toBe(true);
    expect(ok("servergroupdel", { sgid: "9" })).toBe(false);
    expect(ok("channelgroupadd", { name: "Helpers" })).toBe(true);
    expect(ok("channelgrouprename", { cgid: "9", name: "Helpers" })).toBe(true);
    expect(ok("channelgroupcopy", { scgid: "9", name: "Helpers 2" })).toBe(true);
    expect(ok("channelgroupdel", { cgid: "9", force: false })).toBe(true);
    expect(ok("channelgroupdel", { sgid: "9", force: false })).toBe(false);
  });

  it("group sort order and name display go through the widened group permission commands", () => {
    expect(ok("servergroupaddperm", { sgid: "9", permsid: "i_group_sort_id", permvalue: 20 })).toBe(
      true,
    );
    expect(
      ok("channelgroupaddperm", { cgid: "9", permsid: "i_group_show_name_in_tree", permvalue: 2 }),
    ).toBe(true);
    expect(
      ok("servergroupaddperm", { sgid: "9", permsid: "i_group_show_name_in_tree", permvalue: 3 }),
    ).toBe(false);
    expect(ok("servergroupaddperm", { sgid: "9", permsid: "i_group_sort_id", permvalue: -1 })).toBe(
      false,
    );
    expect(ok("servergroupdelperm", { sgid: "9", permsid: "i_group_sort_id" })).toBe(true);
    // Still not a general permission channel.
    expect(
      ok("servergroupaddperm", { sgid: "9", permsid: "i_group_modify_power", permvalue: 100 }),
    ).toBe(false);
    // Clients have no group sort order.
    expect(ok("clientaddperm", { cldbid: "9", permsid: "i_group_sort_id", permvalue: 1 })).toBe(
      false,
    );
  });

  it("serveredit takes only the enumerated fields, and at least one of them", () => {
    expect(ok("serveredit", { virtualserver_name: "My server" })).toBe(true);
    expect(
      ok("serveredit", {
        virtualserver_welcomemessage: "[b]hi[/b]",
        virtualserver_hostmessage: "News",
        virtualserver_hostmessage_mode: 2,
        virtualserver_hostbanner_url: "https://example.com",
        virtualserver_hostbanner_gfx_url: "https://example.com/b.png",
        virtualserver_hostbutton_url: "",
        virtualserver_hostbutton_gfx_url: "http://example.com/x.png",
        virtualserver_maxclients: 32,
        virtualserver_reserved_slots: 2,
        virtualserver_default_server_group: "8",
        virtualserver_default_channel_group: "8",
        virtualserver_needed_identity_security_level: 8,
        virtualserver_min_clients_in_channel_before_forced_silence: 100,
      }),
    ).toBe(true);
    expect(ok("serveredit", {})).toBe(false);
    // Unknown keys are refused, whatever they are.
    expect(ok("serveredit", { virtualserver_password: "x" })).toBe(false);
    expect(ok("serveredit", { virtualserver_name: "a", virtualserver_port: 9988 })).toBe(false);
    expect(
      ok("serveredit", { virtualserver_name: "a", virtualserver_antiflood_points_tick_reduce: 5 }),
    ).toBe(false);
    expect(SERVER_EDIT_FIELDS).toHaveLength(14);
  });

  it("serveredit keeps each field inside what the server accepts", () => {
    expect(ok("serveredit", { virtualserver_name: "x".repeat(SERVER_NAME_MAX) })).toBe(true);
    expect(ok("serveredit", { virtualserver_name: "x".repeat(SERVER_NAME_MAX + 1) })).toBe(false);
    expect(ok("serveredit", { virtualserver_name: " " })).toBe(false);
    expect(
      ok("serveredit", { virtualserver_welcomemessage: "x".repeat(WELCOME_MESSAGE_MAX_BYTES) }),
    ).toBe(true);
    // The welcome message is counted in bytes: 400 CJK characters are 1200.
    expect(ok("serveredit", { virtualserver_welcomemessage: "中".repeat(400) })).toBe(false);
    expect(ok("serveredit", { virtualserver_hostmessage: "x".repeat(201) })).toBe(false);
    expect(ok("serveredit", { virtualserver_hostmessage_mode: 4 })).toBe(false);
    expect(ok("serveredit", { virtualserver_hostbanner_gfx_url: "javascript:alert(1)" })).toBe(
      false,
    );
    expect(ok("serveredit", { virtualserver_hostbanner_url: "ftp://example.com" })).toBe(false);
    expect(ok("serveredit", { virtualserver_maxclients: 0 })).toBe(false);
    expect(ok("serveredit", { virtualserver_reserved_slots: -1 })).toBe(false);
    expect(ok("serveredit", { virtualserver_default_server_group: "8 x=1" })).toBe(false);
    expect(ok("serveredit", { virtualserver_needed_identity_security_level: 129 })).toBe(false);
    expect(ok("serveredit", { virtualserver_needed_identity_security_level: 1.5 })).toBe(false);
  });

  it("logview pages the virtual server's log, up to 100 lines at a time", () => {
    expect(ok("logview", { lines: 50, reverse: true })).toBe(true);
    expect(ok("logview", { lines: LOG_LINES_MAX, reverse: true, begin_pos: 3952 })).toBe(true);
    expect(ok("logview", { lines: 0, reverse: true })).toBe(false);
    expect(ok("logview", { lines: LOG_LINES_MAX + 1, reverse: true })).toBe(false);
    expect(ok("logview", { lines: 10, reverse: true, begin_pos: -1 })).toBe(false);
    expect(ok("logview", { lines: 10, reverse: true, begin_pos: 1.5 })).toBe(false);
    // The instance log is the host's, not the virtual server admin's.
    expect(ok("logview", { lines: 10, reverse: true, instance: true })).toBe(false);
  });

  it("connection info and server variables take no arguments", () => {
    expect(ok("serverrequestconnectioninfo", {})).toBe(true);
    expect(ok("serverrequestconnectioninfo", { sid: 1 })).toBe(false);
    expect(ok("servergetvariables", {})).toBe(true);
  });
});
