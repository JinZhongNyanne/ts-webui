/**
 * Context-menu entries for managing channels (M2): create a subchannel, edit,
 * move (dragging's stand-in), delete on a channel; create a channel on the
 * server row. Gated by ts/channel-perms.ts; the server decides in the end and
 * its refusal is shown in the dialog or the event log.
 */
import type { TsChannel } from "@jinz/protocol";
import type { MenuItem } from "../../stores/contextMenu";
import { usePermsStore } from "../../stores/perms";
import { useTsStore } from "../../stores/ts";
import { useI18n } from "../../i18n";
import { confirmDialog } from "../ui/confirm";
import { deleteChannel, TS_CHANNEL_NOT_EMPTY } from "../../ts/channel-actions";
import { channelType } from "../../ts/channel-form";
import { channelDeleteImpact, channelPerms } from "../../ts/channel-perms";
import { TsCommandError } from "../../ts/commands";
import { openChannelDialog } from "./channel-dialogs";

export function useChannelMenus() {
  const ts = useTsStore();
  const perms = usePermsStore();
  const { t } = useI18n();
  const cp = channelPerms(perms);

  function report(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    ts.pushEvent(t("chm.actionFailed", { msg }), "error");
  }

  /**
   * Asks first, saying what is inside; force=1 only when something is (or
   * when the server says so: clients in channels we do not subscribe to are
   * invisible to us, so a 772 gets one more, explicit question).
   */
  async function removeChannel(ch: TsChannel): Promise<void> {
    const impact = channelDeleteImpact(ts.channels.values(), ts.clients.values(), ch.id);
    const ok = await confirmDialog({
      title: t("chm.deleteTitle", { name: ch.name }),
      message: impact.needsForce
        ? t("chm.deleteContents", { clients: impact.clients, subchannels: impact.subchannels })
        : t("chm.deleteEmpty"),
      confirmLabel: t("chm.deleteConfirm"),
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteChannel(ch.id, impact.needsForce);
    } catch (err) {
      if (!(err instanceof TsCommandError && err.code === TS_CHANNEL_NOT_EMPTY)) throw err;
      const again = await confirmDialog({
        title: t("chm.deleteForceTitle", { name: ch.name }),
        message: t("chm.deleteForceMsg"),
        confirmLabel: t("chm.deleteConfirm"),
        danger: true,
      });
      if (again) await deleteChannel(ch.id, true);
    }
  }

  function channelItems(ch: TsChannel): MenuItem[] {
    const items: MenuItem[] = [];
    if (cp.canCreateChild()) {
      items.push({
        label: t("chm.createSub"),
        icon: "➕",
        action: () => openChannelDialog({ kind: "create", parentId: ch.id }),
      });
    }
    if (cp.canEdit()) {
      items.push({
        label: t("chm.edit"),
        icon: "⚙️",
        action: () => openChannelDialog({ kind: "edit", channelId: ch.id }),
      });
    }
    // What dragging does, for touch screens and keyboards; the same gate.
    if (cp.canMove()) {
      items.push({
        label: t("chm.move"),
        icon: "↕️",
        action: () => openChannelDialog({ kind: "move", channelId: ch.id }),
      });
    }
    // The default channel cannot be deleted.
    if (!ch.flags.default && cp.canDelete(channelType(ch))) {
      items.push({
        label: t("chm.delete"),
        icon: "🗑️",
        danger: true,
        action: () => void removeChannel(ch).catch(report),
      });
    }
    return items.length ? [{ separator: true }, ...items] : [];
  }

  function serverItems(): MenuItem[] {
    if (!cp.canCreateTop()) return [];
    return [
      { separator: true },
      {
        label: t("chm.create"),
        icon: "➕",
        action: () => openChannelDialog({ kind: "create", parentId: "0" }),
      },
    ];
  }

  return { channelItems, serverItems, removeChannel };
}
