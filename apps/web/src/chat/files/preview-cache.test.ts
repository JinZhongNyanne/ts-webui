import { describe, expect, it, vi } from "vitest";
import { createPreviewCache } from "./preview-cache";

describe("preview cache", () => {
  it("keeps a preview until it is asked for again", () => {
    const cache = createPreviewCache(100, vi.fn());
    cache.put("5:/a.png", "blob:a", 10);
    expect(cache.get("5:/a.png")).toBe("blob:a");
    expect(cache.get("5:/b.png")).toBeUndefined();
  });

  it("revokes the oldest ones once the bytes no longer fit", () => {
    const revoke = vi.fn();
    const cache = createPreviewCache(100, revoke);
    cache.put("a", "blob:a", 60);
    cache.put("b", "blob:b", 30);
    cache.put("c", "blob:c", 30);
    expect(revoke).toHaveBeenCalledWith("blob:a");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("blob:b");
    expect(cache.size).toBe(60);
  });

  it("does not keep one larger than the whole cache", () => {
    const revoke = vi.fn();
    const cache = createPreviewCache(100, revoke);
    cache.put("big", "blob:big", 200);
    expect(cache.get("big")).toBeUndefined();
    expect(revoke).toHaveBeenCalledWith("blob:big");
    expect(cache.size).toBe(0);
  });

  it("replaces a key without counting it twice", () => {
    const revoke = vi.fn();
    const cache = createPreviewCache(100, revoke);
    cache.put("a", "blob:1", 40);
    cache.put("a", "blob:2", 40);
    expect(revoke).toHaveBeenCalledWith("blob:1");
    expect(cache.size).toBe(40);
    expect(cache.get("a")).toBe("blob:2");
  });

  it("revokes everything on clear (a new session shows other files)", () => {
    const revoke = vi.fn();
    const cache = createPreviewCache(100, revoke);
    cache.put("a", "blob:a", 10);
    cache.put("b", "blob:b", 10);
    cache.clear();
    expect(revoke.mock.calls.flat()).toEqual(["blob:a", "blob:b"]);
    expect(cache.size).toBe(0);
    expect(cache.get("a")).toBeUndefined();
  });
});
