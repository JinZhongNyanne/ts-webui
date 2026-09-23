import { beforeEach, describe, expect, it, vi } from "vitest";
import { TsCmdRequestSchema } from "@jinz/protocol";
import { parseBan } from "./bans";

const calls: { cmd: string; args: unknown }[] = [];
let answer: Record<string, string>[] = [];
let failOn: string | null = null;
vi.mock("./commands", () => ({
  tsCommand: vi.fn(async (cmd: string, args: unknown) => {
    // Whatever goes out must pass the hub's own schema.
    TsCmdRequestSchema.parse({ type: "ts.cmd", id: "t1", cmd, args });
    calls.push({ cmd, args });
    if (cmd === failOn) throw new Error(`${cmd} refused`);
    return answer;
  }),
}));

const actions = await import("./ban-actions");

beforeEach(() => {
  calls.length = 0;
  answer = [];
  failOn = null;
});

describe("ban actions", () => {
  it("bans a connected client, reason trimmed", async () => {
    await actions.banClient(7, 600, "  spam ");
    expect(calls).toEqual([{ cmd: "banclient", args: { clid: 7, time: 600, banreason: "spam" } }]);
  });

  it("adds a rule without the blank fields", async () => {
    await actions.addBan({ ip: " ", name: "^bob$", uid: "" }, 0, "");
    expect(calls).toEqual([{ cmd: "banadd", args: { name: "^bob$", time: 0, banreason: "" } }]);
  });

  it("lists bans newest first", async () => {
    answer = [
      { banid: "1", created: "100", duration: "0" },
      { banid: "2", created: "300", duration: "0" },
      { banid: "3", created: "200", duration: "0" },
    ];
    expect((await actions.listBans()).map((b) => b.id)).toEqual(["2", "3", "1"]);
    expect(calls[0]!.cmd).toBe("banlist");
  });

  it("deletes one ban, or all", async () => {
    await actions.deleteBan("12");
    await actions.deleteAllBans();
    expect(calls).toEqual([
      { cmd: "bandel", args: { banid: "12" } },
      { cmd: "bandelall", args: {} },
    ]);
  });

  it("edits by adding the new ban before deleting the old one (TS3 has no banedit)", async () => {
    const old = parseBan({ banid: "9", uid: "abc=", created: "1", duration: "60" });
    await actions.editBan(old, { uid: "abc=" }, 3600, "longer");
    expect(calls.map((c) => c.cmd)).toEqual(["banadd", "bandel"]);
    expect(calls[1]!.args).toEqual({ banid: "9" });
  });

  it("keeps the old ban when the new one is refused", async () => {
    failOn = "banadd";
    const old = parseBan({ banid: "9", uid: "abc=" });
    await expect(actions.editBan(old, { uid: "abc=" }, 60, "")).rejects.toThrow("banadd refused");
    expect(calls.map((c) => c.cmd)).toEqual(["banadd"]);
  });

  it("says so distinctly when the new ban went in but the old one stayed", async () => {
    failOn = "bandel";
    const old = parseBan({ banid: "9", uid: "abc=" });
    const err = await actions.editBan(old, { uid: "abc=" }, 60, "").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(actions.BanEditPartialError);
    expect((err as Error).message).toBe("bandel refused");
    expect(calls.map((c) => c.cmd)).toEqual(["banadd", "bandel"]);
  });
});
