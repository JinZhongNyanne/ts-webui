/**
 * Which channel actions to offer, under the M2 rule (see ts/perms.ts):
 *  - `b_*` flags come from notifyclientneededpermissions, which lists what we
 *    are granted, so once it is in, a missing flag means no;
 *  - `i_channel_modify_power` / `i_channel_delete_power` are only known with
 *    b_client_permissionoverview_own; unknown means "offer it", a known 0 hides.
 *
 * Checked on a live TS3 server with a Server Admin: every flag below is in
 * the notify except `b_channel_modify_parent`, so moving to another parent is
 * gated on the sort-order flag plus the modify power, and the server has the
 * last word (its refusal names the permission).
 */
import type { ChannelType } from "./channel-form";

export interface PermSource {
  readonly loaded: boolean;
  has(name: string, min?: number): boolean;
  mayUse(name: string, min?: number): boolean;
  value(name: string): number;
}

export const CREATE_FLAGS: Record<ChannelType, string> = {
  permanent: "b_channel_create_permanent",
  semi: "b_channel_create_semi_permanent",
  temporary: "b_channel_create_temporary",
};

export const MAKE_FLAGS: Record<ChannelType, string> = {
  permanent: "b_channel_modify_make_permanent",
  semi: "b_channel_modify_make_semi_permanent",
  temporary: "b_channel_modify_make_temporary",
};

export const DELETE_FLAGS: Record<ChannelType, string> = {
  permanent: "b_channel_delete_permanent",
  semi: "b_channel_delete_semi_permanent",
  temporary: "b_channel_delete_temporary",
};

/** Any of these makes the edit dialog worth opening. */
export const MODIFY_FLAGS: readonly string[] = [
  "b_channel_modify_name",
  "b_channel_modify_topic",
  "b_channel_modify_description",
  "b_channel_modify_password",
  "b_channel_modify_codec",
  "b_channel_modify_codec_quality",
  "b_channel_modify_maxclients",
  "b_channel_modify_maxfamilyclients",
  "b_channel_modify_sortorder",
  "b_channel_modify_needed_talk_power",
  "b_channel_modify_make_default",
  "b_channel_modify_temp_delete_delay",
  ...Object.values(MAKE_FLAGS),
];

export const PERM_CREATE_CHILD = "b_channel_create_child";
export const PERM_SORTORDER = "b_channel_modify_sortorder";
export const PERM_MAKE_DEFAULT = "b_channel_modify_make_default";
export const PERM_CREATE_DEFAULT = "b_channel_create_with_default";
export const PERM_DELETE_FORCE = "b_channel_delete_flag_force";
export const POWER_MODIFY = "i_channel_modify_power";
export const POWER_DELETE = "i_channel_delete_power";
export const PERM_MAX_QUALITY = "i_channel_create_modify_with_codec_maxquality";
export const PERM_MAX_DELETE_DELAY = "i_channel_create_modify_with_temp_delete_delay";

const TYPES: readonly ChannelType[] = ["permanent", "semi", "temporary"];

export function channelPerms(p: PermSource) {
  const mayTry = (flag: string) => !p.loaded || p.has(flag);
  const createTypes = (): ChannelType[] => TYPES.filter((t) => mayTry(CREATE_FLAGS[t]));
  return {
    mayTry,
    createTypes,
    canCreateTop: () => createTypes().length > 0,
    canCreateChild: () => createTypes().length > 0 && mayTry(PERM_CREATE_CHILD),
    /** Types an existing channel may be switched to (its own type always stays available). */
    editTypes: (current: ChannelType): ChannelType[] =>
      TYPES.filter((t) => t === current || mayTry(MAKE_FLAGS[t])),
    canEdit: () => p.mayUse(POWER_MODIFY) && MODIFY_FLAGS.some(mayTry),
    canMove: () => p.mayUse(POWER_MODIFY) && mayTry(PERM_SORTORDER),
    canDelete: (type: ChannelType) => p.mayUse(POWER_DELETE) && mayTry(DELETE_FLAGS[type]),
    /** Highest codec quality we may set (10 when unknown). */
    maxQuality: (): number => {
      if (!p.loaded) return 10;
      const v = p.value(PERM_MAX_QUALITY);
      return v === -1 ? 10 : Math.max(0, Math.min(10, v));
    },
    /** Longest delete delay in seconds, -1 when unknown or unlimited. */
    maxDeleteDelay: (): number => {
      if (!p.loaded) return -1;
      const v = p.value(PERM_MAX_DELETE_DELAY);
      // value() is 0 for "never reported" too; mayUse tells them apart (a known 0 is no).
      if (v === 0) return p.mayUse(PERM_MAX_DELETE_DELAY) ? -1 : 0;
      return v;
    },
  };
}

export type ChannelPerms = ReturnType<typeof channelPerms>;

export interface DeleteImpact {
  readonly subchannels: number;
  readonly clients: number;
  /** TeamSpeak refuses a delete without force when anything is inside (772). */
  readonly needsForce: boolean;
}

/**
 * What deleting `cid` takes with it, as far as we can see: clients in
 * channels we are not subscribed to are unknown, so the server may still
 * answer 772 (see useChannelMenus' delete flow).
 */
export function channelDeleteImpact(
  channels: Iterable<{ id: string; parentId: string }>,
  clients: Iterable<{ channelId: string }>,
  cid: string,
): DeleteImpact {
  const list = [...channels];
  const subtree = new Set([cid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of list) {
      if (!subtree.has(c.id) && subtree.has(c.parentId)) {
        subtree.add(c.id);
        grew = true;
      }
    }
  }
  const inside = [...clients].filter((c) => subtree.has(c.channelId)).length;
  const subchannels = subtree.size - 1;
  return { subchannels, clients: inside, needsForce: subchannels > 0 || inside > 0 };
}
