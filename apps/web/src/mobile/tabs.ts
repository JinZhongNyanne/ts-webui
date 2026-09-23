/**
 * Which views the mobile tab bar offers, and what the badges add up to.
 *
 * The mobile shell shows one view at a time, so it only ever needs a subset
 * of the desktop's windows (no apps, sounds, files or info tab), in its own
 * order. But `tree` and `chat` are unconditional and `video`/`music` gate on
 * the exact same `HubFeatures` flags as the desktop, so this derives its list
 * from `../dock/windowMeta`'s `availableWindows` rather than re-deciding the
 * gating here — see that file's doc comment for the other half of this pair.
 */

import { availableWindows } from "../dock/windowMeta";

/** A view the mobile shell can show. Each one wraps an existing dock panel. */
export type MobileTabId = "tree" | "chat" | "video" | "music";

/** The optional panels, on the same conditions the dock uses. */
export interface MobileTabFeatures {
  /** The hub reached a music bot, or the user named one. */
  readonly music: boolean;
  /** The hub offers video. */
  readonly video: boolean;
}

/** Tab order, left to right; the optional ones drop out when unavailable. */
const ORDER: readonly MobileTabId[] = ["tree", "chat", "video", "music"];

/** The tabs to render, in bar order. */
export function visibleTabs(features: MobileTabFeatures): MobileTabId[] {
  // Mobile has no files window, but `availableWindows` needs the field.
  const offered = new Set(availableWindows({ ...features, files: false }));
  return ORDER.filter((id) => offered.has(id));
}

/**
 * The tab to show now.
 *
 * A music bot can go away mid-session, taking its tab with it; rather than
 * leave the shell on a view that is no longer offered, fall back to the channel
 * tree, which is always there.
 */
export function resolveTab(current: MobileTabId, visible: readonly MobileTabId[]): MobileTabId {
  return visible.includes(current) ? current : "tree";
}

/** Unread messages across every conversation, for the chat tab's badge. */
export function totalUnread(unread: ReadonlyMap<string, number>): number {
  let sum = 0;
  for (const n of unread.values()) sum += n;
  return sum;
}
