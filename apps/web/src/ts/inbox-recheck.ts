/**
 * When to look at the offline message list again. The server never says a
 * new one arrived (see stores/inbox.ts), so a tab left open for hours would
 * keep showing the count from when it connected.
 *
 * Asking is one `messagelist` through the hub-wide command budget, which every
 * web user shares (one address to the server). So it is only asked when the
 * user comes back to the tab after a while away — the moment a new count is
 * worth seeing — and at most once per INBOX_RECHECK_GAP_MS per session, which
 * even with every user switching tabs all day stays far under the budget.
 */

/** How long the tab must have been hidden or unfocused. */
export const INBOX_RECHECK_AWAY_MS = 5 * 60_000;
/** The least time between two looks at the list (any look: connect, inbox window, recheck). */
export const INBOX_RECHECK_GAP_MS = 10 * 60_000;

export class InboxRecheck {
  private awaySince: number | null = null;
  private lastCheck: number | null = null;

  /** The list was fetched (connect, the inbox window, a recheck). */
  checked(now: number): void {
    this.lastCheck = now;
  }

  /** The tab was hidden or lost focus; the first of several counts. */
  away(now: number): void {
    this.awaySince ??= now;
  }

  /** The tab is back in front. True when the list should be fetched again. */
  back(now: number): boolean {
    const since = this.awaySince;
    this.awaySince = null;
    if (since === null || this.lastCheck === null) return false;
    return now - since >= INBOX_RECHECK_AWAY_MS && now - this.lastCheck >= INBOX_RECHECK_GAP_MS;
  }

  /** Disconnected: the next session starts with its own connect-time check. */
  reset(): void {
    this.awaySince = null;
    this.lastCheck = null;
  }
}
