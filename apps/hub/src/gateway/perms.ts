/**
 * Permission awareness: which permissions this TeamSpeak client has, by name.
 *
 * The server tells a client its own effective permissions with
 * `notifyclientneededpermissions` (the whole set after connecting, then only
 * what changed), but by numeric id. The ids are the server's own numbering, so
 * they are resolved through `permissionlist`, whose client-protocol answer
 * (`notifypermissionlist`) carries no ids at all: rows are
 * `group_id_end=N` category markers followed by `permname=… permdesc=…` rows,
 * and a permission's id is its 1-based position among the permname rows.
 * (A row that does carry `permid` wins, in case a server version adds it.)
 *
 * This file is the catalog; own-perms.ts turns ids into the `perms` message.
 */
import type { TsCmdRow } from "@jinz/protocol";

export interface PermEntry {
  id: number;
  name: string;
  desc: string;
}

export interface PermCatalog {
  entries: PermEntry[];
  byId: Map<number, string>;
  /** Last permission id of each category, in order (the permission editor groups by these). */
  groupEnds: number[];
}

export function parsePermissionList(rows: readonly TsCmdRow[]): PermCatalog {
  const entries: PermEntry[] = [];
  const byId = new Map<number, string>();
  const groupEnds: number[] = [];
  let next = 1;
  for (const row of rows) {
    const name = row["permname"];
    if (name) {
      const explicit = Number(row["permid"]);
      const id = Number.isInteger(explicit) && explicit > 0 ? explicit : next;
      next = id + 1;
      entries.push({ id, name, desc: row["permdesc"] ?? "" });
      byId.set(id, name);
    } else if (row["group_id_end"] !== undefined) {
      groupEnds.push(Number(row["group_id_end"]));
    }
  }
  return { entries, byId, groupEnds };
}

/** The catalog as `ts.cmd permissionlist` rows, ids included (the browser has no other way to learn them). */
export function catalogRows(catalog: PermCatalog): TsCmdRow[] {
  return catalog.entries.map((e) => ({
    permid: String(e.id),
    permname: e.name,
    permdesc: e.desc,
  }));
}

/* ------------------------------ hub-wide cache ----------------------------- */

/**
 * The list is ~20 KB and identical for every client of a server, so it is
 * fetched once per server and shared, like the icon cache. It only changes
 * when the server software is upgraded.
 */
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_SERVERS = 64;

const catalogs = new Map<string, { catalog: PermCatalog; expires: number }>();

export function getCachedCatalog(serverKey: string, now = Date.now()): PermCatalog | undefined {
  const hit = catalogs.get(serverKey);
  if (!hit) return undefined;
  if (hit.expires < now) {
    catalogs.delete(serverKey);
    return undefined;
  }
  return hit.catalog;
}

export function setCachedCatalog(serverKey: string, catalog: PermCatalog, now = Date.now()): void {
  if (!catalogs.has(serverKey) && catalogs.size >= MAX_SERVERS) {
    const oldest = catalogs.keys().next();
    if (!oldest.done) catalogs.delete(oldest.value);
  }
  catalogs.set(serverKey, { catalog, expires: now + CATALOG_TTL_MS });
}

/** Test helper. */
export function clearCatalogCache(): void {
  catalogs.clear();
}
