import { describe, expect, it } from "vitest";
import { adminGates, PERM } from "./admin-perms";
import { mayUse, permHas, type PermValues } from "./perms";

const gates = (values: PermValues, loaded = true) =>
  adminGates({
    loaded,
    has: (n) => permHas(values, n),
    mayUse: (n) => mayUse(values, loaded, n),
  });

describe("admin gates", () => {
  it("offers everything before the permission set arrives", () => {
    const g = gates({}, false);
    expect(g.complain()).toBe(true);
    expect(g.complaintList()).toBe(true);
    expect(g.sendOffline()).toBe(true);
    expect(g.clientDb()).toBe(true);
    expect(g.tempPasswords()).toBe(true);
  });

  it("hides the windows from a guest once the set is in", () => {
    // What a guest's notifyclientneededpermissions held on the test server.
    const g = gates({ b_channel_create_temporary: 1 });
    expect(g.complaintList()).toBe(false);
    expect(g.sendOffline()).toBe(false);
    expect(g.clientDb()).toBe(false);
    expect(g.tempPasswords()).toBe(false);
    // Powers are unknown without permget: offered, the server decides.
    expect(g.complain()).toBe(true);
  });

  it("follows known powers and flags for a Server Admin", () => {
    const g = gates({
      [PERM.complainList]: 1,
      [PERM.offlineSend]: 1,
      [PERM.dbList]: 1,
      [PERM.tempPasswords]: 1,
      [PERM.complainPower]: 75,
      [PERM.complainDelete]: 1,
      [PERM.dbSearch]: 1,
      [PERM.dbInfo]: 1,
      [PERM.dbModify]: 1,
      [PERM.dbDelete]: 0,
      [PERM.tempPasswordsOwn]: 0,
    });
    expect(g.complaintList() && g.sendOffline() && g.clientDb() && g.tempPasswords()).toBe(true);
    expect(g.searchDb()).toBe(true);
    expect(g.editDb()).toBe(true);
    expect(g.deleteDb()).toBe(false);
    expect(g.deleteTempPassword("someone", "me")).toBe(true);
  });

  it("hides complaining when the power is known to be 0", () => {
    expect(gates({ [PERM.complainPower]: 0 }).complain()).toBe(false);
  });

  it("lets _own flags cover only one's own entries", () => {
    const g = gates({
      [PERM.complainList]: 1,
      [PERM.complainDelete]: 0,
      [PERM.complainDeleteOwn]: 1,
      [PERM.tempPasswords]: 0,
      [PERM.tempPasswordsOwn]: 1,
    });
    expect(g.deleteComplaint("5", "5")).toBe(true);
    expect(g.deleteComplaint("6", "5")).toBe(false);
    expect(g.deleteAllComplaints()).toBe(false);
    expect(g.tempPasswords()).toBe(true);
    expect(g.deleteTempPassword("me", "me")).toBe(true);
    expect(g.deleteTempPassword("other", "me")).toBe(false);
  });

  it("does not open the temporary password window on an unknown _own flag", () => {
    expect(gates({ b_channel_create_temporary: 1 }).tempPasswords()).toBe(false);
  });
});
