/**
 * The ban entries of the tree's context menus: "Ban…" on another client,
 * "Ban list" on the server row, which useClientMenus puts in the
 * "Administration" group. Kept apart so the M2 slices stay out of each
 * other's way; that file only splices these in.
 *
 * Gating follows the M2 rule (see mayUse in ts/perms.ts): the flags
 * b_client_ban_create / b_client_ban_list come with
 * notifyclientneededpermissions, so once that set is in a missing flag means
 * no; the power i_client_ban_power is usually unknown, and unknown offers.
 */
import type { TsClient } from "@jinz/protocol";
import type { MenuItem } from "../../stores/contextMenu";
import { usePermsStore } from "../../stores/perms";
import { useI18n } from "../../i18n";
import { openClientDialog } from "../client/client-dialogs";

export const PERM_BAN_CREATE = "b_client_ban_create";
export const PERM_BAN_LIST = "b_client_ban_list";
export const PERM_BAN_POWER = "i_client_ban_power";

export function useBanMenus() {
  const perms = usePermsStore();
  const { t } = useI18n();

  const flag = (name: string) => !perms.loaded || perms.has(name);

  function canBan(c: TsClient): boolean {
    return !c.isSelf && flag(PERM_BAN_CREATE) && perms.mayUse(PERM_BAN_POWER);
  }

  function banClientItems(c: TsClient): MenuItem[] {
    if (!canBan(c)) return [];
    return [
      {
        label: t("ban.menu"),
        icon: "🔨",
        action: () => openClientDialog({ kind: "ban", clientId: c.id }),
      },
    ];
  }

  function banServerItems(): MenuItem[] {
    if (!flag(PERM_BAN_LIST)) return [];
    return [
      { label: t("banList.menu"), icon: "📋", action: () => openClientDialog({ kind: "banList" }) },
    ];
  }

  return { canBan, banClientItems, banServerItems };
}
