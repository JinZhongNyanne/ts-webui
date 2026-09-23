/**
 * When to offer each M4 server window. Every flag here was in a live Server
 * Admin's `notifyclientneededpermissions` set (b_virtualserver_token_*,
 * _log_view, _connectioninfo_view, _servergroup_create/_delete, the
 * _modify_* flags, b_client_permissionoverview_*, i_group_modify_power), and
 * that set lists what we are granted, so once it is loaded a missing flag is
 * a no (`!loaded || has`, as in ts/admin-perms.ts).
 *
 * Redeeming a privilege key needs b_virtualserver_token_use, which a stock
 * server's Guest group carries (it was in a guest's set on a live server).
 */
import type { ServerEditField } from "@jinz/protocol";
import type { PermSource } from "../../ts/admin-perms";

export const SERVER_PERM = {
  tokenUse: "b_virtualserver_token_use",
  tokenList: "b_virtualserver_token_list",
  tokenAdd: "b_virtualserver_token_add",
  tokenDelete: "b_virtualserver_token_delete",
  logView: "b_virtualserver_log_view",
  connectionInfo: "b_virtualserver_connectioninfo_view",
  serverGroupList: "b_virtualserver_servergroup_list",
  serverGroupCreate: "b_virtualserver_servergroup_create",
  serverGroupDelete: "b_virtualserver_servergroup_delete",
  channelGroupList: "b_virtualserver_channelgroup_list",
  channelGroupCreate: "b_virtualserver_channelgroup_create",
  channelGroupDelete: "b_virtualserver_channelgroup_delete",
  groupModifyPower: "i_group_modify_power",
  overviewView: "b_client_permissionoverview_view",
  overviewOwn: "b_client_permissionoverview_own",
} as const;

/** The flag the server checks for each `serveredit` field. */
export const EDIT_FIELD_PERM: Readonly<Record<ServerEditField, string>> = {
  virtualserver_name: "b_virtualserver_modify_name",
  virtualserver_welcomemessage: "b_virtualserver_modify_welcomemessage",
  virtualserver_hostmessage: "b_virtualserver_modify_hostmessage",
  virtualserver_hostmessage_mode: "b_virtualserver_modify_hostmessage",
  virtualserver_hostbanner_url: "b_virtualserver_modify_hostbanner",
  virtualserver_hostbanner_gfx_url: "b_virtualserver_modify_hostbanner",
  virtualserver_hostbutton_url: "b_virtualserver_modify_hostbutton",
  virtualserver_hostbutton_gfx_url: "b_virtualserver_modify_hostbutton",
  virtualserver_maxclients: "b_virtualserver_modify_maxclients",
  virtualserver_reserved_slots: "b_virtualserver_modify_reserved_slots",
  virtualserver_default_server_group: "b_virtualserver_modify_default_servergroup",
  virtualserver_default_channel_group: "b_virtualserver_modify_default_channelgroup",
  virtualserver_needed_identity_security_level:
    "b_virtualserver_modify_needed_identity_security_level",
  virtualserver_min_clients_in_channel_before_forced_silence:
    "b_virtualserver_modify_channel_forced_silence",
};

export function serverGates(p: PermSource) {
  const flag = (name: string) => !p.loaded || p.has(name);
  const createServerGroup = () => flag(SERVER_PERM.serverGroupCreate);
  const deleteServerGroup = () => flag(SERVER_PERM.serverGroupDelete);
  const createChannelGroup = () => flag(SERVER_PERM.channelGroupCreate);
  const deleteChannelGroup = () => flag(SERVER_PERM.channelGroupDelete);
  const modifyGroups = () => flag(SERVER_PERM.groupModifyPower);
  const editField = (field: ServerEditField) => flag(EDIT_FIELD_PERM[field]);
  return {
    redeemKey: () => flag(SERVER_PERM.tokenUse),
    privilegeKeys: () => flag(SERVER_PERM.tokenList),
    addKey: () => flag(SERVER_PERM.tokenAdd),
    deleteKey: () => flag(SERVER_PERM.tokenDelete),
    /** Listing groups is a guest's right too; the window is for those who can change them. */
    groups: () =>
      flag(SERVER_PERM.serverGroupList) &&
      (createServerGroup() ||
        deleteServerGroup() ||
        createChannelGroup() ||
        deleteChannelGroup() ||
        modifyGroups()),
    createServerGroup,
    deleteServerGroup,
    createChannelGroup,
    deleteChannelGroup,
    /** Rename and sort order; each group's needed modify power is the server's to check. */
    modifyGroups,
    editServer: () => Object.values(EDIT_FIELD_PERM).some(flag),
    editField,
    serverLog: () => flag(SERVER_PERM.logView),
    connectionInfo: () => flag(SERVER_PERM.connectionInfo),
    permOverview: (self: boolean) =>
      flag(self ? SERVER_PERM.overviewOwn : SERVER_PERM.overviewView),
  };
}

export type ServerGates = ReturnType<typeof serverGates>;
