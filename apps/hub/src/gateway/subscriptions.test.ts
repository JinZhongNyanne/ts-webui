import { describe, expect, it } from "vitest";
import type { TsClient } from "@jinz/protocol";
import { clientsHiddenByUnsubscribe } from "./subscriptions.js";
import { clientFromParams } from "./parse.js";

const client = (id: number, channelId: string): TsClient =>
  clientFromParams({ clid: String(id), cid: channelId }, 1);

describe("clientsHiddenByUnsubscribe", () => {
  const all = [client(1, "6"), client(2, "5"), client(3, "6"), client(4, "5")];

  it("names everyone in the channel", () => {
    expect(clientsHiddenByUnsubscribe(all, "5", 1, "6")).toEqual([2, 4]);
  });

  it("never names ourselves, even before our channel is known", () => {
    expect(clientsHiddenByUnsubscribe([client(1, "5"), client(2, "5")], "5", 1, null)).toEqual([2]);
  });

  it("never hides the channel we are in", () => {
    expect(clientsHiddenByUnsubscribe(all, "6", 1, "6")).toEqual([]);
  });

  it("is empty for an empty channel", () => {
    expect(clientsHiddenByUnsubscribe(all, "9", 1, "6")).toEqual([]);
  });
});
