/**
 * Channel subscription rules, as a TS3 server actually behaves (checked
 * against a live one):
 *
 *  - `notifychannelunsubscribed` comes alone. The server sends no left-view
 *    for the clients in that channel; it just stops telling us about them.
 *    Keeping them would leave ghosts whose moves, away flags and departures
 *    we never hear of, so they are dropped from the model right away.
 *  - Subscribing again replays them as enter-views (reasonid 2).
 *  - Joining a channel subscribes us to it with no notice at all, and the
 *    subscription outlives our leaving (the channel we connected into keeps
 *    reporting its clients after we move on). So a channel we are in, or
 *    were in, counts as subscribed although no notify said so.
 */
import type { TsClient } from "@jinz/protocol";

/**
 * The clients to forget when `channelId` is unsubscribed: everyone in it
 * except ourselves. Our own channel stays visible whatever the server is
 * told (it accepts the unsubscribe and keeps reporting the channel).
 */
export function clientsHiddenByUnsubscribe(
  clients: Iterable<TsClient>,
  channelId: string,
  selfId: number,
  selfChannelId: string | null,
): number[] {
  if (channelId === selfChannelId) return [];
  const out: number[] = [];
  for (const c of clients) {
    if (c.channelId === channelId && c.id !== selfId) out.push(c.id);
  }
  return out;
}

/** What the tree's `client.left` carries for a client hidden this way: TS3's "left view". */
export const REASON_LEFT_VIEW = 0;
