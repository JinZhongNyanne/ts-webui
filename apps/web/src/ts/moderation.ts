/**
 * Plain helpers behind the M2 moderation dialogs and the tree's drag and drop,
 * kept free of stores and components so they are easy to test.
 */
import type { TsChannel, TsClient, TsGroup } from "@jinz/protocol";
import { displayChannelName, parseSpacer } from "./format";
import type { ChannelNode } from "./tree";

/**
 * The groups a client can be put in: regular ones (type 1), in the order the
 * server displays them. Templates (0) and ServerQuery groups (2) never apply
 * to a voice client.
 */
export function assignableGroups(groups: Iterable<TsGroup>): TsGroup[] {
  return [...groups]
    .filter((g) => g.type === 1)
    .sort((a, b) => a.sortId - b.sortId || Number(a.id) - Number(b.id));
}

export interface ChannelPickerRow {
  channel: TsChannel;
  depth: number;
}

/**
 * The channel tree as a flat list for the "move to…" picker, in tree order,
 * filtered by name. Spacers are decoration, not destinations.
 */
export function channelPickerRows(tree: readonly ChannelNode[], query: string): ChannelPickerRow[] {
  const needle = query.trim().toLowerCase();
  const out: ChannelPickerRow[] = [];
  const walk = (nodes: readonly ChannelNode[]) => {
    for (const n of nodes) {
      const ch = n.channel;
      const name = displayChannelName(ch.name, ch.parentId).toLowerCase();
      if (!parseSpacer(ch.name, ch.parentId) && (!needle || name.includes(needle))) {
        out.push({ channel: ch, depth: n.depth });
      }
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}

/**
 * The picker row an arrow key lands on: one step from `current` (from outside
 * the list, the first row going down or the last going up), stopping at the
 * ends and skipping `skip` (the channel the client is already in).
 */
export function stepPick(
  ids: readonly string[],
  current: string | null,
  delta: 1 | -1,
  skip?: string,
): string | null {
  const pickable = ids.filter((id) => id !== skip);
  if (!pickable.length) return null;
  const at = current === null ? -1 : pickable.indexOf(current);
  if (at < 0) return delta > 0 ? pickable[0]! : pickable[pickable.length - 1]!;
  return pickable[Math.min(pickable.length - 1, Math.max(0, at + delta))]!;
}

/**
 * What dropping a dragged client on a channel row does: we join (with the
 * tree's own password prompt), someone else is moved straight away, or, into a
 * channel with a password, the move dialog opens for it. `canMove` is the
 * menu's gate on i_client_move_power.
 */
export type DropDecision = "none" | "join" | "move" | "dialog";

export function dropDecision(
  client: Pick<TsClient, "isSelf" | "channelId">,
  target: TsChannel,
  canMove: boolean,
): DropDecision {
  if (client.channelId === target.id) return "none";
  if (client.isSelf) return "join";
  if (!canMove) return "none";
  return target.flags.password ? "dialog" : "move";
}
