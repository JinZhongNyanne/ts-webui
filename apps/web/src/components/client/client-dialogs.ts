/**
 * Which client dialog is open, if any: the M1 self-service ones, the M2
 * moderation, ban and admin ones, and the M4 server ones. One slot for all of them, rendered by
 * `ClientDialogsHost` (mounted once in App.vue), so the status
 * bar, the tree's context menu, the info panel and the mobile menu can all
 * open the same dialog without each mounting its own copy.
 */
import { shallowRef } from "vue";
import type { KickScope } from "../../ts/moderation-actions";

export type ClientDialog =
  | { kind: "nickname" }
  | { kind: "away" }
  | { kind: "talkRequest" }
  /** Anyone's description: our own, or another client's when permitted. */
  | { kind: "description"; clientId: number }
  // M2 moderation
  /** `channelId` preselects a destination (a drop on a channel with a password). */
  | { kind: "move"; clientId: number; channelId?: string }
  | { kind: "kick"; clientId: number; scope: KickScope }
  | { kind: "serverGroups"; clientId: number }
  | { kind: "channelGroup"; clientId: number }
  /** M2 bans (components/bans/). */
  | { kind: "ban"; clientId: number }
  | { kind: "banList" }
  // M2 admin tools (components/admin/). Targets travel by database id / UID,
  // so a dialog outlives its target leaving the server.
  | { kind: "complain"; dbId: string; nickname: string }
  | { kind: "complaints" }
  | { kind: "inbox" }
  /** `back`: reopen the inbox when done (compose was opened from it). */
  | { kind: "composeMessage"; uid?: string; nickname?: string; subject?: string; back?: "inbox" }
  | { kind: "clientDb" }
  | { kind: "tempPasswords" }
  // M4 server administration (components/server/).
  | { kind: "privilegeKeyUse" }
  | { kind: "privilegeKeys" }
  | { kind: "groups" }
  | { kind: "serverEdit" }
  | { kind: "serverLog" }
  /** Whose permissions, in which channel: by database id, so it outlives them leaving. */
  | { kind: "permOverview"; dbId: string; channelId: string; nickname: string };

const MODERATION_KINDS = ["move", "kick", "serverGroups", "channelGroup"] as const;

/** The M2 moderation dialogs, rendered by ModerationDialogsHost. */
export type ModerationDialog = Extract<ClientDialog, { kind: (typeof MODERATION_KINDS)[number] }>;

export function isModerationDialog(d: ClientDialog | null): d is ModerationDialog {
  return !!d && (MODERATION_KINDS as readonly string[]).includes(d.kind);
}

/**
 * The last branch of ClientDialogsHost: typed `never`, so a kind added to
 * ClientDialog without a branch there fails the typecheck instead of opening
 * nothing. Should one still get through, it says so and renders nothing.
 */
export function unhostedDialog(d: never): string {
  console.error("No host renders this client dialog:", d);
  return "";
}

export const clientDialog = shallowRef<ClientDialog | null>(null);

export function openClientDialog(dialog: ClientDialog): void {
  clientDialog.value = dialog;
}

export function closeClientDialog(): void {
  clientDialog.value = null;
}
