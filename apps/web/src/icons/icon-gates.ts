/**
 * When to offer the icon tools. As a live TS3 3.13 server checked them:
 *
 *  - b_icon_manage lists, uploads and deletes icons. It is a flag the
 *    server's notifyclientneededpermissions carries when granted, so once
 *    the set is in, missing means no (`!loaded || has`).
 *  - Setting an icon (`*addperm i_icon_id`) needs i_permission_modify_power
 *    (against i_needed_modify_power_icon_id) plus, per target,
 *    i_group_modify_power (server and channel groups),
 *    i_channel_permission_modify_power or i_client_permission_modify_power.
 *    Unknown powers are offered and the server's refusal names what it
 *    wanted; only a power known to be 0 hides the entry (`mayUse`).
 */
import type { IconTargetKind } from "./icon-set";

export const ICON_PERM = {
  manage: "b_icon_manage",
  maxIconSize: "i_max_icon_filesize",
  maxAvatarSize: "i_client_max_avatar_filesize",
  deleteAvatar: "b_client_avatar_delete_other",
  modifyPower: "i_permission_modify_power",
  groupModify: "i_group_modify_power",
  channelModify: "i_channel_permission_modify_power",
  clientModify: "i_client_permission_modify_power",
} as const;

const TARGET_POWER: Record<IconTargetKind, string> = {
  serverGroup: ICON_PERM.groupModify,
  channelGroup: ICON_PERM.groupModify,
  channel: ICON_PERM.channelModify,
  client: ICON_PERM.clientModify,
};

/** The parts of the perms store this needs. */
export interface IconPermSource {
  readonly loaded: boolean;
  has(name: string): boolean;
  mayUse(name: string): boolean;
}

export function iconGates(p: IconPermSource) {
  return {
    /** The icon manager: list, upload, delete. */
    manage: () => !p.loaded || p.has(ICON_PERM.manage),
    /** Setting (or removing) the icon of a target of this kind. */
    assign: (kind: IconTargetKind) =>
      p.mayUse(ICON_PERM.modifyPower) && p.mayUse(TARGET_POWER[kind]),
  };
}

export type IconGates = ReturnType<typeof iconGates>;
