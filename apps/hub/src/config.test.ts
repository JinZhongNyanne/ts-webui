import { describe, expect, it } from "vitest";
import { loadConfig, parseHostPort, resolveConnectTarget } from "./config.js";

describe("parseHostPort", () => {
  it("reads host, host:port and bracketed IPv6", () => {
    expect(parseHostPort("ts.example.com")).toEqual({ host: "ts.example.com", port: 9987 });
    expect(parseHostPort(" TS.example.com:10000 ")).toEqual({
      host: "ts.example.com",
      port: 10000,
    });
    expect(parseHostPort("192.168.1.10:9987")).toEqual({ host: "192.168.1.10", port: 9987 });
    expect(parseHostPort("[::1]:9988")).toEqual({ host: "::1", port: 9988 });
    expect(parseHostPort("[fe80::1]")).toEqual({ host: "fe80::1", port: 9987 });
  });

  it("refuses anything else", () => {
    for (const bad of [
      "",
      "host:0",
      "host:70000",
      "host:port",
      "http://host",
      "a@b",
      "::1",
      "h/x",
    ]) {
      expect(parseHostPort(bad), bad).toBeNull();
    }
  });
});

describe("fixed server config", () => {
  it("is off unless HUB_TS_SERVER is set", () => {
    expect(loadConfig({}).fixedServer).toBeNull();
  });

  it("parses HUB_TS_SERVER and carries HUB_TS_PASSWORD", () => {
    const config = loadConfig({ HUB_TS_SERVER: "10.0.0.5:9000", HUB_TS_PASSWORD: "pw" });
    expect(config.fixedServer).toEqual({ host: "10.0.0.5", port: 9000, password: "pw" });
  });

  it("fails fast on a bad address", () => {
    expect(() => loadConfig({ HUB_TS_SERVER: "not a host" })).toThrow(/HUB_TS_SERVER/);
  });

  it("refuses a hub password signed with the public dev secret in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production", HUB_PASSWORD: "pw" })).toThrow(
      /HUB_SESSION_SECRET/,
    );
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        HUB_PASSWORD: "pw",
        HUB_SESSION_SECRET: "a-real-secret-0123456789",
      }),
    ).not.toThrow();
  });
});

describe("resolveConnectTarget", () => {
  const request = {
    host: "evil.example.com",
    port: 1234,
    serverPassword: "browser",
    musicBot: "bot.example.com",
  };

  it("ignores what the browser asks for when the server is fixed", () => {
    const config = loadConfig({ HUB_TS_SERVER: "ts.example.com", HUB_TS_PASSWORD: "secret" });
    expect(resolveConnectTarget(config, request)).toEqual({
      host: "ts.example.com",
      port: 9987,
      serverPassword: "secret",
      operatorNamed: true,
    });
    expect(resolveConnectTarget(config, {})).toMatchObject({ host: "ts.example.com" });
  });

  it("sends no server password when the fixed server has none", () => {
    const config = loadConfig({ HUB_TS_SERVER: "ts.example.com" });
    expect(resolveConnectTarget(config, {})).toMatchObject({ serverPassword: undefined });
  });

  it("uses the browser's choice when no server is fixed", () => {
    expect(resolveConnectTarget(loadConfig({}), request)).toEqual({
      ...request,
      operatorNamed: false,
    });
    expect(resolveConnectTarget(loadConfig({}), { host: "a.example" })).toMatchObject({
      port: 9987,
    });
  });

  it("needs a host and applies the allow list when no server is fixed", () => {
    expect(resolveConnectTarget(loadConfig({}), {})).toEqual({ error: "server_required" });
    const listed = loadConfig({ HUB_ALLOWED_TS_SERVERS: "ts.example.com" });
    expect(resolveConnectTarget(listed, request)).toEqual({ error: "server_not_allowed" });
    expect(resolveConnectTarget(listed, { host: "ts.example.com" })).toMatchObject({
      operatorNamed: true,
    });
  });
});

describe("file transfer config (M3)", () => {
  it("has sane defaults", () => {
    const c = loadConfig({});
    expect(c.HUB_FT_MAX_UPLOAD_BYTES).toBe(100 * 1024 * 1024);
    expect(c.HUB_FT_MAX_TRANSFERS_PER_SESSION).toBe(3);
    expect(c.HUB_FT_RATE_PER_MIN).toBe(30);
    expect(c.HUB_FT_MEDIA_OPENS_PER_MIN).toBe(12);
    expect(c.HUB_FT_MAX_TRANSFERS).toBe(32);
    expect(c.HUB_FT_STALL_SECONDS).toBe(60);
    expect(c.HUB_FT_STALL_MIN_BYTES).toBe(64 * 1024);
    expect(c.HUB_ASSET_CACHE_MAX_BYTES).toBe(64 * 1024 * 1024);
    expect(c.fileTransferHost).toBeNull();
  });

  it("reads the stall watchdog, hub-wide cap and cache budget, within bounds", () => {
    const c = loadConfig({
      HUB_FT_MAX_TRANSFERS: "5",
      HUB_FT_STALL_SECONDS: "120",
      HUB_FT_STALL_MIN_BYTES: "1024",
      HUB_ASSET_CACHE_MAX_BYTES: "2097152",
    });
    expect(c.HUB_FT_MAX_TRANSFERS).toBe(5);
    expect(c.HUB_FT_STALL_SECONDS).toBe(120);
    expect(c.HUB_FT_STALL_MIN_BYTES).toBe(1024);
    expect(c.HUB_ASSET_CACHE_MAX_BYTES).toBe(2 * 1024 * 1024);
    expect(() => loadConfig({ HUB_FT_MAX_TRANSFERS: "0" })).toThrow();
    expect(() => loadConfig({ HUB_FT_STALL_SECONDS: "1" })).toThrow();
    expect(() => loadConfig({ HUB_FT_STALL_MIN_BYTES: "0" })).toThrow();
    expect(() => loadConfig({ HUB_ASSET_CACHE_MAX_BYTES: "1000" })).toThrow();
  });

  it("reads the media opens per minute (0 = only the transfer budget applies)", () => {
    expect(loadConfig({ HUB_FT_MEDIA_OPENS_PER_MIN: "4" }).HUB_FT_MEDIA_OPENS_PER_MIN).toBe(4);
    expect(loadConfig({ HUB_FT_MEDIA_OPENS_PER_MIN: "0" }).HUB_FT_MEDIA_OPENS_PER_MIN).toBe(0);
    expect(() => loadConfig({ HUB_FT_MEDIA_OPENS_PER_MIN: "-1" })).toThrow();
  });

  it("reads the limits", () => {
    const c = loadConfig({ HUB_FT_MAX_UPLOAD_BYTES: "0", HUB_FT_MAX_TRANSFERS_PER_SESSION: "1" });
    expect(c.HUB_FT_MAX_UPLOAD_BYTES).toBe(0);
    expect(c.HUB_FT_MAX_TRANSFERS_PER_SESSION).toBe(1);
    expect(() => loadConfig({ HUB_FT_MAX_TRANSFERS_PER_SESSION: "0" })).toThrow();
  });

  it("tells native clients the fixed server's name, never a bare IP unless asked", () => {
    expect(loadConfig({}).publicServer).toBeNull();
    expect(loadConfig({ HUB_TS_SERVER: "ts.example.com:9988" }).publicServer).toEqual({
      host: "ts.example.com",
      port: 9988,
    });
    // An IP (often a LAN one) stays on the hub...
    expect(loadConfig({ HUB_TS_SERVER: "192.168.1.5" }).publicServer).toBeNull();
    // ...unless the operator names the public address.
    expect(
      loadConfig({ HUB_TS_SERVER: "192.168.1.5", HUB_TS_PUBLIC_ADDRESS: "ts.example.com" })
        .publicServer,
    ).toEqual({ host: "ts.example.com", port: 9987 });
    expect(() =>
      loadConfig({ HUB_TS_SERVER: "192.168.1.5", HUB_TS_PUBLIC_ADDRESS: "a b" }),
    ).toThrow(/HUB_TS_PUBLIC_ADDRESS/);
  });

  it("uses HUB_FT_HOST only for the fixed server", () => {
    expect(loadConfig({ HUB_FT_HOST: "192.168.1.5" }).fileTransferHost).toBeNull();
    expect(
      loadConfig({ HUB_FT_HOST: " 192.168.1.5 ", HUB_TS_SERVER: "ts.example.com" })
        .fileTransferHost,
    ).toBe("192.168.1.5");
    expect(() => loadConfig({ HUB_FT_HOST: "a b", HUB_TS_SERVER: "ts.example.com" })).toThrow();
  });
});
