import { describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, reactive } from "vue";
import type { TsClient } from "@jinz/protocol";
import { matchTarget, useTargetClient } from "./useTargetClient";

const client = (id: number, uid: string, nickname = uid) => ({ id, uid, nickname }) as TsClient;

describe("matchTarget", () => {
  it("finds the client holding the id when its uid still matches", () => {
    const a = client(5, "A");
    expect(matchTarget(new Map([[5, a]]), 5, "A")).toBe(a);
  });

  it("refuses a different client that now holds the same id", () => {
    expect(matchTarget(new Map([[5, client(5, "B")]]), 5, "A")).toBeNull();
  });

  it("is null when nobody holds the id, or the target was unknown at open", () => {
    expect(matchTarget(new Map(), 5, "A")).toBeNull();
    expect(matchTarget(new Map([[5, client(5, "A")]]), 5, null)).toBeNull();
  });
});

describe("useTargetClient", () => {
  function setup(onGone = vi.fn()) {
    const clients = reactive(new Map<number, TsClient>([[5, client(5, "A", "alice")]]));
    const scope = effectScope();
    const target = scope.run(() => useTargetClient(clients, 5, onGone))!;
    return { clients, target, onGone, scope };
  }

  it("follows the target's live state while it stays", async () => {
    const { clients, target, onGone } = setup();
    expect(target.value?.nickname).toBe("alice");
    clients.set(5, client(5, "A", "alice2"));
    await nextTick();
    expect(target.value?.nickname).toBe("alice2");
    expect(onGone).not.toHaveBeenCalled();
  });

  it("reports the target gone when someone else takes over its id", async () => {
    const { clients, target, onGone } = setup();
    clients.delete(5);
    clients.set(5, client(5, "B", "bob"));
    await nextTick();
    expect(target.value).toBeNull();
    expect(onGone).toHaveBeenCalledTimes(1);
  });

  it("stays gone when the target itself comes back with a new id", async () => {
    const { clients, target, onGone } = setup();
    clients.delete(5);
    await nextTick();
    clients.set(7, client(7, "A"));
    await nextTick();
    expect(target.value).toBeNull();
    expect(onGone).toHaveBeenCalledTimes(1);
  });

  it("stops watching with its scope", async () => {
    const { clients, onGone, scope } = setup();
    scope.stop();
    clients.delete(5);
    await nextTick();
    expect(onGone).not.toHaveBeenCalled();
  });
});
