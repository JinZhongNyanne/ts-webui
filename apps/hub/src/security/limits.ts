/**
 * In-memory rate and concurrency limits.
 *
 * The hub spends other people's resources on request — a TTS synthesis at
 * Microsoft, a REST call at the music bot, a TeamSpeak connect — so every
 * entry point that does needs a ceiling. One hub serves a handful of people,
 * so per-process counters are enough; nothing here needs to survive a restart.
 */

interface Bucket {
  tokens: number;
  at: number;
}

export interface RateLimitOptions {
  /** Requests allowed per window (0 disables the limiter entirely). */
  limit: number;
  windowMs: number;
  /** Keys to track before the idle ones are swept. */
  maxKeys?: number;
}

/**
 * Token bucket per key: `limit` requests per window, refilled continuously so a
 * caller that stays under the average is never blocked by a burst it made a
 * minute ago.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxKeys: number;

  constructor(private readonly opts: RateLimitOptions) {
    this.maxKeys = opts.maxKeys ?? 5_000;
  }

  get enabled(): boolean {
    return this.opts.limit > 0;
  }

  /** Spends one token for `key`; false means the caller is over its limit. */
  take(key: string, now = Date.now()): boolean {
    if (!this.enabled) return true;
    const bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.maxKeys) this.sweep(now);
      this.buckets.set(key, { tokens: this.opts.limit - 1, at: now });
      return true;
    }
    const refill = ((now - bucket.at) / this.opts.windowMs) * this.opts.limit;
    bucket.tokens = Math.min(this.opts.limit, bucket.tokens + Math.max(0, refill));
    bucket.at = now;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  /** Forgets keys that have refilled completely; they cost nothing to recreate. */
  sweep(now = Date.now()): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.at >= this.opts.windowMs) this.buckets.delete(key);
    }
    // Still full after a sweep: drop the oldest entries rather than grow forever.
    if (this.buckets.size >= this.maxKeys) {
      const excess = this.buckets.size - Math.floor(this.maxKeys / 2);
      let dropped = 0;
      for (const key of this.buckets.keys()) {
        if (dropped++ >= excess) break;
        this.buckets.delete(key);
      }
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}

/** Counts live things (websocket sessions) per key against a ceiling. */
export class ConcurrencyLimiter {
  private readonly counts = new Map<string, number>();

  constructor(private readonly limit: number) {}

  /** Reserves a slot; false means `key` is already at the ceiling. */
  acquire(key: string): boolean {
    if (this.limit <= 0) return true;
    const current = this.counts.get(key) ?? 0;
    if (current >= this.limit) return false;
    this.counts.set(key, current + 1);
    return true;
  }

  release(key: string): void {
    const current = this.counts.get(key);
    if (current === undefined) return;
    if (current <= 1) this.counts.delete(key);
    else this.counts.set(key, current - 1);
  }

  count(key: string): number {
    return this.counts.get(key) ?? 0;
  }
}
