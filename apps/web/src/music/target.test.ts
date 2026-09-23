import { describe, expect, it } from "vitest";
import { defaultMusicBot, describeMusicBot } from "./target";

describe("defaultMusicBot", () => {
  it("appends the default port to a hostname", () =>
    expect(defaultMusicBot("ts.example.com")).toBe("ts.example.com:3000"));
  it("appends the default port to an IPv4 address", () =>
    expect(defaultMusicBot("10.0.0.5")).toBe("10.0.0.5:3000"));
  it("brackets bare IPv6 literals", () => expect(defaultMusicBot("::1")).toBe("[::1]:3000"));
  it("keeps already bracketed IPv6 literals", () =>
    expect(defaultMusicBot("[fe80::1]")).toBe("[fe80::1]:3000"));
  it("trims whitespace", () =>
    expect(defaultMusicBot("  ts.example.com ")).toBe("ts.example.com:3000"));
});

describe("describeMusicBot", () => {
  it("prefers the explicit value", () =>
    expect(describeMusicBot("http://bot:8080", "ts.example.com")).toBe("http://bot:8080"));
  it("trims the explicit value", () =>
    expect(describeMusicBot("  bot:8080  ", "ts.example.com")).toBe("bot:8080"));
  it("falls back to the default when blank", () =>
    expect(describeMusicBot("   ", "ts.example.com")).toBe("ts.example.com:3000"));
});
