import { describe, expect, it } from "vitest";
import { conversationName } from "./conversationName";

const names = {
  channelName: (id: string) => (id === "5" ? "Lobby" : undefined),
  clientName: (id: number) => (id === 7 ? "Ada" : undefined),
};

describe("conversationName", () => {
  it("names the server conversation", () => expect(conversationName("server", names)).toBeTruthy());

  it("uses the channel's own name", () =>
    expect(conversationName("channel:5", names)).toBe("Lobby"));

  it("uses the nickname for a private chat", () =>
    expect(conversationName("client:7", names)).toBe("Ada"));

  it("falls back to a generic name for a channel that is gone", () => {
    const name = conversationName("channel:404", names);
    expect(name).toBeTruthy();
    expect(name).not.toContain("404");
  });

  it("falls back to a generic name for a user who left", () => {
    const name = conversationName("client:404", names);
    expect(name).toBeTruthy();
    expect(name).not.toContain("404");
  });
});
