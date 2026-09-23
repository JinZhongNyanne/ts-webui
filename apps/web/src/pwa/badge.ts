/**
 * The installed app's icon badge: how many messages are waiting.
 *
 * The count is the chat's own unread counts, plus one thing the store does not
 * count: a message in the conversation that is already open. The store never
 * marks those unread, because the user is looking at them — but not if the app
 * is in the background, which is exactly when the badge is the only thing they
 * will see. So messages arriving in the open conversation while the app is
 * away are counted here, and forgotten as soon as the user comes back.
 *
 * Everything here is pure except `applyBadge`, which talks to the browser and,
 * like the service worker's registration, swallows every failure: the Badging
 * API is missing from most browsers, only works for an installed app in others,
 * and none of that is a reason for anything else to go wrong.
 */

/** The part of a chat message the badge cares about. */
export interface BadgeMessage {
  readonly id: number;
  readonly conversation: string;
  readonly self: boolean;
}

export interface BadgeState {
  /** The newest message id already looked at, so none is counted twice. */
  readonly lastSeenId: number;
  /** Messages in the open conversation that arrived while the app was away. */
  readonly missed: number;
}

/** Before any message: every message id is positive. */
export const INITIAL_BADGE_STATE: BadgeState = { lastSeenId: -1, missed: 0 };

/** What to show on the icon; zero means no badge at all. */
export function badgeCount(unread: ReadonlyMap<string, number>, state: BadgeState): number {
  let sum = wholeCount(state.missed);
  // Each count on its own: one bad entry must not blank out all the others.
  for (const n of unread.values()) sum += wholeCount(n);
  return sum;
}

/** A badge shows a whole, non-negative number, whatever the arithmetic produced. */
function wholeCount(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Moves the state on past `messages`, counting the new ones someone else sent
 * to the open conversation if the app is away. An empty history means the
 * store has been reset on disconnect, which clears its unread counts too.
 */
export function noteMessages(
  state: BadgeState,
  messages: readonly BadgeMessage[],
  activeConversation: string,
  away: boolean,
): BadgeState {
  if (messages.length === 0) return state.missed === 0 ? state : { ...state, missed: 0 };
  const fresh = messages.filter((m) => m.id > state.lastSeenId);
  if (fresh.length === 0) return state;
  const missedNow = away
    ? fresh.filter((m) => !m.self && m.conversation === activeConversation).length
    : 0;
  const lastSeenId = Math.max(state.lastSeenId, ...fresh.map((m) => m.id));
  return { lastSeenId, missed: state.missed + missedNow };
}

/** The user is back in front of the app, so the open conversation has been seen. */
export function noteReturned(state: BadgeState): BadgeState {
  return state.missed === 0 ? state : { ...state, missed: 0 };
}

/** The Badging API's two calls; either may be missing, as the whole API usually is. */
export interface AppBadgeTarget {
  setAppBadge?(contents?: number): Promise<void>;
  clearAppBadge?(): Promise<void>;
}

export type BadgeOutcome = "set" | "cleared" | "unsupported" | "failed";

export async function applyBadge(
  target: AppBadgeTarget | undefined,
  count: number,
  log: (message: string, detail?: unknown) => void = (message, detail) =>
    console.warn(message, detail),
): Promise<BadgeOutcome> {
  if (!target?.setAppBadge || !target.clearAppBadge) return "unsupported";
  try {
    // Inside the try: a call can reject later or throw at once (a
    // SecurityError outside a secure context does the latter).
    if (count > 0) {
      await target.setAppBadge(count);
      return "set";
    }
    await target.clearAppBadge();
    return "cleared";
  } catch (err) {
    log("[pwa] could not update the app badge", err);
    return "failed";
  }
}
