import { describe, expect, it } from "vitest";
import type { Client } from "@honeybbq/teamspeak-client";
import pino from "pino";
import { lockClientId } from "./TsSession.js";

/** Minimal stand-in for the library client: a `clid` field plus a handler with setClientID. */
function fakeClient(clid: number): Client & { handlerId: number } {
  const fake = {
    clid,
    handlerId: 0,
    handler: {
      setClientID(id: number) {
        fake.handlerId = id;
      },
    },
  };
  return fake as unknown as Client & { handlerId: number };
}

describe("lockClientId", () => {
  it("keeps our own client id when the library tries to adopt a newcomer's id", () => {
    const client = fakeClient(0);
    lockClientId(client, 42, pino({ level: "silent" }));
    expect(client.handlerId).toBe(42);

    // What the library does on a clientEnter whose nickname starts with ours.
    client.clid = 77;
    client.handler.setClientID(77);

    expect(client.clid).toBe(42);
    expect(client.handlerId).toBe(42);

    // Setting it to the right id is still allowed (idempotent).
    client.clid = 42;
    client.handler.setClientID(42);
    expect(client.clid).toBe(42);
    expect(client.handlerId).toBe(42);
  });
});
