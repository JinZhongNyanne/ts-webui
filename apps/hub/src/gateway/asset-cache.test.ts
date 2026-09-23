import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assetCacheBytes,
  clearAssetCache,
  configureAssetCache,
  DEFAULT_ASSET_CACHE_BYTES,
  forgetCachedAsset,
  getCachedAsset,
  setCachedAsset,
} from "./asset-cache.js";

afterEach(() => {
  clearAssetCache();
  configureAssetCache({ maxBytes: DEFAULT_ASSET_CACHE_BYTES });
  vi.useRealTimers();
});

const bytes = (n: number) => Buffer.alloc(n, 1);

describe("asset cache", () => {
  it("keeps hits and misses per server", () => {
    setCachedAsset("a:1", "/icon_5", bytes(3));
    setCachedAsset("a:1", "/icon_6", null);
    expect(getCachedAsset("a:1", "/icon_5")?.length).toBe(3);
    expect(getCachedAsset("a:1", "/icon_6")).toBeNull();
    expect(getCachedAsset("b:1", "/icon_5")).toBeUndefined();
    forgetCachedAsset("a:1", "/icon_5");
    expect(getCachedAsset("a:1", "/icon_5")).toBeUndefined();
  });

  it("holds no more bytes than its budget, dropping the least recently used", () => {
    configureAssetCache({ maxBytes: 10 });
    setCachedAsset("s", "/a", bytes(4));
    setCachedAsset("s", "/b", bytes(4));
    // Reading /a makes /b the oldest.
    expect(getCachedAsset("s", "/a")).toBeDefined();
    setCachedAsset("s", "/c", bytes(4));
    expect(getCachedAsset("s", "/b")).toBeUndefined();
    expect(getCachedAsset("s", "/a")).toBeDefined();
    expect(getCachedAsset("s", "/c")).toBeDefined();
    expect(assetCacheBytes()).toBe(8);
  });

  it("does not keep a file bigger than the whole budget", () => {
    configureAssetCache({ maxBytes: 10 });
    setCachedAsset("s", "/a", bytes(4));
    setCachedAsset("s", "/big", bytes(11));
    expect(getCachedAsset("s", "/big")).toBeUndefined();
    expect(getCachedAsset("s", "/a")).toBeDefined();
  });

  it("counts a replaced or forgotten entry's bytes out", () => {
    configureAssetCache({ maxBytes: 10 });
    setCachedAsset("s", "/a", bytes(6));
    setCachedAsset("s", "/a", bytes(2));
    expect(assetCacheBytes()).toBe(2);
    forgetCachedAsset("s", "/a");
    expect(assetCacheBytes()).toBe(0);
  });

  it("expires entries, a shorter TTL when asked", () => {
    vi.useFakeTimers();
    setCachedAsset("s", "/a", bytes(1));
    setCachedAsset("s", "/neg", null, 60_000);
    vi.advanceTimersByTime(60_001);
    expect(getCachedAsset("s", "/neg")).toBeUndefined();
    expect(getCachedAsset("s", "/a")).toBeDefined();
    vi.advanceTimersByTime(7 * 60 * 60 * 1000);
    expect(getCachedAsset("s", "/a")).toBeUndefined();
    expect(assetCacheBytes()).toBe(0);
  });
});
