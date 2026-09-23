import { describe, expect, it } from "vitest";
import { PacedRequests } from "./paced-requests.js";
import { ServerGuard, type Clock } from "./server-guard.js";

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

function setup(batch: boolean) {
  const guard = new ServerGuard(fakeClock());
  const sent: string[][] = [];
  const errors: unknown[] = [];
  const requests = new PacedRequests({
    guard: () => guard,
    batch,
    send: async (keys) => {
      if (keys.includes("bad")) throw new Error("refused");
      sent.push(keys);
    },
    onError: (err) => errors.push(err),
  });
  return { guard, sent, errors, requests };
}

describe("PacedRequests", () => {
  it("batching: everything asked for before the pace slot goes out as one command", async () => {
    const { sent, requests } = setup(true);
    await Promise.all([requests.request("5"), requests.request("6"), requests.request("5")]);
    expect(sent).toEqual([["5", "6"]]);
  });

  it("one by one: a key asked for again while it waits rides along", async () => {
    const { sent, requests } = setup(false);
    await Promise.all([
      requests.request("5"),
      requests.request("5"),
      requests.request("7"),
      requests.request("5"),
    ]);
    expect(sent).toEqual([["5"], ["7"]]);
  });

  it("asks again once the earlier request has gone out", async () => {
    const { sent, requests } = setup(false);
    await requests.request("5");
    await requests.request("5");
    expect(sent).toEqual([["5"], ["5"]]);
  });

  it("goes through the guard's pacing", async () => {
    const { guard, sent, requests } = setup(false);
    let other = false;
    const earlier = guard.paced(async () => {
      other = true;
    });
    const mine = requests.request("5");
    expect(sent).toEqual([]);
    await Promise.all([earlier, mine]);
    expect(other).toBe(true);
    expect(sent).toEqual([["5"]]);
  });

  it("sends nothing while the server is flooded, and says so to no one", async () => {
    const { guard, sent, errors, requests } = setup(true);
    guard.noteFlood();
    await requests.request("5");
    expect(sent).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("reports a failed send and keeps working", async () => {
    const { sent, errors, requests } = setup(false);
    await requests.request("bad");
    await requests.request("5");
    expect(errors).toHaveLength(1);
    expect(sent).toEqual([["5"]]);
  });

  it("drops what is still waiting when cleared", async () => {
    const { sent, requests } = setup(true);
    const pending = requests.request("5");
    requests.clear();
    await pending;
    expect(sent).toEqual([]);
  });
});
