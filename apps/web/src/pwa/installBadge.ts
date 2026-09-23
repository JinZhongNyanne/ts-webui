/**
 * Keeps the installed app's icon badge in step with the chat store.
 *
 * Only the wiring lives here — the store, the browser's focus events and the
 * Badging API; what to count and when to clear is decided by the pure
 * functions in ./badge, which is where the tests are. Kept apart so that
 * testing those does not load the store and everything behind it.
 */
import { watch } from "vue";
import { useTsStore } from "../stores/ts";
import {
  applyBadge,
  badgeCount,
  INITIAL_BADGE_STATE,
  noteMessages,
  noteReturned,
  type AppBadgeTarget,
  type BadgeState,
} from "./badge";

/** No message yet: a value no real message id takes, so the first one registers. */
const NO_MESSAGE = 0;

/** Away unless the tab is showing and its window has the focus. */
function isAway(): boolean {
  return document.visibilityState !== "visible" || !document.hasFocus();
}

/**
 * Call once, after the app has mounted and Pinia is installed. Returns a
 * function that stops watching, which the app itself never needs.
 */
export function installAppBadge(): () => void {
  const target: AppBadgeTarget | undefined =
    typeof navigator === "undefined" ? undefined : navigator;
  const ts = useTsStore();
  let state: BadgeState = noteMessages(
    INITIAL_BADGE_STATE,
    ts.messages,
    ts.activeConversation,
    false,
  );
  let shown: number | null = null;
  let stopped = false;

  async function refresh(): Promise<void> {
    const count = badgeCount(ts.unread, state);
    if (stopped || count === shown) return;
    shown = count;
    // A browser without the API will not grow one mid-session: stop asking.
    if ((await applyBadge(target, count)) === "unsupported") stop();
  }

  function onReturn(): void {
    if (isAway()) return;
    state = noteReturned(state);
    void refresh();
  }

  const stopMessages = watch(
    () => ts.messages.at(-1)?.id ?? NO_MESSAGE,
    () => {
      state = noteMessages(state, ts.messages, ts.activeConversation, isAway());
      void refresh();
    },
  );
  // Unread counts change on their own too: opening a conversation clears one.
  const stopUnread = watch(
    () => badgeCount(ts.unread, INITIAL_BADGE_STATE),
    () => void refresh(),
  );
  window.addEventListener("focus", onReturn);
  document.addEventListener("visibilitychange", onReturn);

  function stop(): void {
    stopped = true;
    stopMessages();
    stopUnread();
    window.removeEventListener("focus", onReturn);
    document.removeEventListener("visibilitychange", onReturn);
  }

  // Straight away, which also clears a badge left on the icon by the last session.
  void refresh();
  return stop;
}
