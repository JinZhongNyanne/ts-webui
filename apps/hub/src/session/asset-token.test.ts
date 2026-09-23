import { describe, expect, it } from "vitest";
import { ASSET_TOKEN_TTL_MS, AssetTokenStore, MAX_LIVE_PER_SESSION } from "./asset-token.js";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("AssetTokenStore", () => {
  it("mints a 32-character url-safe token that expires one TTL out", () => {
    const c = clock();
    const store = new AssetTokenStore(c.now);
    const grant = store.mint("s1");
    expect(grant.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(grant.expiresAt).toBe(c.now() + ASSET_TOKEN_TTL_MS);
  });

  it("resolves before expiry and refuses after", () => {
    const c = clock();
    const store = new AssetTokenStore(c.now);
    const { token } = store.mint("s1");
    c.advance(ASSET_TOKEN_TTL_MS - 1);
    expect(store.resolve(token)).toBe("s1");
    c.advance(1);
    expect(store.resolve(token)).toBeUndefined();
  });

  it("keeps the earlier token valid when a new one is minted", () => {
    const store = new AssetTokenStore(clock().now);
    const first = store.mint("s1");
    const second = store.mint("s1");
    expect(first.token).not.toBe(second.token);
    expect(store.resolve(first.token)).toBe("s1");
    expect(store.resolve(second.token)).toBe("s1");
  });

  it("evicts the oldest token once a session exceeds the cap", () => {
    const store = new AssetTokenStore(clock().now);
    const grants = Array.from({ length: MAX_LIVE_PER_SESSION + 1 }, () => store.mint("s1"));
    const other = store.mint("s2");
    expect(store.resolve(grants[0]!.token)).toBeUndefined();
    for (const g of grants.slice(1)) expect(store.resolve(g.token)).toBe("s1");
    expect(store.resolve(other.token)).toBe("s2");
  });

  it("revokeSession kills every token of that session only", () => {
    const store = new AssetTokenStore(clock().now);
    const a1 = store.mint("s1");
    const a2 = store.mint("s1");
    const b = store.mint("s2");
    store.revokeSession("s1");
    expect(store.resolve(a1.token)).toBeUndefined();
    expect(store.resolve(a2.token)).toBeUndefined();
    expect(store.resolve(b.token)).toBe("s2");
  });

  it("answers undefined for unknown or malformed tokens", () => {
    const store = new AssetTokenStore(clock().now);
    store.mint("s1");
    expect(store.resolve(undefined)).toBeUndefined();
    expect(store.resolve("")).toBeUndefined();
    expect(store.resolve("A".repeat(31))).toBeUndefined();
    expect(store.resolve("A".repeat(33))).toBeUndefined();
    expect(store.resolve("!".repeat(32))).toBeUndefined();
    expect(store.resolve("A".repeat(32))).toBeUndefined();
  });

  it("sweeps expired entries out of the store", () => {
    const c = clock();
    const store = new AssetTokenStore(c.now);
    store.mint("s1");
    c.advance(ASSET_TOKEN_TTL_MS);
    store.sweep();
    expect(store.size).toBe(0);
  });
});
