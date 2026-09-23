import { describe, expect, it } from "vitest";
import { channelDeleteImpact, channelPerms, type PermSource } from "./channel-perms";
import { mayUse, permHas } from "./perms";

function source(values: Record<string, number>, loaded = true): PermSource {
  return {
    loaded,
    has: (n, min = 1) => permHas(values, n, min),
    mayUse: (n, min = 1) => mayUse(values, loaded, n, min),
    value: (n) => values[n] ?? 0,
  };
}

describe("channelPerms", () => {
  it("offers everything until the permission set is in", () => {
    const p = channelPerms(source({}, false));
    expect(p.createTypes()).toEqual(["permanent", "semi", "temporary"]);
    expect(p.canCreateChild()).toBe(true);
    expect(p.canEdit()).toBe(true);
    expect(p.canDelete("semi")).toBe(true);
    expect(p.canMove()).toBe(true);
  });

  it("a guest (no flags) gets nothing", () => {
    const p = channelPerms(source({ i_client_talk_power: 1 }));
    expect(p.createTypes()).toEqual([]);
    expect(p.canCreateTop()).toBe(false);
    expect(p.canCreateChild()).toBe(false);
    expect(p.canEdit()).toBe(false);
    expect(p.canDelete("temporary")).toBe(false);
    expect(p.canMove()).toBe(false);
  });

  it("follows the flags a server admin has", () => {
    const p = channelPerms(
      source({
        b_channel_create_child: 1,
        b_channel_create_semi_permanent: 1,
        b_channel_create_temporary: 1,
        b_channel_modify_name: 1,
        b_channel_modify_sortorder: 1,
        b_channel_delete_semi_permanent: 1,
        i_channel_create_modify_with_codec_maxquality: 7,
        i_channel_create_modify_with_temp_delete_delay: 600,
      }),
    );
    expect(p.createTypes()).toEqual(["semi", "temporary"]);
    expect(p.canCreateChild()).toBe(true);
    expect(p.canEdit()).toBe(true);
    expect(p.canDelete("semi")).toBe(true);
    expect(p.canDelete("permanent")).toBe(false);
    expect(p.canMove()).toBe(true);
    expect(p.maxQuality()).toBe(7);
    expect(p.maxDeleteDelay()).toBe(600);
  });

  it("a known power of 0 hides edit, move and delete", () => {
    const p = channelPerms(
      source({
        b_channel_modify_name: 1,
        b_channel_modify_sortorder: 1,
        b_channel_delete_temporary: 1,
        i_channel_modify_power: 0,
        i_channel_delete_power: 0,
      }),
    );
    expect(p.canEdit()).toBe(false);
    expect(p.canMove()).toBe(false);
    expect(p.canDelete("temporary")).toBe(false);
  });

  it("unknown limits are unlimited", () => {
    const p = channelPerms(source({}, false));
    expect(p.maxQuality()).toBe(10);
    expect(p.maxDeleteDelay()).toBe(-1);
    // Loaded, but the server never reported it.
    expect(channelPerms(source({})).maxDeleteDelay()).toBe(-1);
  });

  it("a known delete delay of 0 means none, not unlimited", () => {
    const delay = (v: number) =>
      channelPerms(source({ i_channel_create_modify_with_temp_delete_delay: v })).maxDeleteDelay();
    expect(delay(0)).toBe(0);
    expect(delay(-1)).toBe(-1);
    expect(delay(30)).toBe(30);
  });
});

describe("channelDeleteImpact", () => {
  const ch = (id: string, parentId: string) => ({ id, parentId });
  const channels = [ch("1", "0"), ch("2", "1"), ch("3", "2"), ch("4", "0")];
  it("counts subchannels and clients in the whole subtree", () => {
    const clients = [{ channelId: "1" }, { channelId: "3" }, { channelId: "4" }];
    expect(channelDeleteImpact(channels, clients, "1")).toEqual({
      subchannels: 2,
      clients: 2,
      needsForce: true,
    });
    expect(channelDeleteImpact(channels, clients, "4")).toEqual({
      subchannels: 0,
      clients: 1,
      needsForce: true,
    });
    expect(channelDeleteImpact(channels, [], "4")).toEqual({
      subchannels: 0,
      clients: 0,
      needsForce: false,
    });
  });
});
