import { describe, expect, it } from "vitest";
import { CommandTimeoutError, ServerError } from "@honeybbq/teamspeak-client";
import { TsCmdRequestSchema, decodeTextCode, type TsCmdRequest } from "@jinz/protocol";
import { parseCommandLines } from "./raw.js";
import {
  buildTsCommand,
  describeTsFailure,
  prepareTsCommand,
  runTsCmd,
  TsCommandFailure,
  TsCommandRefused,
  TS_CMD_TIMEOUT_MS,
  tsCmdIdOf,
  type PreparedCommand,
  type TsCommandTarget,
} from "./commands.js";
import { parsePermissionList } from "./perms.js";
import { ServerGuard, TS_CMD_BURST, TS_CMD_MAX_WAIT_MS, type Clock } from "./server-guard.js";

/** Validates like the hub does, so tests only ever build what the schema lets through. */
function req(cmd: string, args: unknown, id = "r1"): TsCmdRequest {
  return TsCmdRequestSchema.parse({ type: "ts.cmd", id, cmd, args });
}

const catalog = parsePermissionList([
  { group_id_end: "0" },
  { permname: "b_serverinstance_help_view", permdesc: "Help" },
  { permname: "i_client_kick_from_server_power", permdesc: "Kick" },
]);

function fakeTarget(
  run: (p: PreparedCommand) => Promise<Record<string, string>[]>,
  guard?: ServerGuard,
) {
  const sent: PreparedCommand[] = [];
  const timeouts: Array<number | undefined> = [];
  const target: TsCommandTarget = {
    runCommand: (p, timeoutMs) => {
      sent.push(p);
      timeouts.push(timeoutMs);
      return run(p);
    },
    permissionCatalog: async () => catalog,
    ...(guard ? { guard } : {}),
  };
  return { target, sent, timeouts };
}

/** A clock whose sleeps advance time instantly. */
function fakeClock(): Clock & { t: number } {
  const clock = {
    t: 1_000_000,
    now: () => clock.t,
    sleep: async (ms: number) => {
      clock.t += ms;
    },
  };
  return clock;
}

describe("buildTsCommand", () => {
  it("escapes every value TeamSpeak treats specially", () => {
    const text = buildTsCommand("clientupdate", { client_away_message: "a b|c\\d/e\nf" });
    expect(text).toBe("clientupdate client_away_message=a\\sb\\pc\\\\d\\/e\\nf");
  });

  it("cannot be tricked into extra parameters or rows", () => {
    const text = buildTsCommand("clientedit", {
      clid: "4",
      client_description: "x client_servergroups=6|clid=1",
    });
    // Parsing it back must yield exactly one row with exactly our two keys.
    const rows = parseCommandLines(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.params).toEqual({
      clid: "4",
      client_description: "x client_servergroups=6|clid=1",
    });
  });

  it("puts shared parameters on the first of several rows", () => {
    expect(
      buildTsCommand("permoverview", { cid: "1", cldbid: "2" }, [{ permid: "5" }, { permid: "7" }]),
    ).toBe("permoverview cid=1 cldbid=2 permid=5|permid=7");
  });
});

describe("prepareTsCommand", () => {
  it("turns flags into 1/0 and drops unset fields", () => {
    const p = prepareTsCommand(
      req("clientupdate", { client_away: true, client_talk_request: false }),
    );
    expect(p).toEqual({ text: "clientupdate client_away=1 client_talk_request=0", collect: null });
  });

  it("sends one row per channel to (un)subscribe", () => {
    expect(prepareTsCommand(req("channelsubscribe", { cids: ["1", "22"] })).text).toBe(
      "channelsubscribe cid=1|cid=22",
    );
    expect(prepareTsCommand(req("channelunsubscribeall", {})).text).toBe("channelunsubscribeall");
  });

  it("collects the notification that answers a list command", () => {
    expect(prepareTsCommand(req("servergrouplist", {}))).toEqual({
      text: "servergrouplist",
      collect: "notifyservergrouplist",
    });
    expect(prepareTsCommand(req("permoverview", { cid: "3", cldbid: "9" }))).toEqual({
      text: "permoverview cid=3 cldbid=9 permid=0",
      collect: "notifypermoverview",
    });
  });
});

describe("prepareTsCommand: M2 moderation", () => {
  it("moves a client, hashing the channel password as the client protocol wants", () => {
    expect(prepareTsCommand(req("clientmove", { clid: 4, cid: "7" }))).toEqual({
      text: "clientmove clid=4 cid=7",
      collect: null,
    });
    // base64(sha1("secret")); the slash is escaped on the wire.
    expect(prepareTsCommand(req("clientmove", { clid: 4, cid: "7", cpw: "secret" })).text).toBe(
      "clientmove clid=4 cid=7 cpw=5en6G6MezRroT3XKqkdPOmY\\/BfQ=",
    );
    // An empty password is no password.
    expect(prepareTsCommand(req("clientmove", { clid: 4, cid: "7", cpw: "" })).text).toBe(
      "clientmove clid=4 cid=7",
    );
  });

  it("kicks with an escaped reason, or none", () => {
    expect(
      prepareTsCommand(req("clientkick", { clid: 9, reasonid: 5, reasonmsg: "go away|now" })).text,
    ).toBe("clientkick clid=9 reasonid=5 reasonmsg=go\\saway\\pnow");
    expect(prepareTsCommand(req("clientkick", { clid: 9, reasonid: 4 })).text).toBe(
      "clientkick clid=9 reasonid=4",
    );
  });

  it("builds the group assignment commands", () => {
    expect(prepareTsCommand(req("servergroupaddclient", { sgid: "7", cldbid: "12" })).text).toBe(
      "servergroupaddclient sgid=7 cldbid=12",
    );
    expect(prepareTsCommand(req("servergroupdelclient", { sgid: "7", cldbid: "12" })).text).toBe(
      "servergroupdelclient sgid=7 cldbid=12",
    );
    expect(
      prepareTsCommand(req("setclientchannelgroup", { cgid: "5", cid: "1", cldbid: "12" })).text,
    ).toBe("setclientchannelgroup cgid=5 cid=1 cldbid=12");
  });
});

describe("ban commands", () => {
  it("bans a connected client by id, reason escaped", () => {
    expect(
      prepareTsCommand(req("banclient", { clid: 7, time: 600, banreason: "go away" })),
    ).toEqual({ text: "banclient clid=7 time=600 banreason=go\\saway", collect: null });
  });

  it("adds a rule with only the fields given, trimmed", () => {
    expect(prepareTsCommand(req("banadd", { uid: " abc+/= ", time: 0, banreason: "" })).text).toBe(
      "banadd uid=abc+\\/= time=0 banreason=",
    );
    expect(
      prepareTsCommand(req("banadd", { ip: "10.0.0.1", name: "^a b$", time: 60, banreason: "x" }))
        .text,
    ).toBe("banadd ip=10.0.0.1 name=^a\\sb$ time=60 banreason=x");
  });

  it("collects the ban list from notifybanlist (checked on a live TS3 3.13 server)", () => {
    expect(prepareTsCommand(req("banlist", {}))).toEqual({
      text: "banlist",
      collect: "notifybanlist",
    });
  });

  it("deletes one ban or all of them", () => {
    expect(prepareTsCommand(req("bandel", { banid: "12" })).text).toBe("bandel banid=12");
    expect(prepareTsCommand(req("bandelall", {})).text).toBe("bandelall");
  });

  it("maps 'invalid ban id' to its own message", () => {
    expect(describeTsFailure("x", new ServerError("3328", "invalid ban id")).message).toBe(
      "tsErr.invalidBanId",
    );
  });

  it("maps a duplicate group entry (adding a group the client already has)", () => {
    // Checked on a live TS3 server: a second servergroupaddclient answers 2561.
    const failure = describeTsFailure("x", new ServerError("2561", "duplicate entry"));
    expect(failure.code).toBe("2561");
    expect(failure.message).toBe("tsErr.groupDuplicate");
  });
});

describe("runTsCmd", () => {
  it("answers with the rows under the request id", async () => {
    const { target, sent } = fakeTarget(async () => [{ sgid: "6", name: "Admin" }]);
    const res = await runTsCmd(target, req("servergrouplist", {}, "abc"));
    expect(res).toEqual({
      type: "ts.cmdResult",
      id: "abc",
      ok: true,
      rows: [{ sgid: "6", name: "Admin" }],
    });
    expect(sent[0]!.text).toBe("servergrouplist");
  });

  it("serves permissionlist from the catalog, ids included", async () => {
    const { target, sent } = fakeTarget(async () => []);
    const res = await runTsCmd(target, req("permissionlist", {}));
    expect(sent).toHaveLength(0);
    expect(res.ok && res.rows[1]).toEqual({
      permid: "2",
      permname: "i_client_kick_from_server_power",
      permdesc: "Kick",
    });
  });

  it("treats an empty result set as an empty list", async () => {
    const { target } = fakeTarget(async () => {
      throw new TsCommandFailure("1281", "database empty result set", null);
    });
    expect(await runTsCmd(target, req("clientpermlist", { cldbid: "5" }))).toEqual({
      type: "ts.cmdResult",
      id: "r1",
      ok: true,
      rows: [],
    });
  });

  it("names the permission a 2568 failed on", async () => {
    const { target } = fakeTarget(async () => {
      throw new TsCommandFailure("2568", "insufficient client permissions", 2);
    });
    const res = await runTsCmd(target, req("clientedit", { clid: 4, client_is_talker: true }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("2568");
    expect(res.failedPermission).toBe("i_client_kick_from_server_power");
    expect(decodeTextCode(res.message)).toEqual({
      key: "tsErr.missingPermission",
      params: { perm: "i_client_kick_from_server_power" },
    });
  });
});

describe("describeTsFailure", () => {
  it("maps common TeamSpeak error ids to message keys", () => {
    const cases: Array<[string, string]> = [
      ["2568", "tsErr.insufficientPermissions"],
      ["768", "tsErr.invalidChannel"],
      ["512", "tsErr.invalidClient"],
      ["1540", "tsErr.conversion"],
      ["771", "tsErr.channelNameInUse"],
    ];
    for (const [id, key] of cases) {
      const f = describeTsFailure("x", new ServerError(id, "whatever"));
      expect(f.code).toBe(id);
      expect(f.message).toBe(key);
    }
  });

  it("keeps the server's own text for ids without a key", () => {
    const f = describeTsFailure("x", new ServerError("1797", "weird thing"));
    expect(decodeTextCode(f.message)).toEqual({
      key: "tsErr.generic",
      params: { id: "1797", msg: "weird thing" },
    });
  });

  it("reports a timeout under the hub's own code", () => {
    const f = describeTsFailure("x", new CommandTimeoutError("servergrouplist"));
    expect(f).toMatchObject({ code: "timeout", message: "tsErr.timeout" });
  });

  it("never forwards the text of an unexpected error (it goes to the log)", () => {
    expect(describeTsFailure("x", new Error("EPIPE /srv/hub/secret.txt"))).toMatchObject({
      code: "failed",
      message: "tsErr.failed",
    });
    expect(describeTsFailure("x", "a string")).toMatchObject({ message: "tsErr.failed" });
  });
});

describe("control characters", () => {
  it("are refused where every command is built, not stripped", () => {
    expect(() => buildTsCommand("clientupdate", { client_away_message: "a\x00b" })).toThrow(
      TsCommandRefused,
    );
    expect(() => buildTsCommand("x", {}, [{ a: "ok" }, { b: "del\x7f" }])).toThrow(
      TsCommandRefused,
    );
    // Everything the escaping handles is still fine.
    expect(() => buildTsCommand("x", { a: "tab\there\nnew\x07bell" })).not.toThrow();
  });

  it("come back as an invalid request, and nothing is sent", async () => {
    const { target, sent } = fakeTarget(async () => []);
    const res = await runTsCmd(
      target,
      req("channeledit", { cid: "5", channel_description: "hi\x00channel_name=x" }),
    );
    expect(sent).toHaveLength(0);
    expect(res).toMatchObject({ ok: false, code: "bad_args", message: "tsErr.controlChars" });
  });
});

describe("unexpected failures", () => {
  it("are logged in full for the operator", async () => {
    const logged: unknown[] = [];
    const { target } = fakeTarget(async () => {
      throw new Error("socket hang up at 10.1.2.3");
    });
    const res = await runTsCmd(target, req("servergrouplist", {}), {
      warn: (obj: unknown) => void logged.push(obj),
    });
    expect(res).toMatchObject({ ok: false, code: "failed", message: "tsErr.failed" });
    expect(JSON.stringify(logged)).toContain("servergrouplist");
    expect(logged).toHaveLength(1);
  });
});

describe("bans that would hit every web user", () => {
  function guarded() {
    const guard = new ServerGuard(fakeClock());
    guard.addHubClient(7);
    guard.noteHubAddress("172.17.0.1");
    return { guard, ...fakeTarget(async () => [], guard) };
  }

  it("refuses banclient on one of the hub's own sessions (it would ban the shared IP)", async () => {
    const { target, sent } = guarded();
    const res = await runTsCmd(target, req("banclient", { clid: 7, time: 60, banreason: "" }));
    expect(sent).toHaveLength(0);
    expect(res).toMatchObject({
      ok: false,
      code: "shared_address",
      message: "tsErr.banSharedAddress",
    });
  });

  it("lets banclient through for anyone else", async () => {
    const { target, sent } = guarded();
    const res = await runTsCmd(target, req("banclient", { clid: 8, time: 60, banreason: "" }));
    expect(res.ok).toBe(true);
    expect(sent[0]!.text).toBe("banclient clid=8 time=60 banreason=");
  });

  it("refuses an IP rule on the hub's own address, however it is spelled", async () => {
    const { target, sent } = guarded();
    for (const ip of ["172.17.0.1", "::ffff:172.17.0.1"]) {
      const res = await runTsCmd(target, req("banadd", { ip, time: 60, banreason: "" }));
      expect(res).toMatchObject({ ok: false, code: "shared_address" });
    }
    expect(sent).toHaveLength(0);
  });

  it("only sends literal addresses", async () => {
    const { target, sent } = guarded();
    const bad = await runTsCmd(target, req("banadd", { ip: "172.*", time: 60, banreason: "" }));
    expect(bad).toMatchObject({ ok: false, code: "bad_ban_rule", message: "tsErr.banIpInvalid" });
    const good = await runTsCmd(target, req("banadd", { ip: "10.0.0.9", time: 0, banreason: "" }));
    expect(good.ok).toBe(true);
    expect(sent.map((p) => p.text)).toEqual(["banadd ip=10.0.0.9 time=0 banreason="]);
  });

  it("allows IP rules while the hub's address is not known yet", async () => {
    const { target, sent } = fakeTarget(async () => [], new ServerGuard(fakeClock()));
    const res = await runTsCmd(target, req("banadd", { ip: "172.17.0.1", time: 1, banreason: "" }));
    expect(res.ok).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("refuses nickname rules that match everyone or could hang the server", async () => {
    const { target, sent } = guarded();
    const all = await runTsCmd(target, req("banadd", { name: ".*", time: 60, banreason: "" }));
    expect(all).toMatchObject({ code: "bad_ban_rule", message: "tsErr.banNameMatchesAll" });
    const slow = await runTsCmd(target, req("banadd", { name: "(a+)+$", time: 9, banreason: "" }));
    expect(slow).toMatchObject({ code: "bad_ban_rule", message: "tsErr.banNameUnsafe" });
    const bad = await runTsCmd(target, req("banadd", { name: "[", time: 9, banreason: "" }));
    expect(bad).toMatchObject({ code: "bad_ban_rule", message: "tsErr.banNameInvalid" });
    expect(sent).toHaveLength(0);
    // The same checks apply without a guard (no hub facts needed for them).
    const plain = fakeTarget(async () => []);
    const res = await runTsCmd(plain.target, req("banadd", { name: ".*", time: 1, banreason: "" }));
    expect(res).toMatchObject({ code: "bad_ban_rule" });
  });
});

describe("the hub-wide command budget", () => {
  it("takes a slot before each command and gives the server what is left of the page's wait", async () => {
    const guard = new ServerGuard(fakeClock());
    const { target, timeouts } = fakeTarget(async () => [], guard);
    await runTsCmd(target, req("servergrouplist", {}));
    await runTsCmd(target, req("servergrouplist", {}));
    expect(timeouts[0]).toBe(TS_CMD_TIMEOUT_MS);
    expect(timeouts[1]!).toBeLessThan(TS_CMD_TIMEOUT_MS);
  });

  it("answers busy instead of queueing past what the page waits for", async () => {
    const guard = new ServerGuard(fakeClock());
    const { target, sent } = fakeTarget(async () => [], guard);
    const queued = Array.from({ length: TS_CMD_BURST + TS_CMD_MAX_WAIT_MS / 1000 }, () =>
      guard.tsCmdSlot(),
    );
    const res = await runTsCmd(target, req("servergrouplist", {}));
    expect(res).toMatchObject({ ok: false, code: "rate_limited", message: "tsErr.hubBusy" });
    expect(sent).toHaveLength(0);
    await Promise.all(queued);
  });

  it("is not spent on commands the hub refuses anyway", async () => {
    const clock = fakeClock();
    const guard = new ServerGuard(clock);
    const { target } = fakeTarget(async () => [], guard);
    for (let i = 0; i < 3 * TS_CMD_BURST; i++) {
      await runTsCmd(target, req("banadd", { name: ".*", time: 1, banreason: "" }));
    }
    expect(await guard.tsCmdSlot()).toBe(0);
  });
});

describe("tsCmdIdOf", () => {
  it("finds the id of a ts.cmd, valid or not", () => {
    expect(tsCmdIdOf({ type: "ts.cmd", id: "q1", cmd: "nope" })).toBe("q1");
    expect(tsCmdIdOf({ type: "ts.cmd", id: "bad id" })).toBeNull();
    expect(tsCmdIdOf({ type: "ping", id: "q1" })).toBeNull();
    expect(tsCmdIdOf(null)).toBeNull();
  });
});
