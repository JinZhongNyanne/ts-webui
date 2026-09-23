/**
 * Pure helpers behind the reconnect path.
 *
 * Kept free of Pinia and of the hub link so they can be reasoned about (and
 * tested) on their own; the store owns the state machine that uses them.
 */
import type { ConnectRequest, TsChannel } from "@jinz/protocol";

/** Depth ceiling: a malformed tree must not spin the walk forever. */
const MAX_DEPTH = 64;

/**
 * The `client_default_channel` path for a channel, as the TeamSpeak handshake
 * wants it: ancestor names outermost first, joined with "/". A "/" inside a
 * name is escaped, so "Rock/Pop" stays one path segment.
 *
 * Returns "" when the channel is unknown, which callers read as "no preference"
 * and fall back to the connect profile's configured default.
 */
export function channelPath(channels: ReadonlyMap<string, TsChannel>, channelId: string): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  let id = channelId;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const ch = channels.get(id);
    if (!ch || seen.has(id)) break;
    seen.add(id);
    parts.push(ch.name.replaceAll("/", "\\/"));
    id = ch.parentId;
  }
  return parts.reverse().join("/");
}

/** How many times a TeamSpeak-side drop is retried before the banner takes over. */
export const RETRY_ATTEMPTS = 3;

/** Nominal waits: 2s, 4s, 8s. Jitter spreads a server restart's thundering herd. */
const RETRY_BASE_MS = 2_000;

/**
 * Wait before retry number `attempt` (0-based), or null once the budget is
 * spent. Full jitter over the nominal ceiling, so the delay only ever shortens.
 */
export function retryDelayMs(attempt: number): number | null {
  if (attempt < 0 || attempt >= RETRY_ATTEMPTS) return null;
  const ceiling = RETRY_BASE_MS * 2 ** attempt;
  return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
}

/** The channel we were actually sitting in, snapshotted before the tree is cleared. */
export interface LiveChannel {
  /** `channelPath()` of that channel; "" when it could not be resolved. */
  path: string;
  /** The password we joined it with, or "" for an open channel. */
  password: string;
}

/**
 * The connect request to replay, aimed at the channel the user was in rather
 * than the profile's configured default. Returns a new object; the request it
 * is given is left untouched.
 */
export function buildReplayRequest(base: ConnectRequest, live: LiveChannel | null): ConnectRequest {
  if (!live?.path) return { ...base };
  return {
    ...base,
    defaultChannel: live.path,
    // A stale password from the profile must not follow us into a channel that
    // does not want one, so this is set from the live channel or not at all.
    defaultChannelPassword: live.password || undefined,
  };
}

export interface RetrySchedulerOptions {
  /** Run one reconnect attempt. */
  onRetry(): void;
  setTimer(fn: () => void, ms: number): number;
  clearTimer(id: number): void;
  /** Overridable for tests; defaults to the jittered 2s/4s/8s ladder. */
  delayMs?(attempt: number): number | null;
}

/**
 * Bounded auto-retry for a TeamSpeak-side drop: a few attempts on a widening
 * delay, then it gives up and leaves the reconnect banner to the user.
 *
 * Deliberately free of `window`, so the store can inject real timers and tests
 * can inject fake ones.
 */
export class RetryScheduler {
  private timer: number | null = null;
  private used = 0;

  constructor(private readonly o: RetrySchedulerOptions) {}

  /** Attempts spent so far (counted when scheduled, not when they land). */
  get attempt(): number {
    return this.used;
  }

  get pending(): boolean {
    return this.timer !== null;
  }

  get exhausted(): boolean {
    return this.delayFor(this.used) === null;
  }

  /** Queues the next attempt. False means the budget is spent — show the banner. */
  schedule(): boolean {
    // A retry already in flight is the one we are waiting for; stacking a
    // second timer would burn the budget in a burst.
    if (this.timer !== null) return true;
    const wait = this.delayFor(this.used);
    if (wait === null) return false;
    this.used++;
    this.timer = this.o.setTimer(() => {
      this.timer = null;
      this.o.onRetry();
    }, wait);
    return true;
  }

  /** Drops a pending attempt but keeps the budget (e.g. the user took over). */
  cancel(): void {
    if (this.timer !== null) this.o.clearTimer(this.timer);
    this.timer = null;
  }

  /** Back to a full budget: call once a connection has actually succeeded. */
  reset(): void {
    this.cancel();
    this.used = 0;
  }

  private delayFor(attempt: number): number | null {
    return (this.o.delayMs ?? retryDelayMs)(attempt);
  }
}
