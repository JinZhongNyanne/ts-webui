import { describe, expect, it } from "vitest";
import { isPrivateAddress } from "./net.js";
import { isOriginAllowed, normalizeOrigin } from "./origin.js";
import { ConcurrencyLimiter, RateLimiter } from "./limits.js";

describe("private address detection", () => {
  it("catches the ranges a hub must not be talked into dialling", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "::",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("leaves public addresses alone", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.169.0.1", "2001:4860:4860::8888"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it("is not fooled by a hostname", () => {
    expect(isPrivateAddress("localhost")).toBe(false);
  });
});

describe("origin policy", () => {
  const policy = { allowed: ["https://ts.example.com"], allowLoopback: false };

  it("accepts the configured origin regardless of case or trailing slash", () => {
    expect(isOriginAllowed("https://ts.example.com", policy)).toBe(true);
    expect(isOriginAllowed("HTTPS://TS.Example.com/", policy)).toBe(true);
  });

  it("rejects everything else, including an opaque origin", () => {
    expect(isOriginAllowed("https://evil.example.org", policy)).toBe(false);
    expect(isOriginAllowed("null", policy)).toBe(false);
    expect(isOriginAllowed("http://localhost:5173", policy)).toBe(false);
  });

  it("accepts any loopback port in development", () => {
    const dev = { allowed: [], allowLoopback: true };
    expect(isOriginAllowed("http://localhost:5173", dev)).toBe(true);
    expect(isOriginAllowed("http://127.0.0.1:4173", dev)).toBe(true);
    expect(isOriginAllowed("https://evil.example.org", dev)).toBe(false);
  });

  it("lets a missing origin through: only browsers send one", () => {
    expect(isOriginAllowed(undefined, policy)).toBe(true);
  });

  it("normalizes", () => {
    expect(normalizeOrigin(" HTTPS://A.Example.com// ")).toBe("https://a.example.com");
  });
});

describe("rate limiter", () => {
  it("spends a burst, then refuses until the window refills", () => {
    const limiter = new RateLimiter({ limit: 3, windowMs: 60_000 });
    const t0 = 1_000_000;
    expect(limiter.take("a", t0)).toBe(true);
    expect(limiter.take("a", t0)).toBe(true);
    expect(limiter.take("a", t0)).toBe(true);
    expect(limiter.take("a", t0)).toBe(false);
    // Another key has its own budget.
    expect(limiter.take("b", t0)).toBe(true);
    // A third of the window back is one token back.
    expect(limiter.take("a", t0 + 20_000)).toBe(true);
    expect(limiter.take("a", t0 + 20_000)).toBe(false);
  });

  it("does nothing when the limit is zero", () => {
    const limiter = new RateLimiter({ limit: 0, windowMs: 1_000 });
    for (let i = 0; i < 100; i++) expect(limiter.take("a")).toBe(true);
    expect(limiter.size).toBe(0);
  });

  it("forgets idle keys instead of growing forever", () => {
    const limiter = new RateLimiter({ limit: 2, windowMs: 1_000, maxKeys: 4 });
    for (let i = 0; i < 4; i++) limiter.take(`k${i}`, 1_000);
    expect(limiter.size).toBe(4);
    limiter.take("k4", 5_000);
    expect(limiter.size).toBeLessThanOrEqual(4);
  });
});

describe("concurrency limiter", () => {
  it("counts up to the ceiling and back down", () => {
    const limiter = new ConcurrencyLimiter(2);
    expect(limiter.acquire("ip")).toBe(true);
    expect(limiter.acquire("ip")).toBe(true);
    expect(limiter.acquire("ip")).toBe(false);
    limiter.release("ip");
    expect(limiter.acquire("ip")).toBe(true);
    limiter.release("ip");
    limiter.release("ip");
    expect(limiter.count("ip")).toBe(0);
  });

  it("is unlimited at zero", () => {
    const limiter = new ConcurrencyLimiter(0);
    for (let i = 0; i < 50; i++) expect(limiter.acquire("ip")).toBe(true);
  });
});
