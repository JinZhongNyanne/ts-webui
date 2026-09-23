/**
 * Channel file listing (M3) over the allow-listed `ts.cmd` channel. `cpw` is
 * the channel password in clear (the hub hashes it); failures are
 * TsCommandErrors with translated messages (ts/commands.ts), e.g. 781 for a
 * wrong password or 2568 naming i_ft_needed_file_browse_power.
 *
 * Uploads and downloads are HTTP streams instead: see http.ts, and the
 * transfers store (stores/transfers.ts) which queues them.
 */
import type { FtEntry } from "@jinz/protocol";
import { tsCommand } from "../ts/commands";
import { parseFileInfo, parseFileList, type FtFileInfo } from "./file-list";

/** The entries of folder `path` (`/` is the channel's root), folders first. */
export async function listFiles(cid: string, path = "/", cpw?: string): Promise<FtEntry[]> {
  const rows = await tsCommand("ftgetfilelist", { cid, path, ...(cpw ? { cpw } : {}) });
  return parseFileList(rows);
}

/** One file's size and date; null when the server answered without a row. */
export async function getFileInfo(
  cid: string,
  path: string,
  cpw?: string,
): Promise<FtFileInfo | null> {
  const rows = await tsCommand("ftgetfileinfo", { cid, name: path, ...(cpw ? { cpw } : {}) });
  return parseFileInfo(rows);
}
