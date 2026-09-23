/**
 * Arguments of the M3 icon and avatar commands for `ts.cmd` (wire form in
 * apps/hub/src/gateway/icon-commands.ts; naming rules in ts-internal-files.ts).
 *
 * The permission commands set `i_icon_id`, like `channeladdperm`
 * (ts-channel-commands.ts), plus the two group display permissions M4's
 * group management needs (below); the permission editor would widen them
 * further. As a live TS3 3.13 server checked them: servergroup/channelgroup*perm need
 * i_group_modify_power (against the group's needed modify power),
 * client*perm i_client_permission_modify_power (2570 when short), and all of
 * them i_permission_modify_power against i_needed_modify_power_icon_id.
 *
 * File deletes are narrow on purpose: an icon by id, and the caller's own
 * avatar, which the hub names from the session's UID. General file deletes
 * belong to the file browser.
 */
import { z } from "zod";
import { DECIMAL_ID } from "./ids.js";
import { BUILTIN_ICON_LIMIT } from "./ts-internal-files.js";

const dbIdSchema = z.string().regex(DECIMAL_ID, "must be a decimal id");
const iconPermSid = z.literal("i_icon_id");
const INT32_MIN = -2_147_483_648;
const UINT32_MAX = 4_294_967_295;

/** Icon ids are CRC32s: unsigned on our side, sent as int32 by the hub. */
const iconValue = z.number().int().min(INT32_MIN).max(UINT32_MAX);

/**
 * M4's group management widens the group commands by exactly two display
 * permissions, not into a general permission channel: `i_group_sort_id`
 * (where a group sorts among a client's groups) and
 * `i_group_show_name_in_tree` (0 hidden, 1 before the nickname, 2 after).
 */
const sortIdSid = z.literal("i_group_sort_id");
const showNameSid = z.literal("i_group_show_name_in_tree");
const GROUP_PERM_SIDS = z.union([iconPermSid, sortIdSid, showNameSid]);
const INT32_MAX = 2_147_483_647;

/** One group's add-perm arguments, keyed by `sgid` or `cgid`. */
function groupAddPerm<K extends "sgid" | "cgid">(key: K) {
  const id = { [key]: dbIdSchema } as Record<K, typeof dbIdSchema>;
  return z.discriminatedUnion("permsid", [
    z.object({ ...id, permsid: iconPermSid, permvalue: iconValue }).strict(),
    z
      .object({ ...id, permsid: sortIdSid, permvalue: z.number().int().min(0).max(INT32_MAX) })
      .strict(),
    z.object({ ...id, permsid: showNameSid, permvalue: z.number().int().min(0).max(2) }).strict(),
  ]);
}

export const ServerGroupAddPermArgs = groupAddPerm("sgid");
export const ServerGroupDelPermArgs = z
  .object({ sgid: dbIdSchema, permsid: GROUP_PERM_SIDS })
  .strict();

export const ChannelGroupAddPermArgs = groupAddPerm("cgid");
export const ChannelGroupDelPermArgs = z
  .object({ cgid: dbIdSchema, permsid: GROUP_PERM_SIDS })
  .strict();

/** On a client's identity (database id), so it follows them across sessions. */
export const ClientAddPermArgs = z
  .object({ cldbid: dbIdSchema, permsid: iconPermSid, permvalue: iconValue })
  .strict();
export const ClientDelPermArgs = z.object({ cldbid: dbIdSchema, permsid: iconPermSid }).strict();

/** An uploaded icon, by its unsigned id; built-in ids are not files. */
export const FtDeleteIconArgs = z
  .object({ iconId: z.number().int().min(BUILTIN_ICON_LIMIT).max(UINT32_MAX) })
  .strict();

/** The caller's own avatar file. */
export const FtDeleteAvatarArgs = z.object({}).strict();
