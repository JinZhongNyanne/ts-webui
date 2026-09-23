/**
 * The M2 channel actions, each an allow-listed `ts.cmd` (see commands.ts).
 * Every function rejects with a TsCommandError whose message is ready to show.
 * The tree changes the usual way afterwards, from the server's notifies
 * (channel.added / channel.updated / channel.removed), so nothing here
 * patches the store.
 */
import type { TsCmdArgs } from "@jinz/protocol";
import { tsCommand } from "./commands";
import type { ChannelDropPlan } from "./channel-drop";
import type { IconChange } from "./channel-form";

/** TeamSpeak's "channel not empty": a delete without force hit clients or subchannels. */
export const TS_CHANNEL_NOT_EMPTY = "772";

export async function createChannel(args: TsCmdArgs<"channelcreate">): Promise<void> {
  await tsCommand("channelcreate", args);
}

export async function editChannel(args: TsCmdArgs<"channeledit">): Promise<void> {
  await tsCommand("channeledit", args);
}

export async function deleteChannel(cid: string, force: boolean): Promise<void> {
  await tsCommand("channeldelete", { cid, force });
}

/** Another parent is a `channelmove`; a new place among the same siblings is an edit. */
export async function placeChannel(plan: ChannelDropPlan): Promise<void> {
  if (plan.kind === "move") {
    await tsCommand("channelmove", { cid: plan.cid, cpid: plan.cpid, order: plan.order });
  } else {
    await tsCommand("channeledit", { cid: plan.cid, channel_order: plan.order });
  }
}

/** The icon is the channel permission `i_icon_id`, not a channel property. */
export async function setChannelIcon(cid: string, change: IconChange): Promise<void> {
  if (change.kind === "set") {
    await tsCommand("channeladdperm", { cid, permsid: "i_icon_id", permvalue: change.iconId });
  } else {
    await tsCommand("channeldelperm", { cid, permsid: "i_icon_id" });
  }
}
