import { beforeEach, describe, expect, it } from "vitest";
import { closeMediaViewer, openPictureViewer, openVideoViewer, viewedMedia } from "./media-viewer";

describe("the media viewer's slot", () => {
  beforeEach(closeMediaViewer);

  it("shows the picture it is opened with", () => {
    openPictureViewer({ url: "blob:one", name: "cat.png" });
    expect(viewedMedia.value).toEqual({ kind: "picture", url: "blob:one", name: "cat.png" });
  });

  it("shows the video it is opened with", () => {
    openVideoViewer({ url: "blob:clip", name: "clip.mp4" });
    expect(viewedMedia.value).toEqual({ kind: "video", url: "blob:clip", name: "clip.mp4" });
  });

  it("holds one picture at a time", () => {
    openPictureViewer({ url: "blob:one", name: "cat.png" });
    openPictureViewer({ url: "blob:two", name: "dog.png" });
    expect(viewedMedia.value?.url).toBe("blob:two");
  });

  it("holds one thing at a time whatever kind it is", () => {
    // One slot, one overlay, one layer above the desktop: a video opened over
    // a picture replaces it rather than stacking on top of it.
    openPictureViewer({ url: "blob:one", name: "cat.png" });
    openVideoViewer({ url: "blob:clip", name: "clip.mp4" });
    expect(viewedMedia.value).toEqual({ kind: "video", url: "blob:clip", name: "clip.mp4" });
  });

  it("closes", () => {
    openVideoViewer({ url: "blob:clip", name: "clip.mp4" });
    closeMediaViewer();
    expect(viewedMedia.value).toBeNull();
  });

  it.each([openPictureViewer, openVideoViewer])("opens nothing without an address", (open) => {
    // Nothing to show, and an empty `src` would ask the page for itself.
    open({ url: "", name: "cat.png" });
    expect(viewedMedia.value).toBeNull();
  });
});
