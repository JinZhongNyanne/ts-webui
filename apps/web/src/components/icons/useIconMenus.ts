/**
 * Where the icon tools are offered (gates in icons/icon-gates.ts): "Icons…"
 * in the server menu's Administration group, and "Set icon…" on a channel
 * and on a client. The group dialogs have their own small button.
 */
import type { TsChannel, TsClient } from "@jinz/protocol";
import type { MenuItem } from "../../stores/contextMenu";
import { usePermsStore } from "../../stores/perms";
import { useI18n } from "../../i18n";
import { iconGates } from "../../icons/icon-gates";
import { displayChannelName } from "../../ts/format";
import { openIconDialog } from "./icon-dialogs";

/** The icon gates over the live perms store. */
export function useIconGates() {
  const perms = usePermsStore();
  return iconGates({
    get loaded() {
      return perms.loaded;
    },
    has: (n) => perms.has(n),
    mayUse: (n) => perms.mayUse(n),
  });
}

export function useIconMenus() {
  const gates = useIconGates();
  const { t } = useI18n();

  function serverItems(): MenuItem[] {
    if (!gates.manage()) return [];
    return [{ label: t("icons.menu"), icon: "🖼️", action: () => openIconDialog() }];
  }

  function channelItems(ch: TsChannel): MenuItem[] {
    if (!gates.assign("channel")) return [];
    const name = displayChannelName(ch.name, ch.parentId);
    return [
      {
        label: t("icons.setIcon"),
        icon: "🖼️",
        action: () => openIconDialog({ kind: "channel", id: ch.id, name }),
      },
    ];
  }

  function clientItems(c: TsClient): MenuItem[] {
    // ServerQuery clients have no identity of their own to carry an icon.
    if (c.type !== 0 || !gates.assign("client")) return [];
    return [
      {
        label: t("icons.setIcon"),
        icon: "🖼️",
        action: () => openIconDialog({ kind: "client", dbId: c.databaseId, name: c.nickname }),
      },
    ];
  }

  return { serverItems, channelItems, clientItems };
}
