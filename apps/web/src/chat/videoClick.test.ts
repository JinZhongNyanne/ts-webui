import { describe, expect, it } from "vitest";
import { opensVideoViewer, type ClickedVideo } from "./videoClick";

const poster = (over: Partial<ClickedVideo> = {}): ClickedVideo => ({
  isVideo: true,
  isRenderedPoster: true,
  hasFrame: true,
  onButton: false,
  menuOpen: false,
  ...over,
});

describe("opensVideoViewer", () => {
  it("opens the player for a click on the poster itself", () => {
    expect(opensVideoViewer(poster())).toBe(true);
  });

  it.each([
    ["something that is not a video", { isVideo: false }],
    ["a video none of our making", { isRenderedPoster: false }],
    ["a poster with no frame to show yet", { hasFrame: false }],
    ["a press that landed on a button", { onButton: true }],
    ["a click that follows a held finger's menu", { menuOpen: true }],
  ])("leaves %s alone", (_what, over) => {
    expect(opensVideoViewer(poster(over))).toBe(false);
  });
});
