/**
 * Keeps the sibling chain intact when channels come, go and move.
 *
 * TeamSpeak orders siblings as a linked list (`order` = the id of the channel
 * above, "0" = first), and a live server does NOT tell anyone when a
 * neighbour's link changes: creating C after A silently makes B (which
 * followed A) follow C; moving or deleting B silently makes C follow A.
 * Clients are expected to relink themselves, as the native one does. These
 * functions return the fixes as `{ id, order }` pairs; nothing is mutated.
 */

export interface ChannelPlace {
  readonly id: string;
  readonly parentId: string;
  readonly order: string;
}

export interface OrderFix {
  readonly id: string;
  readonly order: string;
}

const siblingsOf = (channels: Iterable<ChannelPlace>, ch: ChannelPlace) =>
  [...channels].filter((c) => c.parentId === ch.parentId && c.id !== ch.id);

/** `ch` leaves its place (moved away or deleted): whoever followed it follows its predecessor. */
export function relinkOnLeave(channels: Iterable<ChannelPlace>, ch: ChannelPlace): OrderFix[] {
  return siblingsOf(channels, ch)
    .filter((c) => c.order === ch.id)
    .map((c) => ({ id: c.id, order: ch.order }));
}

/** `ch` takes a place (created or moved there): whoever held that place now follows `ch`. */
export function relinkOnEnter(channels: Iterable<ChannelPlace>, ch: ChannelPlace): OrderFix[] {
  return siblingsOf(channels, ch)
    .filter((c) => c.order === ch.order)
    .map((c) => ({ id: c.id, order: ch.id }));
}

/** `before` → `after` for one channel: close the gap, then open the new place. */
export function relinkOnMove(
  channels: Iterable<ChannelPlace>,
  before: ChannelPlace,
  after: ChannelPlace,
): OrderFix[] {
  if (before.parentId === after.parentId && before.order === after.order) return [];
  const others = [...channels].filter((c) => c.id !== before.id);
  const leave = relinkOnLeave(others, before);
  const fixed = others.map((c) => {
    const fix = leave.find((f) => f.id === c.id);
    return fix ? { ...c, order: fix.order } : c;
  });
  const enter = relinkOnEnter(fixed, after);
  // A channel fixed twice keeps the later value.
  const merged = new Map<string, string>();
  for (const f of [...leave, ...enter]) merged.set(f.id, f.order);
  return [...merged].map(([id, order]) => ({ id, order }));
}
