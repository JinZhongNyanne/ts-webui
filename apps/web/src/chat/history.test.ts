import { describe, expect, it } from "vitest";
import {
  ChatHistory,
  DAY_MS,
  MemoryHistoryBackend,
  historyConversation,
  historyServerKey,
  matchesQuery,
  type StoredMessage,
} from "./history";

const NOW = 1_700_000_000_000;

function msg(over: Partial<StoredMessage> = {}): StoredMessage {
  return {
    server: "s",
    conversation: "server",
    at: NOW,
    fromName: "Alice",
    fromUid: "uidA=",
    text: "hello",
    self: false,
    ...over,
  };
}

function setup(cap = 5) {
  const backend = new MemoryHistoryBackend();
  const history = new ChatHistory(backend, { cap, now: () => NOW });
  return { backend, history };
}

describe("ChatHistory", () => {
  it("stores and loads a conversation oldest first", async () => {
    const { history } = setup();
    await history.append(msg({ at: NOW - 2, text: "b" }));
    await history.append(msg({ at: NOW - 5, text: "a" }));
    await history.append(msg({ conversation: "channel:1", text: "elsewhere" }));
    await history.append(msg({ server: "other", text: "other server" }));
    const list = await history.load("s", "server", 30);
    expect(list.map((m) => m.text)).toEqual(["a", "b"]);
  });

  it("returns distinct record ids and ignores a caller's id", async () => {
    const { history } = setup();
    const a = await history.append(msg({ id: 99 }));
    const b = await history.append(msg());
    expect(a).not.toBe(b);
    expect(a).not.toBe(99);
  });

  it("caps each conversation, dropping the oldest", async () => {
    const { history } = setup(3);
    for (let i = 0; i < 5; i++) await history.append(msg({ at: NOW + i, text: `m${i}` }));
    await history.append(msg({ conversation: "channel:1", text: "kept" }));
    expect((await history.load("s", "server", 30)).map((m) => m.text)).toEqual(["m2", "m3", "m4"]);
    expect(await history.load("s", "channel:1", 30)).toHaveLength(1);
  });

  it("hides and prunes messages past the retention window", async () => {
    const { backend, history } = setup();
    await history.append(msg({ at: NOW - 31 * DAY_MS, text: "old" }));
    await history.append(msg({ at: NOW - 29 * DAY_MS, text: "recent" }));
    expect((await history.load("s", "server", 30)).map((m) => m.text)).toEqual(["recent"]);
    expect(await backend.count("s", "server")).toBe(2);
    await history.prune(30);
    expect(await backend.count("s", "server")).toBe(1);
  });

  it("keeps everything when retention is 0", async () => {
    const { backend, history } = setup();
    await history.append(msg({ at: NOW - 3650 * DAY_MS }));
    await history.prune(0);
    expect(await history.load("s", "server", 0)).toHaveLength(1);
    expect(await backend.count("s", "server")).toBe(1);
  });

  it("clears one conversation or everything", async () => {
    const { history } = setup();
    await history.append(msg());
    await history.append(msg({ conversation: "uid:x" }));
    await history.clearConversation("s", "server");
    expect(await history.load("s", "server", 30)).toHaveLength(0);
    expect(await history.load("s", "uid:x", 30)).toHaveLength(1);
    await history.clearAll();
    expect(await history.load("s", "uid:x", 30)).toHaveLength(0);
  });
});

describe("historyServerKey", () => {
  it("combines the dialled address with the creation time", () => {
    expect(
      historyServerKey(
        { created: 123, name: "A" },
        { host: " TS.Example.com ", port: 9987, fixed: false },
      ),
    ).toBe("ts.example.com:9987#123");
  });

  it("survives a rename", () => {
    const target = { host: "h", port: 1, fixed: false };
    expect(historyServerKey({ created: 5, name: "A" }, target)).toBe(
      historyServerKey({ created: 5, name: "B" }, target),
    );
  });

  it("ignores the address on a fixed-server hub", () => {
    expect(historyServerKey({ created: 7, name: "A" }, { host: "x", port: 1, fixed: true })).toBe(
      "fixed#7",
    );
  });

  it("falls back to the name when the creation time is unknown", () => {
    expect(historyServerKey({ created: 0, name: "A" }, { host: "h", port: 2, fixed: false })).toBe(
      "h:2#name:A",
    );
  });
});

describe("historyConversation", () => {
  const uids = new Map([[5, "uidFive="]]);
  const lookup = (clid: number) => uids.get(clid);

  it("keeps server and channel keys", () => {
    expect(historyConversation("server", lookup)).toBe("server");
    expect(historyConversation("channel:12", lookup)).toBe("channel:12");
  });

  it("files private chats under the partner's uid", () => {
    expect(historyConversation("client:5", lookup)).toBe("uid:uidFive=");
  });

  it("cannot file a private chat without a uid", () => {
    expect(historyConversation("client:6", lookup)).toBeNull();
    expect(historyConversation("bogus", lookup)).toBeNull();
  });
});

describe("matchesQuery", () => {
  const m = { fromName: "Alice", text: "Meet at the Lobby tonight" };

  it("matches every word, case-insensitively, in text or sender", () => {
    expect(matchesQuery(m, "lobby")).toBe(true);
    expect(matchesQuery(m, "alice TONIGHT")).toBe(true);
    expect(matchesQuery(m, "lobby tomorrow")).toBe(false);
  });

  it("matches everything for an empty query", () => {
    expect(matchesQuery(m, "  ")).toBe(true);
  });
});
