/**
 * Tiny LRU for proxied album covers.
 *
 * A queue of forty rows re-renders its `<img>` tags on every state push, so
 * without a cache one playlist would mean a burst of outbound requests per
 * update. The gateway's asset cache is keyed by TeamSpeak server and file
 * path and never accounts for bytes, so covers get their own store: keyed by
 * the upstream URL, capped by entry count and by total size.
 */

export interface CachedCover {
  readonly contentType: string;
  readonly body: Buffer;
}

export interface CoverCacheOptions {
  readonly maxEntries?: number;
  readonly maxBytes?: number;
  readonly ttlMs?: number;
}

interface Entry {
  readonly cover: CachedCover;
  readonly expires: number;
}

const DEFAULTS = {
  maxEntries: 64,
  maxBytes: 16 * 1024 * 1024,
  ttlMs: 60 * 60 * 1000,
} as const;

/** Insertion-ordered Map used as an LRU: a hit re-inserts, eviction takes the head. */
export class CoverCache {
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly ttlMs: number;

  constructor(opts: CoverCacheOptions = {}) {
    this.maxEntries = opts.maxEntries ?? DEFAULTS.maxEntries;
    this.maxBytes = opts.maxBytes ?? DEFAULTS.maxBytes;
    this.ttlMs = opts.ttlMs ?? DEFAULTS.ttlMs;
  }

  get(key: string, now = Date.now()): CachedCover | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= now) {
      this.drop(key);
      return undefined;
    }
    // Re-insert so the freshly used entry is the youngest again.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.cover;
  }

  set(key: string, cover: CachedCover, now = Date.now()): void {
    if (cover.body.byteLength > this.maxBytes) return; // never worth evicting everything for
    this.drop(key);
    this.entries.set(key, { cover, expires: now + this.ttlMs });
    this.bytes += cover.body.byteLength;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.drop(oldest.value);
    }
  }

  private drop(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.bytes -= entry.cover.body.byteLength;
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
}
