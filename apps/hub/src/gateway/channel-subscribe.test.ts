import { describe, expect, it } from "vitest";
import { subscribeNewChannel } from "./channel-subscribe.js";

const ch = (id: string, parentId: string, subscribed: boolean) => ({ id, parentId, subscribed });

describe("subscribeNewChannel", () => {
  it("follows a subscribed parent", () => {
    expect(subscribeNewChannel([ch("1", "0", true)], "1")).toBe(true);
    expect(subscribeNewChannel([ch("1", "0", false)], "1")).toBe(false);
  });

  it("at the top level, follows 'everything is subscribed'", () => {
    expect(subscribeNewChannel([ch("1", "0", true), ch("2", "1", true)], "0")).toBe(true);
    expect(subscribeNewChannel([ch("1", "0", true), ch("2", "1", false)], "0")).toBe(false);
    expect(subscribeNewChannel([], "0")).toBe(false);
  });

  it("an unknown parent says no", () => {
    expect(subscribeNewChannel([ch("1", "0", true)], "9")).toBe(false);
  });
});
