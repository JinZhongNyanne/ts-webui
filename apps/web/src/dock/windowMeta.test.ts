import { describe, expect, it } from "vitest";
import { availableWindows, iconForPanel, WINDOW_META, windowPanelId } from "./windowMeta";

const ALL = { video: true, music: true, files: true };

describe("availableWindows", () => {
  it("lists every window when the hub offers everything", () => {
    expect(availableWindows(ALL)).toEqual([
      "tree",
      "apps",
      "sounds",
      "files",
      "video",
      "chat",
      "info",
      "music",
    ]);
  });

  it("drops the windows the hub has no feature for", () => {
    expect(availableWindows({ video: false, music: false, files: false })).toEqual([
      "tree",
      "apps",
      "sounds",
      "chat",
      "info",
    ]);
  });

  it("drops only the missing one", () => {
    expect(availableWindows({ ...ALL, music: false })).not.toContain("music");
    expect(availableWindows({ ...ALL, music: false })).toContain("video");
  });
});

describe("windowPanelId", () => {
  it("maps the chat button to the server chat panel", () => {
    expect(windowPanelId("chat")).toBe("chat:server");
  });

  it("leaves every other window's id alone", () => {
    expect(windowPanelId("tree")).toBe("tree");
    expect(windowPanelId("music")).toBe("music");
  });
});

describe("iconForPanel", () => {
  it("gives a static panel its own icon", () => {
    expect(iconForPanel("tree")).toBe(WINDOW_META.tree.icon);
  });

  it("gives every conversation the chat icon", () => {
    expect(iconForPanel("chat:server")).toBe(WINDOW_META.chat.icon);
    expect(iconForPanel("chat:channel:7")).toBe(WINDOW_META.chat.icon);
    expect(iconForPanel("chat:client:42")).toBe(WINDOW_META.chat.icon);
  });

  it("falls back to a neutral icon for a panel it does not know", () => {
    expect(iconForPanel("something-new")).toBe("▫");
  });
});

describe("WINDOW_META", () => {
  it("has an entry for every window", () => {
    for (const id of availableWindows(ALL)) {
      expect(WINDOW_META[id]).toBeDefined();
      expect(WINDOW_META[id].icon).not.toBe("");
    }
  });
});
