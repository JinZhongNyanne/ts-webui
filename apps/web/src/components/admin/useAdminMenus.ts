/**
 * Context-menu entries for the M2 admin tools, spliced into useClientMenus:
 * "Complain" / "Send offline message" on a client, and an "Administration"
 * group on the server row. Each is offered only where useAdminGates says the
 * user may use it. M4's server tools join them: "Permission overview" on a
 * client (oneself included), and privilege keys, groups, the server's own
 * settings and its log in the server's group, gated by useServerGates.
 */
import type { TsClient } from "@jinz/protocol";
import type { MenuItem } from "../../stores/contextMenu";
import { useInboxStore } from "../../stores/inbox";
import { useI18n } from "../../i18n";
import { openClientDialog } from "../client/client-dialogs";
import { useAdminGates } from "./useAdminGates";
import { useServerGates } from "../server/useServerGates";

export function useAdminMenus() {
  const gates = useAdminGates();
  const server = useServerGates();
  const inbox = useInboxStore();
  const { t } = useI18n();

  /** M4: who gives this client which permission, in the channel it is in. */
  function permOverviewItems(c: TsClient): MenuItem[] {
    if (c.type !== 0 || !c.databaseId || !server.permOverview(c.isSelf)) return [];
    return [
      {
        label: t("server.perm.menu"),
        icon: "🔍",
        action: () =>
          openClientDialog({
            kind: "permOverview",
            dbId: c.databaseId,
            channelId: c.channelId,
            nickname: c.nickname,
          }),
      },
    ];
  }

  function clientAdminItems(c: TsClient): MenuItem[] {
    // ServerQuery clients have no inbox and cannot be complained about usefully.
    if (c.isSelf || c.type !== 0) return permOverviewItems(c);
    const items: MenuItem[] = [];
    if (gates.sendOffline()) {
      items.push({
        label: t("admin.sendOffline"),
        icon: "✉️",
        action: () =>
          openClientDialog({ kind: "composeMessage", uid: c.uid, nickname: c.nickname }),
      });
    }
    if (gates.complain()) {
      items.push({
        label: t("admin.complain.menu"),
        icon: "⚠️",
        action: () =>
          openClientDialog({ kind: "complain", dbId: c.databaseId, nickname: c.nickname }),
      });
    }
    return [...items, ...permOverviewItems(c)];
  }

  /** The "Administration" group; `extra` (the ban list, gated by its caller) leads it. */
  function serverAdminItems(extra: readonly MenuItem[] = []): MenuItem[] {
    const unread = inbox.unread;
    const tools: MenuItem[] = [...extra];
    if (gates.complaintList()) {
      tools.push({
        label: t("admin.complaints.menu"),
        icon: "⚠️",
        action: () => openClientDialog({ kind: "complaints" }),
      });
    }
    // Anyone may read their own offline messages.
    tools.push({
      label: unread ? t("admin.inbox.menuUnread", { n: unread }) : t("admin.inbox.menu"),
      icon: "📬",
      action: () => openClientDialog({ kind: "inbox" }),
    });
    if (gates.clientDb()) {
      tools.push({
        label: t("admin.db.menu"),
        icon: "🗂️",
        action: () => openClientDialog({ kind: "clientDb" }),
      });
    }
    if (gates.tempPasswords()) {
      tools.push({
        label: t("admin.tp.menu"),
        icon: "🔑",
        action: () => openClientDialog({ kind: "tempPasswords" }),
      });
    }
    return [
      { separator: true },
      { label: t("admin.group"), disabled: true },
      ...tools,
      ...serverToolItems(),
    ];
  }

  /** M4: the server's own tools, after the M2 ones in the same group. */
  function serverToolItems(): MenuItem[] {
    const entry = (show: boolean, item: MenuItem): MenuItem[] => (show ? [item] : []);
    return [
      ...entry(server.redeemKey(), {
        label: t("server.pk.useMenu"),
        icon: "🎟️",
        action: () => openClientDialog({ kind: "privilegeKeyUse" }),
      }),
      ...entry(server.privilegeKeys(), {
        label: t("server.pk.menu"),
        icon: "🗝️",
        action: () => openClientDialog({ kind: "privilegeKeys" }),
      }),
      ...entry(server.groups(), {
        label: t("server.groups.menu"),
        icon: "👥",
        action: () => openClientDialog({ kind: "groups" }),
      }),
      ...entry(server.editServer(), {
        label: t("server.edit.menu"),
        icon: "🛠️",
        action: () => openClientDialog({ kind: "serverEdit" }),
      }),
      ...entry(server.serverLog(), {
        label: t("server.log.menu"),
        icon: "📜",
        action: () => openClientDialog({ kind: "serverLog" }),
      }),
    ];
  }

  return { clientAdminItems, serverAdminItems };
}
