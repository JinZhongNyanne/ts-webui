import { describe, expect, it, vi } from "vitest";
import {
  assertMusicBotTarget,
  musicBotHost,
  normalizeMusicBotUrl,
  resolveMusicBotUrl,
} from "./target.js";

describe("resolveMusicBotUrl", () => {
  it("defaults to the TeamSpeak host on the bot's default port", () => {
    expect(resolveMusicBotUrl(undefined, "ts.example.org")).toBe("http://ts.example.org:3000");
    expect(resolveMusicBotUrl("", "ts.example.org")).toBe("http://ts.example.org:3000");
    expect(resolveMusicBotUrl("   ", "10.0.0.5")).toBe("http://10.0.0.5:3000");
  });

  it("brackets an IPv6 TeamSpeak host", () => {
    expect(resolveMusicBotUrl(undefined, "2001:db8::1")).toBe("http://[2001:db8::1]:3000");
  });

  it("accepts a bare host and adds the default port", () => {
    expect(resolveMusicBotUrl("bot.example.org", "ts")).toBe("http://bot.example.org:3000");
    expect(resolveMusicBotUrl("Bot.Example.ORG", "ts")).toBe("http://bot.example.org:3000");
    expect(resolveMusicBotUrl("192.168.1.9", "ts")).toBe("http://192.168.1.9:3000");
    expect(resolveMusicBotUrl("::1", "ts")).toBe("http://[::1]:3000");
  });

  it("accepts host:port", () => {
    expect(resolveMusicBotUrl("bot.example.org:8080", "ts")).toBe("http://bot.example.org:8080");
    expect(resolveMusicBotUrl("127.0.0.1:3999", "ts")).toBe("http://127.0.0.1:3999");
    expect(resolveMusicBotUrl("[::1]:4000", "ts")).toBe("http://[::1]:4000");
  });

  it("keeps a full http(s) URL, dropping query, hash and trailing slashes", () => {
    expect(resolveMusicBotUrl("http://bot.example.org:3000/", "ts")).toBe(
      "http://bot.example.org:3000",
    );
    expect(resolveMusicBotUrl("https://bot.example.org/musicbot/?x=1#y", "ts")).toBe(
      "https://bot.example.org/musicbot",
    );
    expect(resolveMusicBotUrl("HTTP://bot.example.org:81//", "ts")).toBe(
      "http://bot.example.org:81",
    );
  });

  it("refuses other schemes, userinfo, spaces and paths on bare hosts", () => {
    expect(resolveMusicBotUrl("ftp://bot.example.org", "ts")).toBeNull();
    expect(resolveMusicBotUrl("file:///etc/passwd", "ts")).toBeNull();
    expect(resolveMusicBotUrl("http://user:pw@bot.example.org", "ts")).toBeNull();
    expect(resolveMusicBotUrl("user@bot.example.org", "ts")).toBeNull();
    expect(resolveMusicBotUrl("bot example.org", "ts")).toBeNull();
    expect(resolveMusicBotUrl("http://bot example.org", "ts")).toBeNull();
    expect(resolveMusicBotUrl("bot.example.org/path", "ts")).toBeNull();
    expect(resolveMusicBotUrl("bot.example.org:notaport", "ts")).toBeNull();
    expect(resolveMusicBotUrl("javascript:alert(1)", "ts")).toBeNull();
  });

  it("normalizeMusicBotUrl treats an empty string as invalid", () => {
    expect(normalizeMusicBotUrl("")).toBeNull();
    expect(normalizeMusicBotUrl("http://musicbot:3000/")).toBe("http://musicbot:3000");
  });

  it("musicBotHost strips brackets and lower-cases", () => {
    expect(musicBotHost("http://[::1]:3000")).toBe("::1");
    expect(musicBotHost("http://Bot.Example.org:3000/x")).toBe("bot.example.org");
    expect(musicBotHost("not a url")).toBe("");
  });
});

describe("assertMusicBotTarget", () => {
  const publicLookup = async () => [{ address: "203.0.113.5" }];
  const privateLookup = async () => [{ address: "203.0.113.5" }, { address: "10.0.0.1" }];
  const failingLookup = async () => {
    throw new Error("ENOTFOUND");
  };
  const neverLookup = async () => {
    throw new Error("lookup must not be called");
  };

  it("rejects a null resolve with hub.musicBadTarget", async () => {
    await expect(
      assertMusicBotTarget(null, { tsHost: "ts", allowPrivate: false, lookup: neverLookup }),
    ).rejects.toThrow("hub.musicBadTarget");
  });

  it("accepts a public target", async () => {
    await expect(
      assertMusicBotTarget("http://bot.example.org:3000", {
        tsHost: "ts.example.org",
        allowPrivate: false,
        lookup: publicLookup,
      }),
    ).resolves.toEqual({ address: "203.0.113.5" });
  });

  it("blocks a target with any private address", async () => {
    await expect(
      assertMusicBotTarget("http://bot.example.org:3000", {
        tsHost: "ts.example.org",
        allowPrivate: false,
        lookup: privateLookup,
      }),
    ).rejects.toThrow("hub.musicBlockedTarget");
  });

  it("skips the guard when the operator allows private targets", async () => {
    await expect(
      assertMusicBotTarget("http://127.0.0.1:3999", {
        tsHost: "ts.example.org",
        allowPrivate: true,
        lookup: neverLookup,
      }),
    ).resolves.toEqual({ address: null });
  });

  it("blocks a private IP literal without an exemption", async () => {
    await expect(
      assertMusicBotTarget("http://10.0.0.5:3000", {
        tsHost: "ts.example.org",
        allowPrivate: false,
        lookup: neverLookup,
      }),
    ).rejects.toThrow("hub.musicBlockedTarget");
  });

  it("trusts the operator's own bot wherever it lives", async () => {
    await expect(
      assertMusicBotTarget("http://musicbot:3000", {
        tsHost: "ts.example.org",
        allowPrivate: false,
        trustedUrl: "http://musicbot:3000",
        lookup: privateLookup,
      }),
    ).resolves.toEqual({ address: "203.0.113.5" });
  });

  it("pins the first resolved address so a second lookup cannot change it", async () => {
    const answers = [[{ address: "203.0.113.5" }], [{ address: "10.0.0.1" }]];
    const lookup = vi.fn(async () => answers.shift() ?? []);
    await expect(
      assertMusicBotTarget("http://bot.example.org:3000", {
        tsHost: "ts.example.org",
        allowPrivate: false,
        lookup,
      }),
    ).resolves.toEqual({ address: "203.0.113.5" });
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("trusts the TeamSpeak host the session connected to, on the bot's default port", async () => {
    await expect(
      assertMusicBotTarget("http://TS.example.org:3000", {
        tsHost: "ts.example.org",
        allowPrivate: false,
        lookup: privateLookup,
      }),
    ).resolves.toEqual({ address: "203.0.113.5" });
    await expect(
      assertMusicBotTarget("http://[::1]:3000", {
        tsHost: "::1",
        allowPrivate: false,
        lookup: neverLookup,
      }),
    ).resolves.toEqual({ address: null });
  });

  it("does not extend the TeamSpeak-host trust to other ports", async () => {
    await expect(
      assertMusicBotTarget("http://ts.example.org:9200", {
        tsHost: "ts.example.org",
        allowPrivate: false,
        lookup: privateLookup,
      }),
    ).rejects.toThrow("hub.musicBlockedTarget");
  });

  it("reports a host that does not resolve as unreachable", async () => {
    await expect(
      assertMusicBotTarget("http://nowhere.invalid:3000", {
        tsHost: "ts.example.org",
        allowPrivate: false,
        lookup: failingLookup,
      }),
    ).rejects.toThrow("hub.musicUnreachable");
  });

  it("prefers an IPv4 answer when pinning", async () => {
    await expect(
      assertMusicBotTarget("http://bot.example.org:3000", {
        tsHost: "ts.example.org",
        allowPrivate: false,
        lookup: async () => [{ address: "2001:db8::5" }, { address: "203.0.113.5" }],
      }),
    ).resolves.toEqual({ address: "203.0.113.5" });
  });
});
