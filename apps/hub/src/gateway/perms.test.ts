import { afterEach, describe, expect, it } from "vitest";
import { parseCommandLines } from "./raw.js";
import {
  catalogRows,
  clearCatalogCache,
  getCachedCatalog,
  parsePermissionList,
  setCachedCatalog,
} from "./perms.js";

/** Shaped like the real answer from a TS3 server (see perms.ts). */
const PERMISSION_LIST_WIRE =
  "notifypermissionlist group_id_end=0|group_id_end=2|permname=b_serverinstance_help_view permdesc=Retrieve\\sinformation|permname=b_serverinstance_info_view permdesc=View|permname=i_client_kick_from_server_power permdesc=Kick";

const rows = () => parseCommandLines(PERMISSION_LIST_WIRE).map((r) => r.params);

afterEach(() => clearCatalogCache());

describe("parsePermissionList", () => {
  it("numbers permissions by their position and keeps the category ends", () => {
    const c = parsePermissionList(rows());
    expect(c.groupEnds).toEqual([0, 2]);
    expect(c.byId.get(1)).toBe("b_serverinstance_help_view");
    expect(c.byId.get(3)).toBe("i_client_kick_from_server_power");
    expect(c.entries[0]!.desc).toBe("Retrieve information");
  });

  it("prefers an explicit permid when a server sends one", () => {
    const c = parsePermissionList([{ permname: "a", permid: "10" }, { permname: "b" }]);
    expect(c.byId.get(10)).toBe("a");
    expect(c.byId.get(11)).toBe("b");
  });

  it("renders as rows with ids for the browser", () => {
    expect(catalogRows(parsePermissionList(rows()))[2]).toEqual({
      permid: "3",
      permname: "i_client_kick_from_server_power",
      permdesc: "Kick",
    });
  });
});

describe("catalog cache", () => {
  it("expires entries", () => {
    const c = parsePermissionList(rows());
    setCachedCatalog("h:1", c, 0);
    expect(getCachedCatalog("h:1", 1000)).toBe(c);
    expect(getCachedCatalog("h:1", 7 * 60 * 60 * 1000)).toBeUndefined();
  });
});
