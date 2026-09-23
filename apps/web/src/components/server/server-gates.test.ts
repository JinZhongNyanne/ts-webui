import { describe, expect, it } from "vitest";
import { SERVER_PERM, serverGates } from "./server-gates";

function source(granted: Record<string, number>, loaded = true) {
  return {
    loaded,
    has: (n: string) => (granted[n] ?? 0) >= 1 || granted[n] === -1,
    mayUse: (n: string) => !loaded || !(n in granted) || (granted[n] ?? 0) >= 1,
  };
}

describe("serverGates", () => {
  it("offers nothing but redeeming a key to a plain user", () => {
    const g = serverGates(
      source({ b_virtualserver_servergroup_list: 1, b_virtualserver_token_use: 1 }),
    );
    expect(g.redeemKey()).toBe(true);
    expect(serverGates(source({})).redeemKey()).toBe(false);
    expect(g.privilegeKeys()).toBe(false);
    expect(g.groups()).toBe(false);
    expect(g.editServer()).toBe(false);
    expect(g.serverLog()).toBe(false);
    expect(g.connectionInfo()).toBe(false);
    expect(g.permOverview(true)).toBe(false);
    expect(g.permOverview(false)).toBe(false);
  });

  it("offers everything before the permissions have arrived (the server has the last word)", () => {
    const g = serverGates(source({}, false));
    expect(g.privilegeKeys()).toBe(true);
    expect(g.editServer()).toBe(true);
    expect(g.editField("virtualserver_name")).toBe(true);
  });

  it("opens each window on the flag a live Server Admin's set carried", () => {
    const g = serverGates(
      source({
        [SERVER_PERM.tokenList]: 1,
        [SERVER_PERM.logView]: 1,
        [SERVER_PERM.connectionInfo]: 1,
        [SERVER_PERM.serverGroupList]: 1,
        [SERVER_PERM.serverGroupCreate]: 1,
        [SERVER_PERM.overviewOwn]: 1,
        b_virtualserver_modify_name: 1,
      }),
    );
    expect(g.privilegeKeys()).toBe(true);
    expect(g.addKey()).toBe(false);
    expect(g.serverLog()).toBe(true);
    expect(g.connectionInfo()).toBe(true);
    expect(g.groups()).toBe(true);
    expect(g.createServerGroup()).toBe(true);
    expect(g.createChannelGroup()).toBe(false);
    expect(g.permOverview(true)).toBe(true);
    expect(g.permOverview(false)).toBe(false);
    expect(g.editServer()).toBe(true);
    expect(g.editField("virtualserver_name")).toBe(true);
    expect(g.editField("virtualserver_welcomemessage")).toBe(false);
  });

  it("maps every editable field to the permission that guards it", () => {
    const g = serverGates(source({ b_virtualserver_modify_hostbanner: 1 }));
    expect(g.editField("virtualserver_hostbanner_url")).toBe(true);
    expect(g.editField("virtualserver_hostbanner_gfx_url")).toBe(true);
    expect(g.editField("virtualserver_hostbutton_url")).toBe(false);
  });
});
