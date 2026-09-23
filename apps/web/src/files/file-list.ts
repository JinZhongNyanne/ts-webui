/** Reading the answers of the file commands (`ftgetfilelist`, `ftgetfileinfo`). */
import { ftNameOf, type FtEntry, type TsCmdRow } from "@jinz/protocol";

const num = (v: string | undefined) => {
  const n = Number(v ?? "");
  return Number.isFinite(n) ? n : 0;
};

/**
 * `notifyfilelist` rows as entries, folders first and then by name. A live
 * TS3 server sends name, size, datetime and type (0 folder, 1 file) per row;
 * only the first row also carries cid and path.
 */
export function parseFileList(rows: readonly TsCmdRow[]): FtEntry[] {
  return rows
    .filter((r) => !!r["name"])
    .map((r) => ({
      name: r["name"]!,
      size: num(r["size"]),
      datetime: num(r["datetime"]),
      isDir: r["type"] === "0",
    }))
    .sort((a, b) =>
      a.isDir === b.isDir
        ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        : a.isDir
          ? -1
          : 1,
    );
}

export interface FtFileInfo {
  path: string;
  name: string;
  size: number;
  datetime: number;
}

/** The one `notifyfileinfo` row (its `name` is the whole path); null when there is none. */
export function parseFileInfo(rows: readonly TsCmdRow[]): FtFileInfo | null {
  const row = rows[0];
  const path = row?.["name"];
  if (!path) return null;
  return { path, name: ftNameOf(path), size: num(row["size"]), datetime: num(row["datetime"]) };
}
