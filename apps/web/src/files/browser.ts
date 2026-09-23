/**
 * The file browser's plain logic (M3): the table's order, the breadcrumb, and
 * the name checks made against the listing before a command is sent.
 *
 * The listing is the only place a clash shows up in time: TeamSpeak refuses
 * an upload onto an existing name (2050) but silently replaces the other file
 * on a rename (seen on a live 3.13 server), so both are checked here first.
 */
import { isFtName, normalizeFtPath, sanitizeFtFileName, type FtEntry } from "@jinz/protocol";

export type SortKey = "name" | "size" | "datetime";

export interface SortOrder {
  readonly key: SortKey;
  readonly dir: "asc" | "desc";
}

export const DEFAULT_SORT: SortOrder = { key: "name", dir: "asc" };

const byName = (a: FtEntry, b: FtEntry) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

/**
 * A sorted copy: folders first whatever the order, then by `order.key` (ties
 * by name). Folders have no size, so a size order keeps them A to Z.
 */
export function sortEntries(entries: readonly FtEntry[], order: SortOrder): FtEntry[] {
  const sign = order.dir === "asc" ? 1 : -1;
  const compare = (a: FtEntry, b: FtEntry): number => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    if (order.key === "name") return sign * byName(a, b);
    if (order.key === "size" && a.isDir) return byName(a, b);
    const diff = order.key === "size" ? a.size - b.size : a.datetime - b.datetime;
    return diff !== 0 ? sign * diff : byName(a, b);
  };
  return [...entries].sort(compare);
}

/** A click on column `key`: the same column flips; a new one starts where it is most useful. */
export function nextSort(current: SortOrder, key: SortKey): SortOrder {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "name" ? "asc" : "desc" };
}

export interface Crumb {
  /** The folder's name; "" for the channel's root. */
  readonly name: string;
  readonly path: string;
}

/** The root and then one crumb per folder of `path`; just the root for a path that is not valid. */
export function breadcrumbs(path: string): Crumb[] {
  const clean = normalizeFtPath(path) ?? "/";
  const parts = clean.split("/").filter(Boolean);
  return [
    { name: "", path: "/" },
    ...parts.map((name, i) => ({ name, path: `/${parts.slice(0, i + 1).join("/")}` })),
  ];
}

/** Why an upload cannot simply go ahead: the name is a file (ask), a folder or unusable (skip). */
export type UploadConflict = "file" | "folder" | "invalid" | "duplicate" | null;

export interface UploadPlan {
  /** Position in the list of files given. */
  readonly index: number;
  /** The name it will be stored under (what the transfers store makes of it). */
  readonly name: string;
  readonly conflict: UploadConflict;
}

/** Checks each file to upload against the folder's listing (and the other files dropped with it). */
export function planUploads(
  listing: readonly FtEntry[],
  files: readonly { readonly name: string }[],
): UploadPlan[] {
  const existing = new Map(listing.map((e) => [e.name, e]));
  const seen = new Set<string>();
  return files.map((f, index) => {
    const name = sanitizeFtFileName(f.name);
    if (!name) return { index, name: f.name, conflict: "invalid" };
    const hit = existing.get(name);
    const conflict: UploadConflict = seen.has(name)
      ? "duplicate"
      : hit
        ? hit.isDir
          ? "folder"
          : "file"
        : null;
    seen.add(name);
    return { index, name, conflict };
  });
}

export type NameProblem = "invalid" | "exists" | "unchanged";

/** What is wrong with renaming `oldName` to `newName` in this folder, or null. */
export function renameProblem(
  listing: readonly FtEntry[],
  oldName: string,
  newName: string,
): NameProblem | null {
  const name = newName.trim();
  if (name === oldName) return "unchanged";
  if (!isFtName(name)) return "invalid";
  return listing.some((e) => e.name === name) ? "exists" : null;
}

/** What is wrong with a new folder called `name` here, or null. */
export function folderNameProblem(listing: readonly FtEntry[], name: string): NameProblem | null {
  const clean = name.trim();
  if (!isFtName(clean)) return "invalid";
  return listing.some((e) => e.name === clean) ? "exists" : null;
}
