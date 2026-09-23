/**
 * Plain helpers behind the perms store (stores/perms.ts), kept free of Pinia
 * and the hub so they are easy to test.
 *
 * TeamSpeak permissions come in two shapes:
 *  - `b_*` flags: 1 granted, 0 not.
 *  - `i_*` values: a number, where -1 conventionally means "unlimited"
 *    (i_client_max_channel_subscriptions, file-transfer quotas...).
 * A permission the hub never reported reads as 0: the server grants nothing
 * by default, and powers stay unknown when it will not tell us
 * (b_client_permissionoverview_own), which is the safe way to be wrong.
 */
import type { PermsMessage } from "@jinz/protocol";

export type PermValues = Readonly<Record<string, number>>;

/** The new set after a `perms` message: a full one replaces, a patch merges. */
export function applyPerms(current: PermValues, msg: PermsMessage): PermValues {
  return msg.full ? { ...msg.values } : { ...current, ...msg.values };
}

export function permValue(values: PermValues, name: string): number {
  return values[name] ?? 0;
}

/** A flag that is set, or a value of at least `min` (-1, unlimited, always counts). */
export function permHas(values: PermValues, name: string, min = 1): boolean {
  const v = permValue(values, name);
  return v === -1 || v >= min;
}

/**
 * TeamSpeak's "power vs needed power" rule, as the server applies it: an
 * action on someone goes through when my power is set and at least their
 * needed power. For example, may I kick `target` from the server?
 *
 *   powerCovers(perms.value("i_client_kick_from_server_power"),
 *               targetNeeded("i_client_needed_kick_from_server_power"))
 *
 * The page rarely knows the target's needed power (it takes `permoverview`,
 * which needs b_client_permissionoverview_view), so menus usually gate on
 * `perms.has("i_client_kick_from_server_power")` alone and leave the
 * comparison to the server, whose 2568 then names the permission.
 */
export function powerCovers(power: number, needed: number): boolean {
  if (power === -1) return true;
  return power > 0 && power >= needed;
}

/**
 * Whether to offer an action gated on the power `name` in a menu.
 *
 * For the `i_*` powers the hub asks for with `permget` (POWER_PERMS in the
 * hub's own-perms.ts). They only arrive when the user holds
 * b_client_permissionoverview_own, which most do not, so a power that is
 * absent is unknown, and unknown means "offer it": the server has the last
 * word, and its refusal names the permission it wanted. Only a power we know
 * to be 0 hides the action. This is the M2 rule for moderation menus (kick,
 * move, ban, channel edit...).
 *
 * Not for `b_*` flags from `notifyclientneededpermissions`: that set lists
 * what we are granted, so once loaded a missing flag means no; use
 * `!perms.loaded || perms.has(flag)` (useClientMenus' `mayTry`) for those.
 */
export function mayUse(values: PermValues, loaded: boolean, name: string, min = 1): boolean {
  if (!loaded || !(name in values)) return true;
  return permHas(values, name, min);
}
