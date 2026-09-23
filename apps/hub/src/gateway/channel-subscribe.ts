/**
 * A channel created after we connected is not subscribed: `channelsubscribeall`
 * only covers the channels that existed then (checked on a live TS3 server:
 * a client moved into a fresh channel left our view). Without a subscription
 * the tree cannot show who is inside, and a delete cannot say so either.
 *
 * So a new channel inherits the subscription of where it appears: under a
 * subscribed parent, or at the top level while every channel is subscribed
 * (the "subscribe to all" mode). Someone who unsubscribed on purpose keeps it
 * that way.
 */

interface Subscribable {
  readonly id: string;
  readonly parentId: string;
  readonly subscribed: boolean;
}

export function subscribeNewChannel(channels: Iterable<Subscribable>, parentId: string): boolean {
  const list = [...channels];
  if (parentId === "0") return list.length > 0 && list.every((c) => c.subscribed);
  return list.find((c) => c.id === parentId)?.subscribed ?? false;
}
