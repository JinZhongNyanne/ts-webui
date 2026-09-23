import { describe, expect, it } from "vitest";
import type { TsChannel } from "@jinz/protocol";
import type { ConnectRequest } from "@jinz/protocol";
import {
  buildReplayRequest,
  channelPath,
  RETRY_ATTEMPTS,
  RetryScheduler,
  retryDelayMs,
} from "./reconnect";

function ch(id: string, name: string, parentId = "0"): TsChannel {
  return {
    id,
    parentId,
    order: "0",
    name,
    namePhonetic: "",
    topic: "",
    codec: 4,
    codecQuality: 6,
    maxClients: -1,
    maxFamilyClients: -1,
    neededTalkPower: 0,
    iconId: 0,
    deleteDelay: 0,
    flags: {
      permanent: true,
      semiPermanent: false,
      default: false,
      password: false,
      maxClientsUnlimited: true,
      maxFamilyClientsUnlimited: true,
      maxFamilyClientsInherited: false,
    },
    subscribed: true,
  };
}

function mapOf(...list: TsChannel[]): Map<string, TsChannel> {
  return new Map(list.map((c) => [c.id, c]));
}

describe("channelPath", () => {
  it("returns the bare name for a root channel", () => {
    expect(channelPath(mapOf(ch("1", "Lobby")), "1")).toBe("Lobby");
  });

  it("joins ancestors with a slash, outermost first", () => {
    const channels = mapOf(ch("1", "Games"), ch("2", "Squad A", "1"), ch("3", "Alpha", "2"));
    expect(channelPath(channels, "3")).toBe("Games/Squad A/Alpha");
  });

  it("returns an empty string for an unknown channel", () => {
    expect(channelPath(mapOf(ch("1", "Lobby")), "9")).toBe("");
  });

  it("escapes a slash in a channel name so the path stays unambiguous", () => {
    const channels = mapOf(ch("1", "Rock/Pop"), ch("2", "Live", "1"));
    expect(channelPath(channels, "2")).toBe("Rock\\/Pop/Live");
  });

  it("does not hang on a parent cycle", () => {
    const a = ch("1", "A", "2");
    const b = ch("2", "B", "1");
    expect(() => channelPath(mapOf(a, b), "1")).not.toThrow();
  });
});

describe("retryDelayMs", () => {
  it("grows the delay with each attempt", () => {
    const first = retryDelayMs(0);
    const second = retryDelayMs(1);
    const third = retryDelayMs(2);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(third).not.toBeNull();
    // Jitter only ever shortens a wait, so the floors still order the attempts.
    expect(second!).toBeGreaterThan(first! / 2);
    expect(third!).toBeGreaterThan(second! / 2);
  });

  it("keeps every delay inside its nominal ceiling", () => {
    for (let i = 0; i < RETRY_ATTEMPTS; i++) {
      const d = retryDelayMs(i);
      expect(d).toBeGreaterThan(0);
      expect(d!).toBeLessThanOrEqual(2000 * 2 ** i);
    }
  });

  it("returns null once the budget is spent", () => {
    expect(retryDelayMs(RETRY_ATTEMPTS)).toBeNull();
    expect(retryDelayMs(RETRY_ATTEMPTS + 5)).toBeNull();
  });
});

describe("buildReplayRequest", () => {
  const base: ConnectRequest = {
    type: "connect",
    host: "ts.example",
    port: 9987,
    nickname: "Web123",
    defaultChannel: "Lobby",
  };

  it("replays the live channel instead of the profile default", () => {
    const req = buildReplayRequest(base, { path: "Games/Squad A", password: "" });
    expect(req.defaultChannel).toBe("Games/Squad A");
  });

  it("carries the live channel's password", () => {
    const req = buildReplayRequest(base, { path: "Private", password: "hunter2" });
    expect(req.defaultChannelPassword).toBe("hunter2");
  });

  it("drops a stale password when the live channel had none", () => {
    const withPw = { ...base, defaultChannelPassword: "old" };
    const req = buildReplayRequest(withPw, { path: "Lobby", password: "" });
    expect(req.defaultChannelPassword).toBeUndefined();
  });

  it("falls back to the profile default when there is no live channel", () => {
    const req = buildReplayRequest(base, null);
    expect(req.defaultChannel).toBe("Lobby");
  });

  it("falls back to the profile default when the path could not be resolved", () => {
    const req = buildReplayRequest(base, { path: "", password: "" });
    expect(req.defaultChannel).toBe("Lobby");
  });

  it("does not mutate the request it was given", () => {
    const snapshot = { ...base };
    buildReplayRequest(base, { path: "Elsewhere", password: "x" });
    expect(base).toEqual(snapshot);
  });

  it("keeps the rest of the request intact", () => {
    const req = buildReplayRequest(base, { path: "Games", password: "" });
    expect(req.host).toBe("ts.example");
    expect(req.nickname).toBe("Web123");
    expect(req.port).toBe(9987);
  });
});

describe("RetryScheduler", () => {
  function make() {
    const timers = new Map<number, () => void>();
    let nextId = 1;
    const retries: number[] = [];
    const s = new RetryScheduler({
      onRetry: () => retries.push(Date.now()),
      setTimer: (fn) => {
        const id = nextId++;
        timers.set(id, fn);
        return id;
      },
      clearTimer: (id) => timers.delete(id),
    });
    const fire = () => {
      const [id] = [...timers.keys()];
      if (id === undefined) throw new Error("no timer pending");
      const fn = timers.get(id)!;
      timers.delete(id);
      fn();
    };
    return { s, fire, retries, pendingTimers: () => timers.size };
  }

  it("schedules a retry and reports one pending", () => {
    const { s, pendingTimers } = make();
    expect(s.schedule()).toBe(true);
    expect(s.pending).toBe(true);
    expect(pendingTimers()).toBe(1);
  });

  it("fires the retry callback when the timer elapses", () => {
    const { s, fire, retries } = make();
    s.schedule();
    fire();
    expect(retries).toHaveLength(1);
    expect(s.pending).toBe(false);
  });

  it("stops after the attempt budget is spent", () => {
    const { s, fire, retries } = make();
    for (let i = 0; i < RETRY_ATTEMPTS; i++) {
      expect(s.schedule()).toBe(true);
      fire();
    }
    expect(retries).toHaveLength(RETRY_ATTEMPTS);
    expect(s.schedule()).toBe(false);
    expect(s.exhausted).toBe(true);
  });

  it("counts attempts as they are scheduled", () => {
    const { s, fire } = make();
    expect(s.attempt).toBe(0);
    s.schedule();
    expect(s.attempt).toBe(1);
    fire();
    s.schedule();
    expect(s.attempt).toBe(2);
  });

  it("refuses to stack two timers", () => {
    const { s, pendingTimers } = make();
    s.schedule();
    s.schedule();
    expect(pendingTimers()).toBe(1);
    expect(s.attempt).toBe(1);
  });

  it("cancel drops a pending timer without spending the budget", () => {
    const { s, pendingTimers, retries } = make();
    s.schedule();
    s.cancel();
    expect(pendingTimers()).toBe(0);
    expect(s.pending).toBe(false);
    expect(retries).toHaveLength(0);
  });

  it("reset returns the full budget after a success", () => {
    const { s, fire } = make();
    for (let i = 0; i < RETRY_ATTEMPTS; i++) {
      s.schedule();
      fire();
    }
    expect(s.exhausted).toBe(true);
    s.reset();
    expect(s.exhausted).toBe(false);
    expect(s.attempt).toBe(0);
    expect(s.schedule()).toBe(true);
  });

  it("reset also cancels a timer that is still in flight", () => {
    const { s, pendingTimers, retries } = make();
    s.schedule();
    s.reset();
    expect(pendingTimers()).toBe(0);
    expect(retries).toHaveLength(0);
  });
});
