import { describe, expect, it } from "vitest";
import { resolveTab, totalUnread, visibleTabs } from "./tabs";

describe("visibleTabs", () => {
  it("always offers the channel tree and chat", () =>
    expect(visibleTabs({ music: false, video: false })).toEqual(["tree", "chat"]));

  it("adds the optional tabs in a stable order", () =>
    expect(visibleTabs({ music: true, video: true })).toEqual(["tree", "chat", "video", "music"]));

  it("leaves out a panel the hub does not offer", () => {
    expect(visibleTabs({ music: true, video: false })).toEqual(["tree", "chat", "music"]);
    expect(visibleTabs({ music: false, video: true })).toEqual(["tree", "chat", "video"]);
  });
});

describe("resolveTab", () => {
  it("keeps the current tab while it is still on offer", () =>
    expect(resolveTab("music", ["tree", "chat", "music"])).toBe("music"));

  it("falls back to the channel tree when the tab disappears", () =>
    expect(resolveTab("music", ["tree", "chat"])).toBe("tree"));
});

describe("totalUnread", () => {
  it("is zero with nothing unread", () => expect(totalUnread(new Map())).toBe(0));

  it("sums every conversation", () =>
    expect(
      totalUnread(
        new Map([
          ["server", 2],
          ["client:1", 3],
        ]),
      ),
    ).toBe(5));
});
