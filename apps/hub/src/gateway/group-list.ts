/**
 * Keeping the server and channel group lists current.
 *
 * The server sends the whole list as one `notifyservergrouplist` (or
 * `notifychannelgrouplist`) command: in the welcome sequence, in answer to
 * `servergrouplist`, and — unasked — to every client whenever a group is
 * added, renamed or deleted (checked on a live TS3 server, for changes made
 * over ServerQuery and by a client). A deleted group is simply missing from
 * the next list, so the first row of each command starts the list over.
 */
import type { TsGroup } from "@jinz/protocol";

/** Folds one list row into `groups`; `first` is true for the first row of its command. */
export function foldGroupRow(groups: Map<string, TsGroup>, row: TsGroup, first: boolean): void {
  if (first) groups.clear();
  groups.set(row.id, row);
}
