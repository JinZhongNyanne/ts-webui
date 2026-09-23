import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, defineStore, setActivePinia } from "pinia";
import type { ServerMessage } from "@jinz/protocol";
import type { HubState } from "../ts/connection";
import { applyPerms, mayUse, permHas, powerCovers } from "../ts/perms";
import { createPermsStore } from "./perms";

function fakeSource() {
  const msg = new Set<(m: ServerMessage) => void>();
  const st = new Set<(s: HubState) => void>();
  return {
    source: {
      onMessage: (fn: (m: ServerMessage) => void) => {
        msg.add(fn);
        return () => msg.delete(fn);
      },
      onState: (fn: (s: HubState) => void) => {
        st.add(fn);
        return () => st.delete(fn);
      },
    },
    deliver: (m: ServerMessage) => msg.forEach((l) => l(m)),
    setState: (s: HubState) => st.forEach((l) => l(s)),
  };
}

let n = 0;
function makeStore() {
  const hub = fakeSource();
  // A fresh store id per test, so each one binds to its own fake hub.
  const store = defineStore(`perms-test-${n++}`, createPermsStore(hub.source))();
  return { store, ...hub };
}

beforeEach(() => setActivePinia(createPinia()));

describe("perm value rules", () => {
  it("replaces on a full set and merges a patch", () => {
    const a = applyPerms({}, { type: "perms", full: true, values: { x: 1, y: 2 } });
    const b = applyPerms(a, { type: "perms", full: false, values: { y: 5 } });
    expect(b).toEqual({ x: 1, y: 5 });
    expect(a).toEqual({ x: 1, y: 2 });
    expect(applyPerms(b, { type: "perms", full: true, values: { z: 1 } })).toEqual({ z: 1 });
  });

  it("reads missing as not granted and -1 as unlimited", () => {
    const v = { b_flag: 1, i_limit: -1, i_power: 50 };
    expect(permHas(v, "b_flag")).toBe(true);
    expect(permHas(v, "b_missing")).toBe(false);
    expect(permHas(v, "i_limit", 1000)).toBe(true);
    expect(permHas(v, "i_power", 75)).toBe(false);
  });

  it("offers an action while its permission is unknown, hides it once known to be missing", () => {
    expect(mayUse({}, false, "i_client_kick_from_server_power")).toBe(true);
    expect(mayUse({ b_x: 1 }, true, "i_client_kick_from_server_power")).toBe(true);
    expect(
      mayUse({ i_client_kick_from_server_power: 0 }, true, "i_client_kick_from_server_power"),
    ).toBe(false);
    expect(
      mayUse({ i_client_kick_from_server_power: 75 }, true, "i_client_kick_from_server_power"),
    ).toBe(true);
    expect(
      mayUse({ i_client_kick_from_server_power: -1 }, true, "i_client_kick_from_server_power"),
    ).toBe(true);
  });

  it("compares power with needed power the way the server does", () => {
    expect(powerCovers(75, 50)).toBe(true);
    expect(powerCovers(50, 50)).toBe(true);
    expect(powerCovers(40, 50)).toBe(false);
    expect(powerCovers(0, 0)).toBe(false);
    expect(powerCovers(-1, 100)).toBe(true);
  });
});

describe("perms store", () => {
  it("fills from the full set, merges patches and answers checks", () => {
    const { store, deliver } = makeStore();
    expect(store.loaded).toBe(false);
    expect(store.has("b_client_ban_create")).toBe(false);
    deliver({
      type: "perms",
      full: true,
      values: { b_client_ban_create: 1, i_client_kick_from_server_power: 50 },
    });
    expect(store.loaded).toBe(true);
    expect(store.has("b_client_ban_create")).toBe(true);
    expect(store.value("i_client_kick_from_server_power")).toBe(50);
    expect(store.covers("i_client_kick_from_server_power", 75)).toBe(false);
    deliver({ type: "perms", full: false, values: { i_client_kick_from_server_power: 75 } });
    expect(store.covers("i_client_kick_from_server_power", 75)).toBe(true);
    expect(store.has("b_client_ban_create")).toBe(true);
  });

  it("ignores a patch that arrives before any full set", () => {
    const { store, deliver } = makeStore();
    deliver({ type: "perms", full: false, values: { b_x: 1 } });
    expect(store.loaded).toBe(false);
    expect(store.has("b_x")).toBe(false);
  });

  it("forgets everything on disconnect, a fatal error or a lost hub link", () => {
    const { store, deliver, setState } = makeStore();
    const full = { type: "perms", full: true, values: { b_x: 1 } } as const;
    deliver(full);
    deliver({ type: "disconnected", reason: "hub.byeUser", byUser: true });
    expect(store.has("b_x")).toBe(false);

    deliver(full);
    deliver({ type: "error", code: "kicked", message: "bye", fatal: true });
    expect(store.loaded).toBe(false);

    deliver(full);
    deliver({ type: "error", code: "rate_limited", message: "hub.rateLimited" });
    expect(store.loaded).toBe(true);
    setState("closed");
    expect(store.loaded).toBe(false);
  });
});
