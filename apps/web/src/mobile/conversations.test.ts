import { describe, expect, it } from "vitest";
import { openConversations } from "./conversations";

interface Msg {
  conversation: string;
  at: number;
}

const msgs = (...items: [string, number][]): Msg[] =>
  items.map(([conversation, at]) => ({ conversation, at }));

describe("openConversations", () => {
  it("always offers the server conversation, even with no messages", () => {
    const list = openConversations({ messages: [], unread: new Map(), activeKey: "server" });
    expect(list.map((c) => c.key)).toEqual(["server"]);
  });

  it("puts the server first and the own channel second", () => {
    const list = openConversations({
      messages: msgs(["client:7", 300], ["channel:5", 100]),
      unread: new Map(),
      activeKey: "server",
      selfChannelId: "5",
    });
    expect(list.map((c) => c.key)).toEqual(["server", "channel:5", "client:7"]);
  });

  it("offers the own channel even before anyone has written in it", () => {
    const list = openConversations({
      messages: [],
      unread: new Map(),
      activeKey: "server",
      selfChannelId: "12",
    });
    expect(list.map((c) => c.key)).toEqual(["server", "channel:12"]);
  });

  it("orders the rest by their most recent message, newest first", () => {
    const list = openConversations({
      messages: msgs(["client:1", 10], ["client:2", 50], ["client:1", 90], ["client:3", 20]),
      unread: new Map(),
      activeKey: "server",
    });
    expect(list.map((c) => c.key)).toEqual(["server", "client:1", "client:2", "client:3"]);
  });

  it("lists each conversation once", () => {
    const list = openConversations({
      messages: msgs(["client:1", 10], ["client:1", 20], ["client:1", 30]),
      unread: new Map(),
      activeKey: "server",
    });
    expect(list.filter((c) => c.key === "client:1")).toHaveLength(1);
  });

  it("keeps the active conversation on the list even when it is empty", () => {
    const list = openConversations({
      messages: [],
      unread: new Map(),
      activeKey: "client:42",
    });
    expect(list.map((c) => c.key)).toContain("client:42");
  });

  it("carries the unread count, and zero when there is none", () => {
    const list = openConversations({
      messages: msgs(["client:1", 10]),
      unread: new Map([["client:1", 3]]),
      activeKey: "server",
    });
    expect(list.find((c) => c.key === "client:1")!.unread).toBe(3);
    expect(list.find((c) => c.key === "server")!.unread).toBe(0);
  });

  it("offers a conversation that only has unread counts", () => {
    const list = openConversations({
      messages: [],
      unread: new Map([["client:9", 2]]),
      activeKey: "server",
    });
    expect(list.map((c) => c.key)).toEqual(["server", "client:9"]);
  });

  it("does not mutate the input", () => {
    const messages = msgs(["client:1", 10], ["client:2", 20]);
    const copy = [...messages];
    openConversations({ messages, unread: new Map(), activeKey: "server" });
    expect(messages).toEqual(copy);
  });
});
