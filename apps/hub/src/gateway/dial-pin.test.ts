/**
 * TsSession dials the address the guard resolved: the driver is built with a
 * resolver pinned to it, and the name is looked up once no matter how many
 * handshake attempts follow.
 */
import { describe, expect, it, vi } from "vitest";
import pino from "pino";
import type { AddrResolver, ClientOptions } from "@honeybbq/teamspeak-client";

const constructed: Array<{ addr: string; resolver: AddrResolver | undefined }> = [];

function timeout(): Error {
  const err = new Error("handshake timed out");
  err.name = "TimeoutError";
  return err;
}

/** Records its resolver and fails every handshake with a timeout so connect() retries. */
class FakeClient {
  readonly handler = { onPacket: undefined as unknown, setClientID: () => undefined };
  clid = 0;
  constructor(_identity: unknown, addr: string, _nickname: string, options: ClientOptions) {
    constructed.push({ addr, resolver: options.resolver });
  }
  on(): this {
    return this;
  }
  async connect(): Promise<void> {}
  async waitConnected(): Promise<void> {
    throw timeout();
  }
  async disconnect(): Promise<void> {}
}

vi.mock("@honeybbq/teamspeak-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@honeybbq/teamspeak-client")>()),
  Client: FakeClient,
}));

const { TsSession } = await import("./TsSession.js");

describe("TsSession dial pinning", () => {
  it("hands the driver a resolver pinned to the guard's address and resolves only once", async () => {
    const lookup = vi
      .fn<(host: string) => Promise<Array<{ address: string }>>>()
      .mockResolvedValueOnce([{ address: "93.184.216.34" }])
      .mockResolvedValue([{ address: "10.0.0.5" }]);
    const logs: string[] = [];
    const session = new TsSession(
      {
        host: "ts.example.org",
        port: 9987,
        nickname: "pin",
        logger: pino({ level: "silent" }),
        securityLevel: 0,
        connectTimeoutMs: 10,
        connectRetries: 2,
        lookup,
      },
      {
        onMessage: (msg) => {
          if (msg.type === "log") logs.push(msg.message);
        },
        onVoice: () => undefined,
        onClosed: () => undefined,
      },
    );

    await expect(session.connect()).rejects.toMatchObject({ name: "TimeoutError" });

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("ts.example.org");
    expect(constructed).toHaveLength(2);
    for (const { addr, resolver } of constructed) {
      expect(addr).toBe("ts.example.org:9987");
      expect(resolver).toBeDefined();
      await expect(resolver!.resolve("anything")).resolves.toMatchObject([
        { addr: "93.184.216.34:9987", source: "hub-pinned" },
      ]);
    }
    expect(logs).toContain("正在连接 ts.example.org:9987（已解析为 93.184.216.34）…");
  });
});
