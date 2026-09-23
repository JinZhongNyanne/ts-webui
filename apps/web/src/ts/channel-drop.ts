/**
 * Where a dragged channel ends up, as the command that puts it there.
 *
 * TeamSpeak places a channel by parent and predecessor (`order` = the id of
 * the sibling above it, "0" = first). A live TS3 server refuses `channelmove`
 * to the parent a channel already has (770 "already member of channel"), so a
 * drop among the same siblings becomes `channeledit channel_order` (kind
 * "reorder") and only a new parent is a `channelmove` (kind "move"). A move
 * without `order` lands first, so "append" always names the last sibling.
 *
 * Pure, so the rules are tested without a DOM (see useChannelDrag.ts).
 */

export interface ChannelPlace {
  readonly id: string;
  readonly parentId: string;
  readonly order: string;
}

/** Top quarter: above the row; bottom quarter: below it; the rest: into it. */
export type DropPosition = "before" | "inside" | "after";

export type ChannelDropPlan =
  | { readonly kind: "move"; readonly cid: string; readonly cpid: string; readonly order: string }
  | { readonly kind: "reorder"; readonly cid: string; readonly order: string };

const EDGE = 0.25;

/**
 * The drop position for a pointer `offsetY` pixels into a row `height` tall.
 * `allowAfter` is false for an expanded parent: "after" places a channel
 * after the whole subtree, which is drawn below the row, so its bottom edge
 * counts as "inside" instead of promising a spot it does not mean.
 */
export function dropPositionAt(offsetY: number, height: number, allowAfter = true): DropPosition {
  if (height <= 0) return "inside";
  const f = offsetY / height;
  if (f < EDGE) return "before";
  if (f > 1 - EDGE && allowAfter) return "after";
  return "inside";
}

/** Is `id` the channel `root` or anywhere below it? */
export function isInSubtree(
  channels: ReadonlyMap<string, ChannelPlace>,
  id: string,
  root: string,
): boolean {
  let cursor: string | undefined = id;
  const seen = new Set<string>();
  while (cursor && cursor !== "0" && !seen.has(cursor)) {
    if (cursor === root) return true;
    seen.add(cursor);
    cursor = channels.get(cursor)?.parentId;
  }
  return false;
}

/** The last channel of `parentId`'s sibling chain, leaving out `except`; "0" when there is none. */
function lastChild(
  channels: ReadonlyMap<string, ChannelPlace>,
  parentId: string,
  except: string,
): string {
  const siblings = [...channels.values()].filter((c) => c.parentId === parentId && c.id !== except);
  if (siblings.length === 0) return "0";
  // Walk the chain as it will be once `except` has left it.
  const leaving = channels.get(except);
  const prevOf = (c: ChannelPlace) =>
    leaving && leaving.parentId === parentId && c.order === except ? leaving.order : c.order;
  let cursor = "0";
  const seen = new Set<string>();
  for (;;) {
    const next = siblings.find((c) => prevOf(c) === cursor && !seen.has(c.id));
    if (!next) break;
    seen.add(next.id);
    cursor = next.id;
  }
  return cursor !== "0" ? cursor : siblings[siblings.length - 1]!.id;
}

/**
 * The command for dropping `dragId` on `targetId` (null = the server row,
 * i.e. top level) at `position`, or null when the drop would change nothing
 * or is impossible (into itself or one of its own subchannels).
 */
export function planChannelDrop(
  channels: ReadonlyMap<string, ChannelPlace>,
  dragId: string,
  targetId: string | null,
  position: DropPosition,
): ChannelDropPlan | null {
  const drag = channels.get(dragId);
  if (!drag || dragId === targetId) return null;
  let parentId: string;
  let order: string;
  if (targetId === null) {
    parentId = "0";
    order = lastChild(channels, "0", dragId);
  } else {
    const target = channels.get(targetId);
    if (!target) return null;
    if (position === "inside") {
      parentId = target.id;
      order = lastChild(channels, target.id, dragId);
    } else {
      parentId = target.parentId;
      order = position === "after" ? target.id : target.order;
    }
  }
  return planChannelPlace(channels, dragId, parentId, order);
}

/**
 * The command that puts `id` under `parentId` ("0" = top level) right after
 * `order` (a channel under that parent, "0" = first); null when it would
 * change nothing or is impossible. What a drop resolves to, and what the
 * "Move channel…" dialog picks directly.
 */
export function planChannelPlace(
  channels: ReadonlyMap<string, ChannelPlace>,
  id: string,
  parentId: string,
  order: string,
): ChannelDropPlan | null {
  const drag = channels.get(id);
  if (!drag) return null;
  if (parentId !== "0" && !channels.has(parentId)) return null;
  if (order !== "0" && channels.get(order)?.parentId !== parentId) return null;
  if (order === id) return null; // right above its own successor: already there
  if (parentId !== "0" && isInSubtree(channels, parentId, id)) return null;
  if (parentId === drag.parentId) {
    return order === drag.order ? null : { kind: "reorder", cid: id, order };
  }
  return { kind: "move", cid: id, cpid: parentId, order };
}
