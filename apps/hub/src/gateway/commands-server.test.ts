/**
 * Wire forms of the M4 server administration commands, checked against what a
 * live TeamSpeak 3.13 server accepted from a client connection and which
 * notify it answered with.
 */
import { describe, expect, it } from "vitest";
import { ServerError } from "@honeybbq/teamspeak-client";
import { TsCmdRequestSchema, type TsCmdRequest } from "@jinz/protocol";
import { describeTsFailure, prepareTsCommand, runTsCmd, type TsCommandTarget } from "./commands.js";
import { parsePermissionList } from "./perms.js";

function prep(cmd: string, args: unknown) {
  const req = TsCmdRequestSchema.parse({ type: "ts.cmd", id: "r1", cmd, args }) as TsCmdRequest;
  return prepareTsCommand(req);
}

describe("privilege key commands", () => {
  it("redeems a key with its base64 escaped, answered by the error line alone", () => {
    expect(prep("privilegekeyuse", { token: "a+b/c=" })).toEqual({
      text: "privilegekeyuse token=a+b\\/c=",
      collect: null,
    });
  });

  it("lists through notifytokenlist and adds through notifytokenadd", () => {
    expect(prep("privilegekeylist", {})).toEqual({
      text: "privilegekeylist",
      collect: "notifytokenlist",
    });
    expect(
      prep("privilegekeyadd", { tokentype: 0, tokenid1: "6", tokendescription: "for bob" }),
    ).toEqual({
      text: "privilegekeyadd tokentype=0 tokenid1=6 tokenid2=0 tokendescription=for\\sbob",
      collect: "notifytokenadd",
    });
    expect(
      prep("privilegekeyadd", { tokentype: 1, tokenid1: "5", tokenid2: "12", tokendescription: "" })
        .text,
    ).toBe("privilegekeyadd tokentype=1 tokenid1=5 tokenid2=12 tokendescription=");
  });

  it("deletes one by token", () => {
    expect(prep("privilegekeydelete", { token: "ab/c=" }).text).toBe(
      "privilegekeydelete token=ab\\/c=",
    );
  });
});

describe("group commands", () => {
  it("adds, renames, copies and deletes server groups as regular groups", () => {
    expect(prep("servergroupadd", { name: "Mods here" })).toEqual({
      text: "servergroupadd name=Mods\\shere type=1",
      collect: null,
    });
    expect(prep("servergrouprename", { sgid: "9", name: "Mods" }).text).toBe(
      "servergrouprename sgid=9 name=Mods",
    );
    expect(prep("servergroupcopy", { ssgid: "9", name: "Mods 2" }).text).toBe(
      "servergroupcopy ssgid=9 tsgid=0 name=Mods\\s2 type=1",
    );
    expect(prep("servergroupdel", { sgid: "9", force: true }).text).toBe(
      "servergroupdel sgid=9 force=1",
    );
  });

  it("does the same for channel groups", () => {
    expect(prep("channelgroupadd", { name: "Helpers" }).text).toBe(
      "channelgroupadd name=Helpers type=1",
    );
    expect(prep("channelgrouprename", { cgid: "9", name: "H" }).text).toBe(
      "channelgrouprename cgid=9 name=H",
    );
    expect(prep("channelgroupcopy", { scgid: "9", name: "H 2" }).text).toBe(
      "channelgroupcopy scgid=9 tcgid=0 name=H\\s2 type=1",
    );
    expect(prep("channelgroupdel", { cgid: "9", force: false }).text).toBe(
      "channelgroupdel cgid=9 force=0",
    );
  });

  it("sets a group's sort id and name display through the group permission commands", () => {
    expect(
      prep("servergroupaddperm", { sgid: "9", permsid: "i_group_sort_id", permvalue: 20 }).text,
    ).toBe(
      "servergroupaddperm sgid=9 permsid=i_group_sort_id permvalue=20 permnegated=0 permskip=0",
    );
    expect(
      prep("channelgroupaddperm", {
        cgid: "9",
        permsid: "i_group_show_name_in_tree",
        permvalue: 2,
      }).text,
    ).toBe(
      "channelgroupaddperm cgid=9 permsid=i_group_show_name_in_tree permvalue=2 permnegated=0 permskip=0",
    );
  });
});

describe("virtual server commands", () => {
  it("edits only the fields given, escaped, with empty URLs clearing", () => {
    expect(
      prep("serveredit", {
        virtualserver_name: "My | server",
        virtualserver_hostbanner_gfx_url: "",
        virtualserver_maxclients: 32,
      }),
    ).toEqual({
      text: "serveredit virtualserver_name=My\\s\\p\\sserver virtualserver_hostbanner_gfx_url= virtualserver_maxclients=32",
      collect: null,
    });
  });

  it("reads the editable variables through notifyserverupdated", () => {
    expect(prep("servergetvariables", {})).toEqual({
      text: "servergetvariables",
      collect: "notifyserverupdated",
    });
  });

  it("pages the virtual server's log (never the instance's) through notifyserverlog", () => {
    expect(prep("logview", { lines: 50, reverse: true })).toEqual({
      text: "logview lines=50 reverse=1 instance=0",
      collect: "notifyserverlog",
    });
    expect(prep("logview", { lines: 50, reverse: true, begin_pos: 3952 }).text).toBe(
      "logview lines=50 reverse=1 instance=0 begin_pos=3952",
    );
  });

  it("asks for connection info through notifyserverconnectioninfo", () => {
    expect(prep("serverrequestconnectioninfo", {})).toEqual({
      text: "serverrequestconnectioninfo",
      collect: "notifyserverconnectioninfo",
    });
  });
});

describe("M4 failures", () => {
  it.each([
    ["3840", "server.err.invalidKey"],
    ["1282", "server.err.duplicate"],
    ["2560", "server.err.invalidGroup"],
    ["2567", "server.err.groupNotEmpty"],
    ["2817", "server.err.maxSlots"],
  ])("maps TeamSpeak error %s to its own message", (id, key) => {
    expect(describeTsFailure("x", new ServerError(id, "…")).message).toBe(key);
  });
});

describe("permissionlist for the permission overview", () => {
  it("ends with the catalog's category ends, after every permission row", async () => {
    const catalog = parsePermissionList([
      { group_id_end: "0" },
      { group_id_end: "1" },
      { permname: "b_serverinstance_help_view", permdesc: "Help" },
      { permname: "i_client_kick_from_server_power", permdesc: "Kick" },
    ]);
    const target: TsCommandTarget = {
      runCommand: async () => [],
      permissionCatalog: async () => catalog,
    };
    const req = TsCmdRequestSchema.parse({
      type: "ts.cmd",
      id: "p",
      cmd: "permissionlist",
      args: {},
    }) as TsCmdRequest;
    const res = await runTsCmd(target, req);
    expect(res.ok && res.rows).toEqual([
      { permid: "1", permname: "b_serverinstance_help_view", permdesc: "Help" },
      { permid: "2", permname: "i_client_kick_from_server_power", permdesc: "Kick" },
      { group_id_end: "0" },
      { group_id_end: "1" },
    ]);
  });
});
