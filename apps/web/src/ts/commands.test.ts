import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeTextCode, type ClientMessage, type ServerMessage } from "@jinz/protocol";
import type { HubState } from "./connection";
import { TsCommandClient, TsCommandError, type CommandTransport } from "./commands";

/** A hub stand-in: records what is sent and lets the test answer. */
function fakeHub(state: HubState = "open") {
  const sent: ClientMessage[] = [];
  const msgListeners = new Set<(m: ServerMessage) => void>();
  const stateListeners = new Set<(s: HubState) => void>();
  const transport: CommandTransport & { state: HubState } = {
    state,
    send: (m) => void sent.push(m),
    onMessage: (fn) => {
      msgListeners.add(fn);
      return () => msgListeners.delete(fn);
    },
    onState: (fn) => {
      stateListeners.add(fn);
      return () => stateListeners.delete(fn);
    },
  };
  return {
    transport,
    sent,
    deliver: (m: ServerMessage) => msgListeners.forEach((l) => l(m)),
    setState: (s: HubState) => {
      transport.state = s;
      stateListeners.forEach((l) => l(s));
    },
  };
}

const idOf = (m: ClientMessage | undefined) => (m && m.type === "ts.cmd" ? m.id : "");

afterEach(() => vi.useRealTimers());

// vitest.setup.ts reports an English browser, so messages come out in English.

describe("TsCommandClient", () => {
  it("sends a validated ts.cmd and resolves with the rows answered under its id", async () => {
    const hub = fakeHub();
    const client = new TsCommandClient(hub.transport);
    const a = client.run("servergrouplist", {});
    const b = client.run("channelgrouplist", {});
    expect(hub.sent.map((m) => m.type === "ts.cmd" && m.cmd)).toEqual([
      "servergrouplist",
      "channelgrouplist",
    ]);
    const [idA, idB] = hub.sent.map(idOf);
    expect(idA).not.toBe(idB);
    // Answers may come back in any order.
    hub.deliver({ type: "ts.cmdResult", id: idB!, ok: true, rows: [{ cgid: "5" }] });
    hub.deliver({ type: "ts.cmdResult", id: idA!, ok: true, rows: [{ sgid: "6" }] });
    await expect(a).resolves.toEqual([{ sgid: "6" }]);
    await expect(b).resolves.toEqual([{ cgid: "5" }]);
    expect(client.inFlight).toBe(0);
  });

  it("rejects with a translated error carrying the TeamSpeak code", async () => {
    const hub = fakeHub();
    const client = new TsCommandClient(hub.transport);
    const p = client.run("clientedit", { clid: 4, client_is_talker: true });
    hub.deliver({
      type: "ts.cmdResult",
      id: idOf(hub.sent[0]),
      ok: false,
      code: "2568",
      message: encodeTextCode("tsErr.missingPermission", { perm: "b_client_set_flag_talker" }),
      failedPermission: "b_client_set_flag_talker",
    });
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TsCommandError);
    expect(err).toMatchObject({
      code: "2568",
      failedPermission: "b_client_set_flag_talker",
      message: "Insufficient permissions (needs b_client_set_flag_talker)",
    });
  });

  it("refuses bad arguments locally without sending anything", async () => {
    const hub = fakeHub();
    const client = new TsCommandClient(hub.transport);
    // @ts-expect-error -- deliberately wrong type, as untyped callers could send
    const p = client.run("clientupdate", { client_away: "yes" });
    await expect(p).rejects.toMatchObject({ code: "bad_args" });
    expect(hub.sent).toHaveLength(0);
  });

  it("fails at once when the hub is not open", async () => {
    const client = new TsCommandClient(fakeHub("closed").transport);
    await expect(client.run("channelsubscribeall", {})).rejects.toMatchObject({
      code: "not_connected",
      message: "Not connected to a server",
    });
  });

  it("times out when nobody answers, and ignores the late answer", async () => {
    vi.useFakeTimers();
    const hub = fakeHub();
    const client = new TsCommandClient(hub.transport, 10_000);
    const p = client.run("servergrouplist", {});
    const settled = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await settled).toMatchObject({ code: "timeout" });
    hub.deliver({ type: "ts.cmdResult", id: idOf(hub.sent[0]), ok: true, rows: [] });
    expect(client.inFlight).toBe(0);
  });

  it("fails everything in flight when the link or the server goes away", async () => {
    const hub = fakeHub();
    const client = new TsCommandClient(hub.transport);
    const a = client.run("servergrouplist", {});
    hub.setState("closed");
    await expect(a).rejects.toMatchObject({ code: "not_connected" });

    hub.setState("open");
    const b = client.run("servergrouplist", {});
    hub.deliver({ type: "disconnected", reason: "hub.byeDropped", byUser: false });
    await expect(b).rejects.toMatchObject({ code: "not_connected" });
    expect(client.inFlight).toBe(0);
  });
});
