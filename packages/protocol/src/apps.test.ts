import { describe, expect, it } from "vitest";
import { appName, normalizeAppUrl } from "./apps.js";

const OWN = ["https://ts.example.com"];

describe("normalizeAppUrl", () => {
  it("adds https to a bare host", () =>
    expect(normalizeAppUrl("example.org/page", OWN)).toEqual({ url: "https://example.org/page" }));

  it("keeps http and https URLs", () => {
    expect(normalizeAppUrl("http://10.0.0.5:8080/", OWN)).toEqual({ url: "http://10.0.0.5:8080/" });
    expect(normalizeAppUrl(" https://a.b/c?d=1 ", OWN)).toEqual({ url: "https://a.b/c?d=1" });
  });

  it("refuses other schemes and embedded credentials", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
      "ftp://a.b",
      "https://user:pw@a.b/",
    ]) {
      expect(normalizeAppUrl(bad, OWN)).toEqual({ error: "invalid" });
    }
  });

  it("refuses empty and malformed input", () => {
    expect(normalizeAppUrl("   ", OWN)).toEqual({ error: "invalid" });
    expect(normalizeAppUrl("https://", OWN)).toEqual({ error: "invalid" });
  });

  it("refuses the app's own origins", () => {
    expect(normalizeAppUrl("https://ts.example.com/api/x", OWN)).toEqual({ error: "sameOrigin" });
    expect(normalizeAppUrl("ts.example.com", OWN)).toEqual({ error: "sameOrigin" });
  });
});

describe("appName", () => {
  it("prefers the typed name", () => expect(appName("  Wiki ", "https://w.org")).toBe("Wiki"));
  it("falls back to the host without www", () =>
    expect(appName("", "https://www.youtube.com/watch")).toBe("youtube.com"));
});
