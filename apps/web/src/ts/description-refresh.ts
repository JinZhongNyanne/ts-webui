/**
 * What the page does when the hub says a channel description changed
 * (`channel.descriptionChanged`; the server does not say to what).
 *
 * The hub no longer fetches the new text for every session: all of them
 * asking at once, from the hub's one address, is how TeamSpeak's anti-flood
 * bans every web user together. The page forgets its copy and asks again
 * only if the description is on screen, and only once the edits have
 * settled: someone saving five times in a row costs one fetch, not five.
 */

/** Quiet time after the last change before a shown description is fetched again. */
export const DESCRIPTION_REFRESH_MS = 1_000;

export interface DescriptionRefreshOptions {
  /** Whether the channel's description is on screen right now. */
  isShown: (channelId: string) => boolean;
  request: (channelId: string) => void;
}

export class DescriptionRefresh {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly opts: DescriptionRefreshOptions) {}

  changed(channelId: string): void {
    const pending = this.timers.get(channelId);
    if (pending) clearTimeout(pending);
    const timer = setTimeout(() => {
      this.timers = new Map([...this.timers].filter(([id]) => id !== channelId));
      if (this.opts.isShown(channelId)) this.opts.request(channelId);
    }, DESCRIPTION_REFRESH_MS);
    this.timers = new Map([...this.timers, [channelId, timer]]);
  }

  cancelAll(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers = new Map();
  }
}
