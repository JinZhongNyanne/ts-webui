import { describe, expect, it } from "vitest";
import { PREVIEW_MAX_BYTES, VIDEO_MAX_BYTES, canPlayVideo, canPreview, readCard } from "./card";

describe("readCard", () => {
  it("reads a card's file", () => {
    expect(readCard({ ftCid: "5", ftPath: "/a b.png", ftSize: "12" })).toEqual({
      cid: "5",
      path: "/a b.png",
      size: 12,
    });
    expect(readCard({ ftCid: "5", ftPath: "/x" })).toEqual({ cid: "5", path: "/x" });
  });

  it.each([
    [{ ftPath: "/a" }],
    [{ ftCid: "5x", ftPath: "/a" }],
    [{ ftCid: "5", ftPath: "/../a" }],
    [{ ftCid: "5", ftPath: "/" }],
    [{ ftCid: "5", ftPath: "a" }],
    [{ ftCid: "5", ftPath: "/a/" }],
    // Channel 0 is the server's own store (avatars and icons), not a channel.
    [{ ftCid: "0", ftPath: "/avatar_x" }],
  ])("refuses %j", (data) => {
    expect(readCard(data)).toBeNull();
  });

  it("ignores a size that is not a number", () => {
    expect(readCard({ ftCid: "5", ftPath: "/a", ftSize: "-1" })).toEqual({ cid: "5", path: "/a" });
  });
});

describe("canPreview", () => {
  it("previews up to the limit, and when the size is unknown", () => {
    expect(canPreview(PREVIEW_MAX_BYTES)).toBe(true);
    expect(canPreview(PREVIEW_MAX_BYTES + 1)).toBe(false);
    expect(canPreview(undefined)).toBe(true);
  });
});

describe("canPlayVideo", () => {
  it("plays up to the video limit, and when the size is unknown", () => {
    expect(canPlayVideo(VIDEO_MAX_BYTES)).toBe(true);
    expect(canPlayVideo(VIDEO_MAX_BYTES + 1)).toBe(false);
    expect(canPlayVideo(undefined)).toBe(true);
  });

  it("plays a streamed video of any size: nothing is fetched whole", () => {
    expect(canPlayVideo(VIDEO_MAX_BYTES + 1, true)).toBe(true);
    expect(canPlayVideo(50 * 1024 ** 3, true)).toBe(true);
    expect(canPlayVideo(undefined, true)).toBe(true);
    expect(canPlayVideo(VIDEO_MAX_BYTES + 1, false)).toBe(false);
  });

  it("allows a video to be larger than a picture may be", () => {
    // A picture is one screenful; a clip is seconds of one, so the two limits
    // are not the same number for the same reason.
    expect(VIDEO_MAX_BYTES).toBeGreaterThan(PREVIEW_MAX_BYTES);
  });
});
