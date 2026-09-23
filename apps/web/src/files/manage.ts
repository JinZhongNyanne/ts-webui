/**
 * The file browser's changes (M3) over `ts.cmd`: new folder, rename, delete.
 * `cpw` is the channel password in clear (the hub hashes it). Failures are
 * TsCommandErrors with translated messages naming a missing permission
 * (i_ft_needed_directory_create_power, i_ft_needed_file_rename_power,
 * i_ft_needed_file_delete_power).
 *
 * None of these is announced to other clients by the server, so whoever did
 * it lists the folder again; everyone else sees it on their next listing.
 */
import { FT_DELETE_MAX, joinFtPath } from "@jinz/protocol";
import { tsCommand } from "../ts/commands";

const pw = (cpw: string | undefined) => (cpw ? { cpw } : {});

function pathIn(dir: string, name: string): string {
  const path = joinFtPath(dir, name);
  if (!path) throw new Error(`not a valid name: ${name}`);
  return path;
}

/** Creates folder `name` inside `dir`. */
export async function createFolder(
  cid: string,
  dir: string,
  name: string,
  cpw?: string,
): Promise<void> {
  await tsCommand("ftcreatedir", { cid, dirname: pathIn(dir, name), ...pw(cpw) });
}

/**
 * Renames `oldName` in folder `dir` to `newName`. Check the listing first
 * (browser.ts renameProblem): the server replaces a file of that name.
 */
export async function renameEntry(
  cid: string,
  dir: string,
  oldName: string,
  newName: string,
  cpw?: string,
): Promise<void> {
  await tsCommand("ftrenamefile", {
    cid,
    oldname: pathIn(dir, oldName),
    newname: pathIn(dir, newName),
    ...pw(cpw),
  });
}

/**
 * Deletes `names` (files or folders with everything in them) from folder
 * `dir`, FT_DELETE_MAX per command. The server stops at the first path it
 * cannot delete, so list again afterwards to see what went.
 */
export async function deleteEntries(
  cid: string,
  dir: string,
  names: readonly string[],
  cpw?: string,
): Promise<void> {
  const paths = names.map((n) => pathIn(dir, n));
  for (let i = 0; i < paths.length; i += FT_DELETE_MAX) {
    await tsCommand("ftdeletefile", { cid, names: paths.slice(i, i + FT_DELETE_MAX), ...pw(cpw) });
  }
}
