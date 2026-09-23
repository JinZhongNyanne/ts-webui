/**
 * The `blob:` URLs of images previewed in chat, so a re-render (or scrolling
 * back) does not fetch the same picture again.
 *
 * They are whole images held in memory, so the cache is bounded by their
 * bytes and the oldest ones are revoked first. It is also dropped whenever
 * the page connects again: the key is a channel and a path, which stand for
 * different files on a different server (or after someone replaced one).
 */
export interface PreviewCache {
  get(key: string): string | undefined;
  /** Keeps `url` (bytes of the image behind it), revoking what no longer fits. */
  put(key: string, url: string, bytes: number): void;
  clear(): void;
  /** Bytes held, for tests. */
  readonly size: number;
}

interface Entry {
  readonly url: string;
  readonly bytes: number;
}

export function createPreviewCache(
  maxBytes: number,
  revoke: (url: string) => void = URL.revokeObjectURL,
): PreviewCache {
  // Insertion order is eviction order (a preview is shown once, then kept).
  const entries = new Map<string, Entry>();
  let held = 0;

  function drop(key: string): void {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    held -= entry.bytes;
    revoke(entry.url);
  }

  return {
    get: (key) => entries.get(key)?.url,
    put(key, url, bytes) {
      drop(key);
      if (bytes > maxBytes) {
        revoke(url);
        return;
      }
      entries.set(key, { url, bytes });
      held += bytes;
      for (const oldest of [...entries.keys()]) {
        if (held <= maxBytes) break;
        if (oldest !== key) drop(oldest);
      }
    },
    clear() {
      for (const key of [...entries.keys()]) drop(key);
    },
    get size() {
      return held;
    },
  };
}
