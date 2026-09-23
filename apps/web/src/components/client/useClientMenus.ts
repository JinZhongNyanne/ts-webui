/**
 * Context-menu entries for the M1 client features, shared by the channel tree
 * and the info panel so both offer the same things under the same rules.
 *
 * Permission gating: the flags used here (b_client_modify_own_description,
 * b_client_modify_description, b_client_set_flag_talker,
 * b_client_request_talker) are all in `notifyclientneededpermissions`, which
 * lists what we are granted — a live TS3 server leaves out what we are not
 * (checked with a normal user and a Server Admin). So once the set is in, a
 * missing flag means no. Until it is in (or on a server that never sends it)
 * everything is offered: the server has the last word either way, and its
 * refusal is shown with the permission it wanted.
 */
import type { TsChannel, TsClient } from "@jinz/protocol";
import type { MenuItem } from "../../stores/contextMenu";
import { useTsStore } from "../../stores/ts";
import { usePermsStore } from "../../stores/perms";
import { useClientPrefsStore } from "../../stores/clientPrefs";
import { useI18n } from "../../i18n";
import {
  cancelTalkRequest,
  setTalker,
  subscribeAllChannels,
  subscribeChannels,
  unsubscribeAllChannels,
  unsubscribeChannels,
} from "../../ts/client-actions";
import { isChannelVisible, needsTalkPower } from "../../ts/client-features";
import { openClientDialog } from "./client-dialogs";
import { useChannelMenus } from "../channels/useChannelMenus";
import { useModerationMenus } from "./useModerationMenus";
import { denyTalkRequest } from "../../ts/moderation-actions";
import { useBanMenus } from "../bans/useBanMenus";
import { useAdminMenus } from "../admin/useAdminMenus";
import { useFileBrowserStore } from "../../stores/fileBrowser";
import { FT_POWERS } from "../../files/browser-perms";
import { useIconMenus } from "../icons/useIconMenus";

export const PERM_OWN_DESCRIPTION = "b_client_modify_own_description";
export const PERM_DESCRIPTION = "b_client_modify_description";
export const PERM_SET_TALKER = "b_client_set_flag_talker";
export const PERM_REQUEST_TALKER = "b_client_request_talker";

export function useClientMenus() {
  const ts = useTsStore();
  const perms = usePermsStore();
  const prefs = useClientPrefsStore();
  const { t } = useI18n();
  const channelMenus = useChannelMenus();
  const moderation = useModerationMenus();
  const { banClientItems, banServerItems } = useBanMenus();
  const admin = useAdminMenus();
  const fileBrowser = useFileBrowserStore();
  const icons = useIconMenus();

  /** See the file comment: unknown until the set arrives, then granted or not. */
  function mayTry(perm: string): boolean {
    return !perms.loaded || perms.has(perm);
  }

  /** Failures of fire-and-forget menu actions go to the server log in the chat. */
  function run(action: Promise<void>): void {
    action.catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      ts.pushEvent(t("m1.actionFailed", { msg }), "error");
    });
  }

  function canEditDescription(c: TsClient): boolean {
    return mayTry(c.isSelf ? PERM_OWN_DESCRIPTION : PERM_DESCRIPTION);
  }

  /** Talk power matters for `c` where their channel asks for it, or they asked. */
  function talkRelevant(c: TsClient): boolean {
    const ch = ts.channels.get(c.channelId);
    return c.talkRequest || c.isTalker || (!!ch && ch.neededTalkPower > 0);
  }

  function canGrantTalk(c: TsClient): boolean {
    return !c.isSelf && talkRelevant(c) && mayTry(PERM_SET_TALKER);
  }

  /**
   * What talk power action we can take in our own channel: cancel a pending
   * request, request (where the channel needs more than we have: the server
   * refuses a request anywhere else), or none.
   */
  function selfTalkAction(): "cancel" | "request" | null {
    const me = ts.selfClient;
    const ch = ts.selfChannel;
    if (!me || !ch) return null;
    if (me.talkRequest) return "cancel";
    return needsTalkPower(me, ch) && mayTry(PERM_REQUEST_TALKER) ? "request" : null;
  }

  function selfItems(): MenuItem[] {
    const me = ts.selfClient;
    const items: MenuItem[] = [
      { label: t("nick.change"), icon: "✏️", action: () => openClientDialog({ kind: "nickname" }) },
      { label: t("away.menu"), icon: "🌙", action: () => openClientDialog({ kind: "away" }) },
    ];
    if (me && canEditDescription(me)) {
      items.push({
        label: t("desc.edit"),
        icon: "📝",
        action: () => openClientDialog({ kind: "description", clientId: me.id }),
      });
    }
    const talk = selfTalkAction();
    if (talk === "cancel") {
      items.push({ label: t("talk.cancel"), icon: "✋", action: () => run(cancelTalkRequest()) });
    } else if (talk === "request") {
      items.push({
        label: t("talk.request"),
        icon: "✋",
        action: () => openClientDialog({ kind: "talkRequest" }),
      });
    }
    items.push(...moderation.selfItems());
    if (me) items.push(...icons.clientItems(me));
    return items;
  }

  function clientItems(c: TsClient): MenuItem[] {
    const items: MenuItem[] = [];
    if (canGrantTalk(c)) {
      // A pending request: what they asked, then grant or deny it.
      if (c.talkRequest) {
        const msg = c.talkRequestMessage;
        items.push({
          label: msg ? t("talk.pendingWith", { msg }) : t("talk.pending"),
          icon: "✋",
          disabled: true,
        });
      }
      items.push(
        c.isTalker
          ? { label: t("talk.revoke"), icon: "🔇", action: () => run(setTalker(c.id, false)) }
          : { label: t("talk.grant"), icon: "🎤", action: () => run(setTalker(c.id, true)) },
      );
      if (c.talkRequest && !c.isTalker) {
        items.push({
          label: t("mod.talkDeny"),
          icon: "🚫",
          action: () => run(denyTalkRequest(c.id)),
        });
      }
    }
    if (canEditDescription(c)) {
      items.push({
        label: t("desc.edit"),
        icon: "📝",
        action: () => openClientDialog({ kind: "description", clientId: c.id }),
      });
    }
    // Ban joins the moderation group (which brings its own separator), or starts one.
    const mod = moderation.clientItems(c);
    const ban = banClientItems(c);
    items.push(...(mod.length ? [...mod, ...ban] : withSeparator(ban)));
    return [...items, ...withSeparator([...admin.clientAdminItems(c), ...icons.clientItems(c)])];
  }

  function channelItems(ch: TsChannel): MenuItem[] {
    const channel = channelMenus.channelItems(ch);
    // "Set icon…" joins the channel tools (which bring their separator), or starts a group.
    const icon = icons.channelItems(ch);
    const tools = channel.length ? [...channel, ...icon] : withSeparator(icon);
    return [...subscriptionItems(ch), ...fileItems(ch), ...tools];
  }

  /** M3: the file browser on this channel (it asks for a password itself). */
  function fileItems(ch: TsChannel): MenuItem[] {
    // Older hubs do no file transfer at all; then there is nothing to browse.
    if (!ts.features.files || !perms.mayUse(FT_POWERS.browse)) return [];
    return [{ label: t("fb.menuBrowse"), icon: "📁", action: () => fileBrowser.open(ch.id) }];
  }

  function subscriptionItems(ch: TsChannel): MenuItem[] {
    // Our own channel reports its members whatever we ask for.
    if (ch.id === ts.selfChannel?.id) return [];
    return isChannelVisible(ch, ts.selfChannel?.id)
      ? [
          {
            label: t("sub.unsubscribe"),
            icon: "🙈",
            action: () => run(unsubscribeChannels([ch.id])),
          },
        ]
      : [{ label: t("sub.subscribe"), icon: "👁️", action: () => run(subscribeChannels([ch.id])) }];
  }

  function serverItems(): MenuItem[] {
    const check = (on: boolean) => (on ? "☑" : "☐");
    return [
      { label: t("sub.all"), icon: "👁️", action: () => run(subscribeAllChannels()) },
      { label: t("sub.none"), icon: "🙈", action: () => run(unsubscribeAllChannels()) },
      { separator: true },
      {
        label: t("sub.onConnect"),
        icon: check(prefs.subscribeAllOnConnect),
        action: () => prefs.setSubscribeAllOnConnect(!prefs.subscribeAllOnConnect),
      },
      {
        label: t("tree.showAvatars"),
        icon: check(prefs.showTreeAvatars),
        action: () => prefs.setShowTreeAvatars(!prefs.showTreeAvatars),
      },
      ...channelMenus.serverItems(),
      // The ban list sits with the other admin tools, under their heading.
      ...admin.serverAdminItems(banServerItems()),
      ...icons.serverItems(),
    ];
  }

  /** A group of entries after a separator, or nothing at all when the group is empty. */
  function withSeparator(group: MenuItem[]): MenuItem[] {
    return group.length ? [{ separator: true }, ...group] : [];
  }

  return {
    selfItems,
    clientItems,
    channelItems,
    serverItems,
    canEditDescription,
    canGrantTalk,
    selfTalkAction,
    run,
  };
}
