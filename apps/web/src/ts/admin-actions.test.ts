import { beforeEach, describe, expect, it, vi } from "vitest";
import { NAME_LOOKUP_MAX, TsCmdRequestSchema, type TsCmdRow } from "@jinz/protocol";

const calls: { cmd: string; args: unknown }[] = [];
let answer: (cmd: string, args: Record<string, unknown>) => TsCmdRow[] = () => [];

vi.mock("./commands", () => {
  class TsCommandError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    TsCommandError,
    tsCommand: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
      // Whatever goes out must pass the hub's own schema.
      TsCmdRequestSchema.parse({ type: "ts.cmd", id: "t1", cmd, args });
      calls.push({ cmd, args });
      return answer(cmd, args);
    }),
  };
});

const actions = await import("./admin-actions");
const { TsCommandError } = await import("./commands");

beforeEach(() => {
  calls.length = 0;
  answer = () => [];
});

describe("admin actions", () => {
  it("files and removes complaints", async () => {
    await actions.fileComplaint("5", "  spams  ");
    await actions.deleteComplaint("5", "6");
    await actions.deleteAllComplaints("5");
    expect(calls).toEqual([
      { cmd: "complainadd", args: { tcldbid: "5", message: "spams" } },
      { cmd: "complaindel", args: { tcldbid: "5", fcldbid: "6" } },
      { cmd: "complaindelall", args: { tcldbid: "5" } },
    ]);
  });

  it("sends an offline message with a trimmed subject and the body as typed", async () => {
    await actions.sendOfflineMessage(" abc= ", " Hi ", " body\n");
    expect(calls[0]).toEqual({
      cmd: "messageadd",
      args: { cluid: "abc=", subject: "Hi", message: " body\n" },
    });
  });

  it("looks up the names of several UIDs in one command", async () => {
    answer = () => [
      { cluid: "a=", cldbid: "5", name: "alice" },
      { cluid: "b=", cldbid: "6", name: "bob" },
    ];
    expect(await actions.namesFromUids(["a=", "b=", "a="])).toEqual({ "a=": "alice", "b=": "bob" });
    expect(calls).toEqual([{ cmd: "clientgetnamefromuid", args: { cluids: ["a=", "b="] } }]);
  });

  it("asks one by one when a UID the server never saw fails the batch (512)", async () => {
    answer = (_cmd, args) => {
      const uids = args["cluids"] as string[];
      if (uids.includes("zz=")) throw new TsCommandError("512", "invalid clientID");
      return uids.map((u) => ({ cluid: u, name: `n-${u}` }));
    };
    expect(await actions.namesFromUids(["a=", "zz="])).toEqual({ "a=": "n-a=", "zz=": null });
    expect(calls.map((c) => c.args)).toEqual([
      { cluids: ["a=", "zz="] },
      { cluids: ["a="] },
      { cluids: ["zz="] },
    ]);
  });

  it("splits long lists and passes other failures on", async () => {
    const uids = Array.from({ length: NAME_LOOKUP_MAX + 1 }, (_, i) => `u${i}=`);
    answer = () => [];
    await actions.namesFromUids(uids);
    expect(calls.map((c) => (c.args as { cluids: string[] }).cluids.length)).toEqual([
      NAME_LOOKUP_MAX,
      1,
    ]);
    answer = () => {
      throw new TsCommandError("2568", "no");
    };
    await expect(actions.namesFromUids(["c="])).rejects.toThrow("no");
  });

  it("asks for a page with the total", async () => {
    answer = () => [{ count: "3", cldbid: "2", client_nickname: "x" }];
    const page = await actions.listClientDb(25, 25);
    expect(calls[0]).toEqual({
      cmd: "clientdblist",
      args: { start: 25, duration: 25, count: true },
    });
    expect(page.total).toBe(3);
  });

  it("searches nicknames as a substring, then fetches the hits' details in one command", async () => {
    answer = (cmd, args) =>
      cmd === "clientdbfind"
        ? [{ cldbid: "7" }, { cldbid: "8" }]
        : (args["cldbids"] as string[]).map((id) => ({
            client_database_id: id,
            client_nickname: `n${id}`,
          }));
    const res = await actions.searchClientDb("bob");
    expect(calls.map((c) => c.cmd)).toEqual(["clientdbfind", "clientdbinfo"]);
    expect(calls[0]!.args).toEqual({ pattern: "%bob%" });
    expect(calls[1]!.args).toEqual({ cldbids: ["7", "8"] });
    expect(res.entries.map((e) => e.nickname)).toEqual(["n7", "n8"]);
    expect(res.ids).toEqual(["7", "8"]);
    expect(res.more).toBe(false);
  });

  it("searches a UID exactly, and fetches details for the first page only", async () => {
    const uid = "cDJinVyKGaXAD5Rg+JTdvzrw7kY=";
    const many = Array.from({ length: actions.DB_SEARCH_PAGE + 5 }, (_, i) => ({
      cldbid: String(i + 1),
    }));
    answer = (cmd, args) =>
      cmd === "clientdbfind"
        ? many
        : (args["cldbids"] as string[]).map((id) => ({ client_database_id: id }));
    const res = await actions.searchClientDb(uid);
    expect(calls[0]!.args).toEqual({ pattern: uid, uid: true });
    expect(calls).toHaveLength(2);
    expect(res.entries).toHaveLength(actions.DB_SEARCH_PAGE);
    expect(res.ids).toHaveLength(actions.DB_SEARCH_PAGE + 5);
    expect(res.more).toBe(true);
    // The rest when asked for, again in one command.
    const next = await actions.clientDbInfos(res.ids.slice(actions.DB_SEARCH_PAGE));
    expect(next.map((e) => e.dbId)).toEqual(["26", "27", "28", "29", "30"]);
    expect(calls).toHaveLength(3);
  });

  it("skips an entry deleted since the search (the server fails the whole batch with 512)", async () => {
    answer = (_cmd, args) => {
      const ids = args["cldbids"] as string[];
      if (ids.includes("9")) throw new TsCommandError("512", "invalid clientID");
      return ids.map((id) => ({ client_database_id: id }));
    };
    const entries = await actions.clientDbInfos(["7", "9", "8"]);
    expect(entries.map((e) => e.dbId)).toEqual(["7", "8"]);
    expect(calls.map((c) => c.args)).toEqual([
      { cldbids: ["7", "9", "8"] },
      { cldbids: ["7"] },
      { cldbids: ["9"] },
      { cldbids: ["8"] },
    ]);
  });

  it("does not search for nothing", async () => {
    expect(await actions.searchClientDb("   ")).toEqual({ ids: [], entries: [], more: false });
    expect(calls).toHaveLength(0);
  });

  it("adds temporary passwords with and without a target channel", async () => {
    await actions.addTempPassword({ password: "pw", description: " d ", seconds: 3600 });
    await actions.addTempPassword({
      password: "pw",
      description: "",
      seconds: 60,
      channelId: "7",
      channelPassword: "c",
    });
    await actions.deleteTempPassword("pw");
    expect(calls.map((c) => c.args)).toEqual([
      { pw: "pw", desc: "d", duration: 3600 },
      { pw: "pw", desc: "", duration: 60, tcid: "7", tcpw: "c" },
      { pw: "pw" },
    ]);
  });

  it("reads, flags and deletes offline messages", async () => {
    answer = (cmd) =>
      cmd === "messageget" ? [{ msgid: "3", subject: "s", message: "b", timestamp: "1" }] : [];
    const msg = await actions.readOfflineMessage("3");
    await actions.markOfflineMessageRead("3");
    await actions.deleteOfflineMessage("3");
    expect(msg?.body).toBe("b");
    expect(calls.map((c) => c.cmd)).toEqual(["messageget", "messageupdateflag", "messagedel"]);
    expect(calls[1]!.args).toEqual({ msgid: "3", flag: true });
  });
});
