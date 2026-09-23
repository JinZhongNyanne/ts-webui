import { beforeEach, describe, expect, it, vi } from "vitest";
import { TsCmdRequestSchema } from "@jinz/protocol";

const calls: { cmd: string; args: unknown }[] = [];
vi.mock("./commands", () => ({
  tsCommand: vi.fn(async (cmd: string, args: unknown) => {
    // Whatever goes out must pass the hub's own schema.
    TsCmdRequestSchema.parse({ type: "ts.cmd", id: "t1", cmd, args });
    calls.push({ cmd, args });
    return [];
  }),
}));

const actions = await import("./client-actions");

beforeEach(() => {
  calls.length = 0;
});

describe("client actions", () => {
  it("changes the nickname, trimmed", async () => {
    await actions.changeNickname("  alice  ");
    expect(calls).toEqual([{ cmd: "clientupdate", args: { client_nickname: "alice" } }]);
  });

  it("sets away with a message and clears it when coming back", async () => {
    await actions.setAwayStatus(true, " lunch ");
    await actions.setAwayStatus(false, "ignored");
    expect(calls.map((c) => c.args)).toEqual([
      { client_away: true, client_away_message: "lunch" },
      { client_away: false, client_away_message: "" },
    ]);
  });

  it("requests and cancels talk power", async () => {
    await actions.requestTalkPower("may I?");
    await actions.cancelTalkRequest();
    expect(calls.map((c) => c.args)).toEqual([
      { client_talk_request: true, client_talk_request_msg: "may I?" },
      { client_talk_request: false, client_talk_request_msg: "" },
    ]);
  });

  it("edits descriptions and talker flags by client id", async () => {
    await actions.setDescription(7, "hi");
    await actions.setTalker(7, true);
    expect(calls).toEqual([
      { cmd: "clientedit", args: { clid: 7, client_description: "hi" } },
      { cmd: "clientedit", args: { clid: 7, client_is_talker: true } },
    ]);
  });

  it("subscribes in batches of at most 100 channels", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => String(i + 1));
    await actions.subscribeChannels(ids);
    await actions.unsubscribeChannels(["5"]);
    expect(calls.map((c) => [c.cmd, (c.args as { cids: string[] }).cids.length])).toEqual([
      ["channelsubscribe", 100],
      ["channelsubscribe", 50],
      ["channelunsubscribe", 1],
    ]);
  });

  it("subscribes and unsubscribes everything", async () => {
    await actions.subscribeAllChannels();
    await actions.unsubscribeAllChannels();
    expect(calls.map((c) => c.cmd)).toEqual(["channelsubscribeall", "channelunsubscribeall"]);
  });
});
