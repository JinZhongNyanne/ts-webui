import { describe, expect, it } from "vitest";
import {
  categoryLabel,
  explainOverview,
  parseCatalog,
  parseOverview,
  resolvePermission,
  SOURCE,
  type PermSourceRow,
} from "./perm-overview";

// As the hub answers `permissionlist`: permissions, then the category ends.
const CATALOG_ROWS = [
  { permid: "1", permname: "b_virtualserver_modify_name", permdesc: "Modify name" },
  { permid: "2", permname: "b_virtualserver_modify_welcomemessage", permdesc: "Welcome" },
  { permid: "3", permname: "i_client_talk_power", permdesc: "Talk power" },
  { permid: "4", permname: "i_client_needed_talk_power", permdesc: "Needed talk power" },
  { permid: "5", permname: "b_client_ban_create", permdesc: "Ban" },
  { group_id_end: "0" },
  { group_id_end: "2" },
  { group_id_end: "2" },
  { group_id_end: "4" },
];

// As notifypermoverview delivered it (the first row also names the target).
const OVERVIEW_ROWS = [
  { cldbid: "4404", cid: "1", t: "0", id1: "7", id2: "0", p: "3", v: "25", n: "0", s: "0" },
  { t: "0", id1: "6", id2: "0", p: "3", v: "75", n: "0", s: "0" },
  { t: "3", id1: "5", id2: "1", p: "3", v: "50", n: "0", s: "0" },
  { t: "0", id1: "6", id2: "0", p: "1", v: "1", n: "0", s: "0" },
  { t: "0", id1: "6", id2: "0", p: "9", v: "1", n: "0", s: "0" },
  { t: "x", p: "3" },
];

const row = (kind: number, value: number, flags: Partial<PermSourceRow> = {}): PermSourceRow => ({
  kind,
  id1: "1",
  id2: "0",
  permId: 3,
  value,
  negated: false,
  skip: false,
  ...flags,
});

describe("parseCatalog", () => {
  it("reads permissions and category ends", () => {
    const c = parseCatalog(CATALOG_ROWS);
    expect(c.entries).toHaveLength(5);
    expect(c.byId.get(3)?.name).toBe("i_client_talk_power");
    expect(c.groupEnds).toEqual([0, 2, 2, 4]);
  });
});

describe("parseOverview", () => {
  it("reads one source per row and drops rows it cannot read", () => {
    const sources = parseOverview(OVERVIEW_ROWS);
    expect(sources).toHaveLength(5);
    expect(sources[0]).toEqual({
      kind: SOURCE.serverGroup,
      id1: "7",
      id2: "0",
      permId: 3,
      value: 25,
      negated: false,
      skip: false,
    });
    expect(sources[2]).toMatchObject({ kind: SOURCE.channelGroup, id1: "5", id2: "1" });
  });
});

describe("resolvePermission (TeamSpeak's order, simplified)", () => {
  it("takes the highest server group value", () => {
    const r = resolvePermission([row(0, 25), row(0, 75)]);
    expect(r).toEqual({ value: 75, decisive: 1 });
  });

  it("takes the lowest negated server group value instead, when there is one", () => {
    expect(resolvePermission([row(0, 75), row(0, 10, { negated: true }), row(0, 20)])).toEqual({
      value: 10,
      decisive: 1,
    });
  });

  it("lets client, channel, channel group and channel client permissions override in turn", () => {
    expect(resolvePermission([row(0, 75), row(1, 5)]).value).toBe(5);
    expect(resolvePermission([row(0, 75), row(3, 50), row(1, 5)])).toEqual({
      value: 50,
      decisive: 1,
    });
    expect(resolvePermission([row(4, 1), row(3, 50), row(2, 9), row(0, 75)])).toEqual({
      value: 1,
      decisive: 0,
    });
  });

  it("stops the channel and the channel group overriding a server group or client value with skip", () => {
    expect(resolvePermission([row(0, 75, { skip: true }), row(3, 50)])).toEqual({
      value: 75,
      decisive: 0,
    });
    expect(resolvePermission([row(0, 75, { skip: true }), row(2, 9), row(3, 50)])).toEqual({
      value: 75,
      decisive: 0,
    });
    expect(resolvePermission([row(0, 75), row(1, 60, { skip: true }), row(2, 9)])).toEqual({
      value: 60,
      decisive: 1,
    });
  });

  it("still lets the client's own permission in the channel override a skipped value", () => {
    // permissiondoc.txt: skip shields tiers 1 and 2 from tiers 3 and 4 only.
    expect(resolvePermission([row(0, 75), row(1, 60, { skip: true }), row(4, 1)])).toEqual({
      value: 1,
      decisive: 2,
    });
    expect(
      resolvePermission([row(0, 75, { skip: true }), row(2, 9), row(3, 50), row(4, 1)]),
    ).toEqual({ value: 1, decisive: 3 });
  });

  it("has no value without sources", () => {
    expect(resolvePermission([])).toEqual({ value: null, decisive: null });
  });
});

describe("categoryLabel", () => {
  it("names a category by what its permissions share", () => {
    expect(
      categoryLabel(["b_virtualserver_modify_name", "b_virtualserver_modify_welcomemessage"]),
    ).toBe("virtualserver modify");
    expect(categoryLabel(["i_client_talk_power", "i_client_needed_talk_power"])).toBe("client");
    expect(categoryLabel(["b_a_x", "i_b_y"])).toBe("a");
    expect(categoryLabel([])).toBe("");
  });
});

describe("explainOverview", () => {
  const catalog = parseCatalog(CATALOG_ROWS);
  const sources = parseOverview(OVERVIEW_ROWS);

  it("groups the permissions that have sources by category, in catalog order", () => {
    const cats = explainOverview(catalog, sources, "");
    expect(cats.map((c) => c.perms.map((p) => p.name))).toEqual([
      ["b_virtualserver_modify_name"],
      ["i_client_talk_power"],
      ["#9"],
    ]);
    const talk = cats[1]!.perms[0]!;
    expect(talk.value).toBe(50);
    expect(talk.sources.map((s) => [s.kind, s.decisive])).toEqual([
      [SOURCE.serverGroup, false],
      [SOURCE.serverGroup, false],
      [SOURCE.channelGroup, true],
    ]);
  });

  it("filters by name or description", () => {
    const cats = explainOverview(catalog, sources, " TALK ");
    expect(cats.flatMap((c) => c.perms.map((p) => p.name))).toEqual(["i_client_talk_power"]);
    expect(explainOverview(catalog, sources, "modify name")).toHaveLength(1);
  });
});
