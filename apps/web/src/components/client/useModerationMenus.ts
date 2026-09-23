/**
 * Context-menu entries for the M2 moderation actions (move, kick, group
 * assignment, channel commander), appended by useClientMenus so the tree and
 * the info panel offer the same things.
 *
 * Gating follows the M2 rule (see mayUse in ts/perms.ts): an `i_*` power is
 * offered unless we know it is 0, since most users cannot read their own
 * powers and the server's refusal names what was missing; a `b_*` flag from
 * notifyclientneededpermissions is offered until the set is in, then only
 * when granted.
 */
import type { TsClient } from "@jinz/protocol";
import type { MenuItem } from "../../stores/contextMenu";
import { usePermsStore } from "../../stores/perms";
import { useTsStore } from "../../stores/ts";
import { useI18n } from "../../i18n";
import { setChannelCommander } from "../../ts/moderation-actions";
import { openClientDialog } from "./client-dialogs";

export const POWER_MOVE = "i_client_move_power";
export const POWER_KICK_CHANNEL = "i_client_kick_from_channel_power";
export const POWER_KICK_SERVER = "i_client_kick_from_server_power";
export const POWER_GROUP_ADD = "i_group_member_add_power";
export const POWER_GROUP_REMOVE = "i_group_member_remove_power";
export const PERM_CHANNEL_COMMANDER = "b_client_use_channel_commander";

export function useModerationMenus() {
  const ts = useTsStore();
  const perms = usePermsStore();
  const { t } = useI18n();

  function canMove(c: Pick<TsClient, "isSelf">): boolean {
    return c.isSelf || perms.mayUse(POWER_MOVE);
  }

  function canUseCommander(): boolean {
    return !perms.loaded || perms.has(PERM_CHANNEL_COMMANDER);
  }

  /** Group dialogs, for anyone (ourselves included: an admin may regroup themselves). */
  function groupItems(c: TsClient): MenuItem[] {
    const items: MenuItem[] = [];
    if (perms.mayUse(POWER_GROUP_ADD) || perms.mayUse(POWER_GROUP_REMOVE)) {
      items.push({
        label: t("mod.serverGroups"),
        icon: "🛡️",
        action: () => openClientDialog({ kind: "serverGroups", clientId: c.id }),
      });
    }
    if (perms.mayUse(POWER_GROUP_ADD)) {
      items.push({
        label: t("mod.channelGroup"),
        icon: "🏷️",
        action: () => openClientDialog({ kind: "channelGroup", clientId: c.id }),
      });
    }
    return items;
  }

  function clientItems(c: TsClient): MenuItem[] {
    const items: MenuItem[] = [];
    if (canMove(c)) {
      items.push({
        label: t("mod.moveTo"),
        icon: "↪️",
        action: () => openClientDialog({ kind: "move", clientId: c.id }),
      });
    }
    if (perms.mayUse(POWER_KICK_CHANNEL)) {
      items.push({
        label: t("mod.kickChannel"),
        icon: "👢",
        danger: true,
        action: () => openClientDialog({ kind: "kick", clientId: c.id, scope: "channel" }),
      });
    }
    if (perms.mayUse(POWER_KICK_SERVER)) {
      items.push({
        label: t("mod.kickServer"),
        icon: "⛔",
        danger: true,
        action: () => openClientDialog({ kind: "kick", clientId: c.id, scope: "server" }),
      });
    }
    items.push(...groupItems(c));
    return items.length ? [{ separator: true }, ...items] : [];
  }

  /** Failures of the commander toggle go to the log, as for the other quick actions. */
  function toggleCommander(on: boolean): void {
    setChannelCommander(on).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      ts.pushEvent(t("m1.actionFailed", { msg }), "error");
    });
  }

  function selfItems(): MenuItem[] {
    const me = ts.selfClient;
    if (!me) return [];
    const items: MenuItem[] = [
      {
        label: t("mod.moveTo"),
        icon: "↪️",
        action: () => openClientDialog({ kind: "move", clientId: me.id }),
      },
    ];
    if (canUseCommander()) {
      items.push({
        label: t("mod.commander"),
        icon: me.isChannelCommander ? "☑" : "☐",
        action: () => toggleCommander(!me.isChannelCommander),
      });
    }
    items.push(...groupItems(me));
    return [{ separator: true }, ...items];
  }

  return { clientItems, selfItems, canMove, canUseCommander };
}
