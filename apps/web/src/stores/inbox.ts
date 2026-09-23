/**
 * Our offline messages (the TeamSpeak inbox), so the unread count can show
 * outside the inbox window: on the server menu entry, and as one line in the
 * server chat after connecting.
 *
 * The server never pushes anything about offline messages (checked on a live
 * TS3 server: nothing arrives on connect, nor when one is sent to us while
 * online), so the list is fetched once per connect, whenever the inbox window
 * opens, and when the user comes back to the tab after a while away (at most
 * every 10 minutes, see ts/inbox-recheck.ts); the window's own actions patch it here.
 */
import { computed, shallowRef } from "vue";
import { defineStore } from "pinia";
import { listOfflineMessages, namesFromUids } from "../ts/admin-actions";
import { unreadCount, type OfflineMessageHead } from "../ts/admin-rows";
import { InboxRecheck } from "../ts/inbox-recheck";

export const useInboxStore = defineStore("inbox", () => {
  const messages = shallowRef<readonly OfflineMessageHead[]>([]);
  /** Last nickname per sender UID, as far as we have asked. */
  const names = shallowRef<Readonly<Record<string, string>>>({});
  /**
   * Bumped by reset(): an answer that arrives after a disconnect belongs to
   * the old session (maybe another server) and is dropped.
   */
  let generation = 0;
  const recheck = new InboxRecheck();

  async function refresh(): Promise<void> {
    const gen = generation;
    // Counted when asked, not when answered: a failure must not bring a retry.
    recheck.checked(Date.now());
    const list = await listOfflineMessages();
    if (gen === generation) messages.value = list;
  }

  function markRead(id: string): void {
    messages.value = messages.value.map((m) => (m.id === id ? { ...m, read: true } : m));
  }

  function remove(id: string): void {
    messages.value = messages.value.filter((m) => m.id !== id);
  }

  /** UIDs a lookup is under way for, so a second call does not ask again. */
  let asking: ReadonlySet<string> = new Set<string>();

  /**
   * Looks up the senders we have no name for yet, all in one command
   * (namesFromUids). A failure just leaves the UIDs showing, and forgets
   * them, so a later call may try again.
   */
  async function resolveNames(uids: readonly string[]): Promise<void> {
    const gen = generation;
    const wanted = [...new Set(uids)].filter((u) => u && !(u in names.value) && !asking.has(u));
    if (wanted.length === 0) return;
    asking = new Set([...asking, ...wanted]);
    try {
      const found = await namesFromUids(wanted);
      if (gen !== generation) return;
      const resolved = Object.fromEntries(wanted.map((u) => [u, found[u] ?? ""]));
      names.value = { ...names.value, ...resolved };
    } catch {
      // Left showing as UIDs.
    } finally {
      asking = new Set([...asking].filter((u) => !wanted.includes(u)));
    }
  }

  /** The tab was hidden or lost focus. */
  function noteAway(): void {
    recheck.away(Date.now());
  }

  /** The tab is back; true when the list is worth fetching again. */
  function recheckDue(): boolean {
    return recheck.back(Date.now());
  }

  function reset(): void {
    generation++;
    recheck.reset();
    messages.value = [];
    names.value = {};
    asking = new Set();
  }

  return {
    messages: computed(() => messages.value),
    names: computed(() => names.value),
    unread: computed(() => unreadCount(messages.value)),
    refresh,
    markRead,
    remove,
    resolveNames,
    noteAway,
    recheckDue,
    reset,
  };
});
