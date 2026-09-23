import { afterEach, describe, expect, it, vi } from "vitest";
import type { PermsMessage, TsCmdRow } from "@jinz/protocol";
import { parsePermissionList, type PermCatalog } from "./perms.js";
import { OwnPermissions, PERM_OVERVIEW_OWN } from "./own-perms.js";

/** ids 1..4 in list order, like a real server numbers them. */
const catalog = parsePermissionList([
  { group_id_end: "0" },
  { permname: "b_serverinstance_help_view" },
  { permname: "b_client_ban_create" },
  { permname: PERM_OVERVIEW_OWN },
  { permname: "i_client_kick_from_server_power" },
]);

afterEach(() => vi.useRealTimers());

function tracker(
  opts: {
    load?: () => Promise<PermCatalog>;
    permget?: (names: readonly string[]) => Promise<TsCmdRow[]>;
  } = {},
) {
  const sent: PermsMessage[] = [];
  const errors: unknown[] = [];
  const load = vi.fn(opts.load ?? (async () => catalog));
  const t = new OwnPermissions({
    catalog: load,
    permget: opts.permget,
    emit: (m) => sent.push(m),
    onError: (e) => errors.push(e),
  });
  return { t, sent, errors, load };
}

describe("OwnPermissions", () => {
  it("holds everything until started, then sends the full set by name", async () => {
    const { t, sent, load } = tracker();
    t.add(1, 1);
    t.add(2, 1);
    t.add(99, 5); // unknown to the catalog: dropped
    await t.flush();
    expect(sent).toHaveLength(0);
    expect(load).not.toHaveBeenCalled();
    t.start();
    await t.flush();
    expect(sent).toEqual([
      {
        type: "perms",
        full: true,
        values: { b_serverinstance_help_view: 1, b_client_ban_create: 1 },
      },
    ]);
  });

  it("sends only what changed afterwards", async () => {
    const { t, sent } = tracker();
    t.add(1, 1);
    t.start();
    await t.flush();
    t.add(2, 1);
    await t.flush();
    await t.flush(); // nothing new: nothing sent
    expect(sent[1]).toEqual({ type: "perms", full: false, values: { b_client_ban_create: 1 } });
    expect(sent).toHaveLength(2);
  });

  it("coalesces a burst of rows into one message", async () => {
    vi.useFakeTimers();
    const { t, sent } = tracker();
    t.start();
    t.add(1, 1);
    t.add(2, 1);
    t.add(3, 0);
    await vi.advanceTimersByTimeAsync(100);
    expect(sent).toHaveLength(1);
    expect(Object.keys(sent[0]!.values)).toHaveLength(3);
  });

  it("asks for the powers only when the server allows permget", async () => {
    const permget = vi.fn(async (names: readonly string[]) =>
      names.map((n) => ({ permsid: n, permvalue: "75" })),
    );
    const denied = tracker({ permget });
    denied.t.add(1, 1);
    denied.t.start();
    await denied.t.flush();
    expect(permget).not.toHaveBeenCalled();

    const allowed = tracker({ permget });
    allowed.t.add(3, 1);
    allowed.t.start();
    await allowed.t.flush();
    // Only names this server knows are asked for.
    expect(permget).toHaveBeenCalledWith(["i_client_kick_from_server_power"]);
    expect(allowed.sent[0]!.values).toEqual({
      [PERM_OVERVIEW_OWN]: 1,
      i_client_kick_from_server_power: 75,
    });
  });

  it("re-reads the powers with every later batch and sends the ones that moved", async () => {
    let kick = "50";
    const { t, sent } = tracker({
      permget: async () => [{ permsid: "i_client_kick_from_server_power", permvalue: kick }],
    });
    t.add(3, 1);
    t.start();
    await t.flush();
    kick = "75";
    t.add(2, 1); // e.g. we were just added to a group
    await t.flush();
    expect(sent[1]).toEqual({
      type: "perms",
      full: false,
      values: { b_client_ban_create: 1, i_client_kick_from_server_power: 75 },
    });
  });

  it("re-reads the powers when told our groups changed, even with no batch to go with it", async () => {
    // Seen live: joining a group that only grants a power (i_client_whisper_power)
    // changes none of the flags the notify carries, so no batch comes at all.
    let kick = "0";
    const { t, sent } = tracker({
      permget: async () => [{ permsid: "i_client_kick_from_server_power", permvalue: kick }],
    });
    t.add(3, 1);
    t.start();
    await t.flush();
    kick = "50";
    await t.flush();
    expect(sent).toHaveLength(1);
    t.refreshPowers();
    await t.flush();
    expect(sent[1]).toEqual({
      type: "perms",
      full: false,
      values: { i_client_kick_from_server_power: 50 },
    });
    // Asked once: nothing is re-read until the groups change again.
    await t.flush();
    expect(sent).toHaveLength(2);
  });

  it("does not ask for the powers early when told of a group change before starting", async () => {
    const permget = vi.fn(async () => []);
    const { t, sent } = tracker({ permget });
    t.refreshPowers();
    await t.flush();
    expect(permget).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("still sends the flags when permget fails", async () => {
    const { t, sent, errors } = tracker({
      permget: async () => {
        throw new Error("2568");
      },
    });
    t.add(3, 1);
    t.start();
    await t.flush();
    expect(errors).toHaveLength(1);
    expect(sent[0]!.values).toEqual({ [PERM_OVERVIEW_OWN]: 1 });
  });

  it("reports a catalog failure and sends the full set once it works", async () => {
    let fail = true;
    const { t, sent, errors } = tracker({
      load: async () => {
        if (fail) throw new Error("refused");
        return catalog;
      },
    });
    t.add(1, 1);
    t.start();
    await t.flush();
    expect(errors).toHaveLength(1);
    expect(sent).toHaveLength(0);
    fail = false;
    t.add(2, 1);
    await t.flush();
    expect(sent[0]).toMatchObject({ full: true });
    expect(Object.keys(sent[0]!.values)).toHaveLength(2);
  });

  it("forgets everything on reset", async () => {
    const { t, sent } = tracker();
    t.add(1, 1);
    t.start();
    await t.flush();
    t.reset();
    t.add(2, 1);
    t.start();
    await t.flush();
    expect(sent[1]).toEqual({ type: "perms", full: true, values: { b_client_ban_create: 1 } });
  });
});
