import { beforeEach, describe, expect, it, vi } from "vitest";
import { TsCmdRequestSchema } from "@jinz/protocol";

const calls: { cmd: string; args: unknown }[] = [];
/** The TeamSpeak error id the next command fails with, if any. */
let failWith: string | null = null;
const { FakeTsCommandError } = vi.hoisted(() => ({
  FakeTsCommandError: class extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("./commands", () => ({
  TsCommandError: FakeTsCommandError,
  tsCommand: vi.fn(async (cmd: string, args: unknown) => {
    // Whatever goes out must pass the hub's own schema.
    TsCmdRequestSchema.parse({ type: "ts.cmd", id: "t1", cmd, args });
    calls.push({ cmd, args });
    const code = failWith;
    failWith = null;
    if (code) throw new FakeTsCommandError(code, `failed ${code}`);
    return [];
  }),
}));

const actions = await import("./moderation-actions");

beforeEach(() => {
  calls.length = 0;
  failWith = null;
});

describe("moderation actions", () => {
  it("moves a client, sending a password only when there is one", async () => {
    await actions.moveClient(4, "7");
    await actions.moveClient(4, "8", "secret");
    await actions.moveClient(4, "9", "");
    expect(calls).toEqual([
      { cmd: "clientmove", args: { clid: 4, cid: "7" } },
      { cmd: "clientmove", args: { clid: 4, cid: "8", cpw: "secret" } },
      { cmd: "clientmove", args: { clid: 4, cid: "9" } },
    ]);
  });

  it("kicks from the channel or the server with a trimmed reason, none when blank", async () => {
    await actions.kickClient(5, "channel", "  spam ");
    await actions.kickClient(5, "server", "   ");
    expect(calls).toEqual([
      { cmd: "clientkick", args: { clid: 5, reasonid: 4, reasonmsg: "spam" } },
      { cmd: "clientkick", args: { clid: 5, reasonid: 5 } },
    ]);
  });

  it("adds to and removes from a server group", async () => {
    await actions.setServerGroup("12", "7", true);
    await actions.setServerGroup("12", "7", false);
    expect(calls).toEqual([
      { cmd: "servergroupaddclient", args: { sgid: "7", cldbid: "12" } },
      { cmd: "servergroupdelclient", args: { sgid: "7", cldbid: "12" } },
    ]);
  });

  it("reports whether the group membership changed", async () => {
    expect(await actions.setServerGroup("12", "7", true)).toBe("changed");
    expect(await actions.setServerGroup("12", "7", false)).toBe("changed");
  });

  it("takes 'duplicate entry' on an add as already a member", async () => {
    failWith = "2561";
    expect(await actions.setServerGroup("12", "7", true)).toBe("unchanged");
  });

  it("takes 'empty result set' on a removal as not a member anyway", async () => {
    failWith = "2563";
    expect(await actions.setServerGroup("12", "7", false)).toBe("unchanged");
  });

  it("still fails on any other error, or on those codes the other way round", async () => {
    failWith = "2568";
    await expect(actions.setServerGroup("12", "7", true)).rejects.toThrow("failed 2568");
    failWith = "2563";
    await expect(actions.setServerGroup("12", "7", true)).rejects.toThrow("failed 2563");
    failWith = "2561";
    await expect(actions.setServerGroup("12", "7", false)).rejects.toThrow("failed 2561");
  });

  it("sets the channel group in one channel", async () => {
    await actions.setChannelGroup("12", "3", "5");
    expect(calls).toEqual([
      { cmd: "setclientchannelgroup", args: { cgid: "5", cid: "3", cldbid: "12" } },
    ]);
  });

  it("denies a talk request by clearing the talker flag", async () => {
    await actions.denyTalkRequest(6);
    expect(calls).toEqual([{ cmd: "clientedit", args: { clid: 6, client_is_talker: false } }]);
  });

  it("switches channel commander", async () => {
    await actions.setChannelCommander(true);
    expect(calls).toEqual([{ cmd: "clientupdate", args: { client_is_channel_commander: true } }]);
  });
});
