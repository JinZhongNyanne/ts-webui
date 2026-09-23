import { describe, expect, it } from "vitest";
import {
  bannerDecision,
  consentKey,
  MAX_BANNER_CONSENTS,
  normalizeConsents,
  withConsent,
} from "./banner-gate";

const SERVER = "ts.example.com:9987#1789580828";

describe("bannerDecision", () => {
  const none = { serverKey: SERVER, consents: new Set<string>(), hostAllowed: () => false };

  it("asks before loading: showing an external image tells its host who is looking", () => {
    expect(bannerDecision("https://img.example.org/b.png", none)).toEqual({
      kind: "ask",
      url: "https://img.example.org/b.png",
      host: "img.example.org",
    });
  });

  it("loads right away from a host the chat's [img] allowlist already trusts", () => {
    const ctx = { ...none, hostAllowed: (h: string) => h === "img.example.org" };
    expect(bannerDecision("https://img.example.org/b.png", ctx)).toEqual({
      kind: "show",
      url: "https://img.example.org/b.png",
    });
  });

  it("loads right away once allowed for this server and this host", () => {
    const ctx = {
      ...none,
      consents: new Set([consentKey(SERVER, "img.example.org")]),
    };
    expect(bannerDecision("https://img.example.org/b.png", ctx).kind).toBe("show");
    // Another server with the same banner host has not been allowed.
    expect(
      bannerDecision("https://img.example.org/b.png", { ...ctx, serverKey: "x:1#2" }).kind,
    ).toBe("ask");
    // The same server pointing its banner somewhere new asks again.
    expect(bannerDecision("https://tracker.example.net/b.png", ctx).kind).toBe("ask");
  });

  it("shows nothing for no banner, or for anything but an http(s) address", () => {
    expect(bannerDecision("", none)).toEqual({ kind: "none" });
    expect(bannerDecision("   ", none)).toEqual({ kind: "none" });
    expect(bannerDecision("javascript:alert(1)", none)).toEqual({ kind: "none" });
    expect(bannerDecision("data:image/png;base64,AAAA", none)).toEqual({ kind: "none" });
  });
});

describe("consents", () => {
  it("keys a consent by server and lower-cased host", () => {
    expect(consentKey(SERVER, "IMG.Example.org")).toBe(`${SERVER} img.example.org`);
  });

  it("adds once, newest last, and drops the oldest past the cap", () => {
    expect(withConsent(["a"], "a")).toEqual(["a"]);
    expect(withConsent(["a"], "b")).toEqual(["a", "b"]);
    const full = Array.from({ length: MAX_BANNER_CONSENTS }, (_, i) => `k${i}`);
    const next = withConsent(full, "new");
    expect(next).toHaveLength(MAX_BANNER_CONSENTS);
    expect(next[0]).toBe("k1");
    expect(next.at(-1)).toBe("new");
    expect(full[0]).toBe("k0");
  });

  it("trusts nothing it reads back from storage but a list of short strings", () => {
    expect(normalizeConsents(null)).toEqual([]);
    expect(normalizeConsents("x")).toEqual([]);
    expect(normalizeConsents(["a", 3, "", "a", "x".repeat(600)])).toEqual(["a"]);
  });
});
