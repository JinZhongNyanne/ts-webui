import { describe, expect, it } from "vitest";
import { SessionRegistry, type SessionEnd } from "./registry.js";
import type { Session } from "./Session.js";

function fakeSession(id: string, selfClientId: number | null): Session {
  return {
    id,
    tsSession: selfClientId === null ? null : { selfClientId },
  } as unknown as Session;
}

describe("SessionRegistry asset tokens", () => {
  it("resolves a token to its session only while that session is TS-connected", () => {
    const registry = new SessionRegistry();
    const idle = fakeSession("idle", null);
    const joining = fakeSession("joining", 0);
    const live = fakeSession("live", 7);
    for (const s of [idle, joining, live]) registry.add(s);

    expect(
      registry.getConnectedByAssetToken(registry.mintAssetToken("idle").token),
    ).toBeUndefined();
    expect(
      registry.getConnectedByAssetToken(registry.mintAssetToken("joining").token),
    ).toBeUndefined();
    expect(registry.getConnectedByAssetToken(registry.mintAssetToken("live").token)).toBe(live);
    expect(registry.getConnectedByAssetToken(undefined)).toBeUndefined();
  });

  it("revokes a session's tokens when it is removed", () => {
    const registry = new SessionRegistry();
    const live = fakeSession("live", 7);
    registry.add(live);
    const { token } = registry.mintAssetToken("live");
    registry.remove("live");
    registry.add(live);
    expect(registry.getConnectedByAssetToken(token)).toBeUndefined();
  });
});

describe("SessionRegistry end notices", () => {
  it("tells its listeners when a session is removed, and when its connection closes", () => {
    const registry = new SessionRegistry();
    const heard: SessionEnd[] = [];
    registry.onEnd((end) => heard.push(end));
    const connection = {};
    registry.add(fakeSession("live", 7));
    registry.connectionClosed("live", connection);
    registry.remove("live");
    expect(heard).toEqual([
      { sessionId: "live", connection },
      { sessionId: "live", connection: null },
    ]);
    expect(heard[0]!.connection).toBe(connection);
  });

  it("stops telling a listener that unsubscribed", () => {
    const registry = new SessionRegistry();
    const heard: SessionEnd[] = [];
    const unsubscribe = registry.onEnd((end) => heard.push(end));
    unsubscribe();
    registry.remove("gone");
    expect(heard).toEqual([]);
  });

  it("tells every listener even when one of them throws", () => {
    const reported: unknown[] = [];
    const registry = new SessionRegistry(undefined, (err) => reported.push(err));
    const heard: string[] = [];
    const boom = new Error("boom");
    registry.onEnd(() => {
      throw boom;
    });
    registry.onEnd((end) => heard.push(end.sessionId));
    expect(() => registry.remove("a")).not.toThrow();
    expect(heard).toEqual(["a"]);
    expect(reported).toEqual([boom]);
  });
});
