import { describe, expect, it } from "vitest";
import { ClientMessageSchema } from "./messages.js";
import { TS_CMD_NAMES, TsCmdRequestSchema } from "./ts-commands.js";

const cmd = (name: string, args: unknown, id = "c1") => ({ type: "ts.cmd", id, cmd: name, args });

describe("ts.cmd schema", () => {
  it("is part of the browser message union", () => {
    const r = ClientMessageSchema.safeParse(cmd("channelsubscribeall", {}));
    expect(r.success).toBe(true);
    if (r.success && r.data.type === "ts.cmd") expect(r.data.cmd).toBe("channelsubscribeall");
  });

  it("lists every allowed command", () => {
    expect(TS_CMD_NAMES).toContain("clientupdate");
    expect(TS_CMD_NAMES).toContain("permoverview");
    expect(new Set(TS_CMD_NAMES).size).toBe(TS_CMD_NAMES.length);
  });

  it("refuses commands outside the allow list", () => {
    expect(ClientMessageSchema.safeParse(cmd("serverstop", {})).success).toBe(false);
    expect(ClientMessageSchema.safeParse(cmd("clientkick", { clid: 3 })).success).toBe(false);
  });

  it("refuses serveredit with unknown keys (only the enumerated fields go out)", () => {
    const edit = (args: unknown) => ClientMessageSchema.safeParse(cmd("serveredit", args)).success;
    expect(edit({ virtualserver_password: "x" })).toBe(false);
    expect(edit({ virtualserver_name: "a", virtualserver_port: 9988 })).toBe(false);
  });

  it("refuses unknown argument fields (no smuggling extra TS parameters)", () => {
    const r = TsCmdRequestSchema.safeParse(
      cmd("clientupdate", { client_away: true, client_servergroups: "6" }),
    );
    expect(r.success).toBe(false);
  });

  it("refuses an update that changes nothing", () => {
    expect(TsCmdRequestSchema.safeParse(cmd("clientupdate", {})).success).toBe(false);
    expect(TsCmdRequestSchema.safeParse(cmd("clientedit", { clid: 4 })).success).toBe(false);
  });

  it("validates field types and limits", () => {
    const ok = (name: string, args: unknown) =>
      TsCmdRequestSchema.safeParse(cmd(name, args)).success;
    expect(ok("clientupdate", { client_away: true, client_away_message: "brb" })).toBe(true);
    expect(ok("clientupdate", { client_away: "1" })).toBe(false);
    expect(ok("clientupdate", { client_away_message: "x".repeat(81) })).toBe(false);
    expect(ok("clientupdate", { client_nickname: "ab" })).toBe(false);
    expect(ok("clientedit", { clid: 4, client_description: "hi" })).toBe(true);
    expect(ok("clientedit", { clid: 0, client_is_talker: true })).toBe(false);
    expect(ok("channelsubscribe", { cids: ["1", "2"] })).toBe(true);
    expect(ok("channelsubscribe", { cids: [] })).toBe(false);
    expect(ok("channelsubscribe", { cids: ["1 cid=2"] })).toBe(false);
    expect(ok("permoverview", { cid: "1", cldbid: "2" })).toBe(true);
    expect(ok("permoverview", { cid: "1", cldbid: "2", permids: [1, 2] })).toBe(true);
    expect(ok("permoverview", { cid: "1", cldbid: "x" })).toBe(false);
    expect(ok("permissionlist", { anything: 1 })).toBe(false);
  });

  it("validates the ban commands", () => {
    const ok = (name: string, args: unknown) =>
      TsCmdRequestSchema.safeParse(cmd(name, args)).success;
    expect(ok("banclient", { clid: 4, time: 600, banreason: "spam" })).toBe(true);
    // 0 is TeamSpeak's "permanent".
    expect(ok("banclient", { clid: 4, time: 0, banreason: "" })).toBe(true);
    expect(ok("banclient", { clid: 4, time: -1, banreason: "" })).toBe(false);
    expect(ok("banclient", { clid: 4, time: 1.5, banreason: "" })).toBe(false);
    // The server cuts reasons at 80 characters; refuse rather than lose text.
    expect(ok("banclient", { clid: 4, time: 60, banreason: "x".repeat(81) })).toBe(false);
    expect(ok("banadd", { uid: "abc=", time: 60, banreason: "" })).toBe(true);
    expect(ok("banadd", { ip: "10.0.0.1", name: "^bob$", time: 60, banreason: "" })).toBe(true);
    expect(ok("banadd", { time: 60, banreason: "" })).toBe(false);
    expect(ok("banadd", { uid: "  ", time: 60, banreason: "" })).toBe(false);
    expect(ok("banadd", { uid: "a", cldbid: "3", time: 60, banreason: "" })).toBe(false);
    expect(ok("banlist", {})).toBe(true);
    expect(ok("bandel", { banid: "12" })).toBe(true);
    expect(ok("bandel", { banid: "12 banid=13" })).toBe(false);
    expect(ok("bandelall", {})).toBe(true);
  });

  it("keeps request ids short and plain", () => {
    expect(TsCmdRequestSchema.safeParse(cmd("permissionlist", {}, "")).success).toBe(false);
    expect(TsCmdRequestSchema.safeParse(cmd("permissionlist", {}, "x".repeat(33))).success).toBe(
      false,
    );
    expect(TsCmdRequestSchema.safeParse(cmd("permissionlist", {}, "a b")).success).toBe(false);
  });
});

describe("M2 moderation commands", () => {
  const ok = (name: string, args: unknown) => TsCmdRequestSchema.safeParse(cmd(name, args)).success;

  it("moves a client, with an optional channel password", () => {
    expect(ok("clientmove", { clid: 4, cid: "7" })).toBe(true);
    expect(ok("clientmove", { clid: 4, cid: "7", cpw: "secret" })).toBe(true);
    expect(ok("clientmove", { clid: 4 })).toBe(false);
    expect(ok("clientmove", { clid: 4, cid: "7 cid=8" })).toBe(false);
    expect(ok("clientmove", { clid: 4, cid: "7", cpw: "x".repeat(129) })).toBe(false);
  });

  it("kicks from the channel (4) or the server (5) only, with a reason of up to 80", () => {
    expect(ok("clientkick", { clid: 4, reasonid: 4 })).toBe(true);
    expect(ok("clientkick", { clid: 4, reasonid: 5, reasonmsg: "bye" })).toBe(true);
    expect(ok("clientkick", { clid: 4, reasonid: 5, reasonmsg: "x".repeat(80) })).toBe(true);
    expect(ok("clientkick", { clid: 4, reasonid: 5, reasonmsg: "x".repeat(81) })).toBe(false);
    expect(ok("clientkick", { clid: 4, reasonid: 3 })).toBe(false);
    expect(ok("clientkick", { clid: 4 })).toBe(false);
  });

  it("adds and removes server group members by database id", () => {
    for (const name of ["servergroupaddclient", "servergroupdelclient"]) {
      expect(ok(name, { sgid: "7", cldbid: "12" })).toBe(true);
      expect(ok(name, { sgid: "7" })).toBe(false);
      expect(ok(name, { sgid: "7", cldbid: "12|sgid=6" })).toBe(false);
    }
  });

  it("sets a channel group for a database id in one channel", () => {
    expect(ok("setclientchannelgroup", { cgid: "5", cid: "1", cldbid: "12" })).toBe(true);
    expect(ok("setclientchannelgroup", { cgid: "5", cldbid: "12" })).toBe(false);
  });
});
