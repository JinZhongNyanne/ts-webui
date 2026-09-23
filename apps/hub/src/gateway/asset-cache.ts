/**
 * Hub-wide cache of files downloaded from a TeamSpeak server's internal store
 * (icons, avatars). Shared by every session on the same server so a new browser
 * session does not re-download every icon: each download is a `ftinitdownload`
 * command, and a burst of them per connect is enough to trip the server's
 * anti-flood protection (which then silently drops the offending client).
 *
 * Bounded by entries and by bytes (HUB_ASSET_CACHE_MAX_BYTES): anyone can
 * put an avatar of the server's allowed size up, so a count alone would let
 * a few thousand of them fill the hub's memory for hours. Past either bound
 * the least recently used entry goes.
 */

interface Entry {
  data: Buffer | null;
  /** Epoch ms after which the entry is stale. */
  expires: number;
}

const HIT_TTL_MS = 6 * 60 * 60 * 1000; // icons rarely change
const MISS_TTL_MS = 10 * 60 * 1000; // a missing file may be uploaded later
const MAX_ENTRIES = 5000;
export const DEFAULT_ASSET_CACHE_BYTES = 64 * 1024 * 1024;

/** Keyed by server and path; Map order is recency (a hit moves to the end). */
const cache = new Map<string, Entry>();
let maxBytes = DEFAULT_ASSET_CACHE_BYTES;
let totalBytes = 0;

const keyOf = (serverKey: string, path: string) => `${serverKey}\n${path}`;
const sizeOf = (entry: Entry) => entry.data?.length ?? 0;

/** Sets the byte budget (HUB_ASSET_CACHE_MAX_BYTES), dropping what no longer fits. */
export function configureAssetCache(opts: { maxBytes: number }): void {
  maxBytes = opts.maxBytes;
  evictFor(0);
}

export function getCachedAsset(serverKey: string, path: string): Buffer | null | undefined {
  const key = keyOf(serverKey, path);
  const entry = cache.get(key);
  if (!entry) return undefined;
  remove(key);
  if (entry.expires < Date.now()) return undefined;
  cache.set(key, entry);
  totalBytes += sizeOf(entry);
  return entry.data;
}

/** Remembers a file (or its absence, `null`) for `ttlMs`, by default hours for a hit and minutes for a miss. */
export function setCachedAsset(
  serverKey: string,
  path: string,
  data: Buffer | null,
  ttlMs = data ? HIT_TTL_MS : MISS_TTL_MS,
): void {
  const key = keyOf(serverKey, path);
  remove(key);
  const entry: Entry = { data, expires: Date.now() + ttlMs };
  if (sizeOf(entry) > maxBytes) return;
  evictFor(sizeOf(entry));
  cache.set(key, entry);
  totalBytes += sizeOf(entry);
}

/** Drops one file (an icon uploaded or deleted through the hub) so it is fetched afresh. */
export function forgetCachedAsset(serverKey: string, path: string): void {
  remove(keyOf(serverKey, path));
}

/** Bytes held right now. */
export function assetCacheBytes(): number {
  return totalBytes;
}

/** Test helper. */
export function clearAssetCache(): void {
  cache.clear();
  totalBytes = 0;
}

function remove(key: string): void {
  const entry = cache.get(key);
  if (!entry) return;
  cache.delete(key);
  totalBytes -= sizeOf(entry);
}

/** Drops the oldest entries until one more of `incoming` bytes fits. */
function evictFor(incoming: number): void {
  for (const key of cache.keys()) {
    if (cache.size < MAX_ENTRIES && totalBytes + incoming <= maxBytes) return;
    remove(key);
  }
}
