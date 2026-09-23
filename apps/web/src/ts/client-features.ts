/**
 * Rules behind the M1 self-service features (nickname, away message, client
 * description, talk power requests, channel subscriptions) that do not need
 * Vue, so they can be tested on plain node.
 *
 * The length limits are TeamSpeak's own; the hub's `ts.cmd` schemas enforce
 * the same numbers, so a field that passes here is never refused as too long.
 */
import type { TsChannel, TsClient } from "@jinz/protocol";

export const NICKNAME_MIN = 3;
export const NICKNAME_MAX = 30;
export const AWAY_MESSAGE_MAX = 80;
export const DESCRIPTION_MAX = 200;
export const TALK_REQUEST_MAX = 50;

type TalkState = Pick<TsClient, "talkPower" | "isTalker">;

/**
 * Whether `client` would be silenced in `channel`: the channel asks for more
 * talk power than they have, and nobody made them a talker. The server
 * refuses a talk request (1538 "invalid parameter") in a channel that asks
 * for none, so only then is "request talk power" worth offering.
 */
export function needsTalkPower(
  client: TalkState,
  channel: Pick<TsChannel, "neededTalkPower">,
): boolean {
  if (client.isTalker) return false;
  return channel.neededTalkPower > 0 && client.talkPower < channel.neededTalkPower;
}

/**
 * Whether we see who is in `channel`. The channel we are in always reports
 * its clients, whatever its subscription says (see the hub's subscriptions.ts).
 */
export function isChannelVisible(
  channel: Pick<TsChannel, "id" | "subscribed">,
  selfChannelId: string | null | undefined,
): boolean {
  return channel.subscribed || channel.id === selfChannelId;
}

/**
 * `ts.cmd` takes at most 100 channels per call (one row each), so larger
 * lists go out in several calls.
 */
export const SUBSCRIBE_BATCH = 100;

export function batches<T>(items: readonly T[], size = SUBSCRIBE_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
