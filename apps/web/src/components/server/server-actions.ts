/**
 * The M4 server administration commands as promise calls over the
 * allow-listed `ts.cmd` channel (ts/commands.ts). Every function rejects with
 * a TsCommandError whose message is translated and ready to show; a 2568
 * names the permission the server wanted ("missing permission
 * b_virtualserver_log_view"). An empty list comes back as `[]`.
 */
import type { TsCmdArgs } from "@jinz/protocol";
import { tsCommand } from "../../ts/commands";
import { parseLogPage, type LogPage } from "../../ts/server-log";
import { parseCatalog, parseOverview, type CatalogView, type PermSourceRow } from "./perm-overview";
import {
  parseConnectionInfo,
  parseGroups,
  parsePrivilegeKeys,
  parseServerVariables,
  type ConnectionInfo,
  type GroupRow,
  type PrivilegeKey,
  type ServerVariables,
} from "./server-rows";

/* -------------------------------------------------------- privilege keys */

export async function redeemPrivilegeKey(token: string): Promise<void> {
  await tsCommand("privilegekeyuse", { token });
}

export async function listPrivilegeKeys(): Promise<PrivilegeKey[]> {
  return parsePrivilegeKeys(await tsCommand("privilegekeylist", {}));
}

/** Answers the new key's token ("" if the server did not say). */
export async function addPrivilegeKey(args: TsCmdArgs<"privilegekeyadd">): Promise<string> {
  const rows = await tsCommand("privilegekeyadd", args);
  return rows[0]?.["token"] ?? "";
}

export async function deletePrivilegeKey(token: string): Promise<void> {
  await tsCommand("privilegekeydelete", { token });
}

/* ----------------------------------------------------------------- groups */

export type GroupKind = "server" | "channel";

export async function listGroups(kind: GroupKind): Promise<GroupRow[]> {
  return kind === "server"
    ? parseGroups(await tsCommand("servergrouplist", {}), "sgid")
    : parseGroups(await tsCommand("channelgrouplist", {}), "cgid");
}

export async function addGroup(kind: GroupKind, name: string): Promise<void> {
  if (kind === "server") await tsCommand("servergroupadd", { name: name.trim() });
  else await tsCommand("channelgroupadd", { name: name.trim() });
}

export async function renameGroup(kind: GroupKind, id: string, name: string): Promise<void> {
  if (kind === "server") await tsCommand("servergrouprename", { sgid: id, name: name.trim() });
  else await tsCommand("channelgrouprename", { cgid: id, name: name.trim() });
}

export async function copyGroup(kind: GroupKind, id: string, name: string): Promise<void> {
  if (kind === "server") await tsCommand("servergroupcopy", { ssgid: id, name: name.trim() });
  else await tsCommand("channelgroupcopy", { scgid: id, name: name.trim() });
}

/** `force` also deletes a group that still has members. */
export async function deleteGroup(kind: GroupKind, id: string, force: boolean): Promise<void> {
  if (kind === "server") await tsCommand("servergroupdel", { sgid: id, force });
  else await tsCommand("channelgroupdel", { cgid: id, force });
}

type GroupDisplayPerm = "i_group_sort_id" | "i_group_show_name_in_tree";

export async function setGroupDisplay(
  kind: GroupKind,
  id: string,
  permsid: GroupDisplayPerm,
  permvalue: number,
): Promise<void> {
  if (kind === "server") await tsCommand("servergroupaddperm", { sgid: id, permsid, permvalue });
  else await tsCommand("channelgroupaddperm", { cgid: id, permsid, permvalue });
}

/* --------------------------------------------------------- virtual server */

export async function readServerVariables(): Promise<ServerVariables> {
  return parseServerVariables(await tsCommand("servergetvariables", {}));
}

export async function editServer(args: TsCmdArgs<"serveredit">): Promise<void> {
  await tsCommand("serveredit", args);
}

/** Lines per log page: TeamSpeak's own client asks for 100 as well. */
export const LOG_PAGE_LINES = 100;

/** A page of the log, newest first; `from` is the last page's `lastPos`. */
export async function readServerLog(from?: number): Promise<LogPage> {
  const rows = await tsCommand("logview", {
    lines: LOG_PAGE_LINES,
    reverse: true,
    ...(from !== undefined ? { begin_pos: from } : {}),
  });
  return parseLogPage(rows);
}

export async function readConnectionInfo(): Promise<ConnectionInfo | null> {
  return parseConnectionInfo(await tsCommand("serverrequestconnectioninfo", {}));
}

/* ---------------------------------------------------- permission overview */

/**
 * The permission catalog. The hub serves it from its own cache without a
 * server round trip, so it is not cached here as well: a reconnect may be to
 * another server, whose ids can differ.
 */
export async function permissionCatalog(): Promise<CatalogView> {
  return parseCatalog(await tsCommand("permissionlist", {}));
}

export async function permissionOverview(
  channelId: string,
  clientDbId: string,
): Promise<PermSourceRow[]> {
  return parseOverview(await tsCommand("permoverview", { cid: channelId, cldbid: clientDbId }));
}
