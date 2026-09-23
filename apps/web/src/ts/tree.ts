import type { TsChannel, TsClient } from "@jinz/protocol";

export interface ChannelNode {
  channel: TsChannel;
  depth: number;
  children: ChannelNode[];
  clients: TsClient[];
}

/**
 * TeamSpeak orders siblings as a linked list: `order` is the id of the
 * previous sibling ("0" = first). Broken chains fall back to name order.
 */
export function sortSiblings(siblings: TsChannel[]): TsChannel[] {
  const byOrder = new Map<string, TsChannel[]>();
  for (const ch of siblings) {
    const list = byOrder.get(ch.order) ?? [];
    list.push(ch);
    byOrder.set(ch.order, list);
  }
  const out: TsChannel[] = [];
  const seen = new Set<string>();
  let cursor = "0";
  while (true) {
    const next = byOrder.get(cursor)?.find((c) => !seen.has(c.id));
    if (!next) break;
    out.push(next);
    seen.add(next.id);
    cursor = next.id;
  }
  const leftovers = siblings
    .filter((c) => !seen.has(c.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...out, ...leftovers];
}

export function sortClients(clients: TsClient[]): TsClient[] {
  return [...clients].sort((a, b) => {
    if (a.talkPower !== b.talkPower) return b.talkPower - a.talkPower;
    return a.nickname.localeCompare(b.nickname);
  });
}

export function buildTree(
  channels: Iterable<TsChannel>,
  clients: Iterable<TsClient>,
): ChannelNode[] {
  const byParent = new Map<string, TsChannel[]>();
  const all = new Map<string, TsChannel>();
  for (const ch of channels) {
    all.set(ch.id, ch);
    const list = byParent.get(ch.parentId) ?? [];
    list.push(ch);
    byParent.set(ch.parentId, list);
  }
  const clientsByChannel = new Map<string, TsClient[]>();
  for (const c of clients) {
    const list = clientsByChannel.get(c.channelId) ?? [];
    list.push(c);
    clientsByChannel.set(c.channelId, list);
  }

  const build = (parentId: string, depth: number): ChannelNode[] =>
    sortSiblings(byParent.get(parentId) ?? []).map((channel) => ({
      channel,
      depth,
      children: build(channel.id, depth + 1),
      clients: sortClients(clientsByChannel.get(channel.id) ?? []),
    }));

  // Root = channels whose parent does not exist (normally "0").
  const roots = [...all.values()].filter((c) => !all.has(c.parentId));
  const rootParents = new Set(roots.map((c) => c.parentId));
  const nodes: ChannelNode[] = [];
  for (const pid of rootParents) nodes.push(...build(pid, 0));
  return nodes;
}
