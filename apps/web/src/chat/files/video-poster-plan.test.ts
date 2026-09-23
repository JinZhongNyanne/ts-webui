import { describe, expect, it } from "vitest";
import {
  POSTER_STILL_MAX_HEIGHT,
  POSTER_STILL_MAX_WIDTH,
  posterStep,
  posterStillSize,
  type PosterPhase,
} from "./video-poster-plan";

describe("posterStep", () => {
  it("captures at once when the first frame came with the metadata", () => {
    expect(posterStep("loading", { kind: "metadata", hasFrame: true })).toEqual({
      phase: "settled",
      action: "capture",
    });
  });

  it("waits for the first frame when only the metadata is here", () => {
    expect(posterStep("loading", { kind: "metadata", hasFrame: false })).toEqual({
      phase: "awaitingFrame",
      action: "waitForFrame",
    });
    expect(posterStep("awaitingFrame", { kind: "frame" })).toEqual({
      phase: "settled",
      action: "capture",
    });
  });

  it("gives up on a still that never comes, but still lets the player open", () => {
    expect(posterStep("awaitingFrame", { kind: "frameTimeout" })).toEqual({
      phase: "settled",
      action: "drop",
    });
  });

  it("fails a file the browser will not load, before or after its metadata", () => {
    for (const phase of ["loading", "awaitingFrame"] as PosterPhase[]) {
      expect(posterStep(phase, { kind: "error" })).toEqual({ phase: "settled", action: "fail" });
    }
  });

  it("does nothing more once settled: the stream is released exactly once", () => {
    for (const event of [
      { kind: "metadata", hasFrame: true },
      { kind: "frame" },
      { kind: "frameTimeout" },
      { kind: "error" },
    ] as const) {
      expect(posterStep("settled", event)).toEqual({ phase: "settled", action: "none" });
    }
  });

  it("ignores a stray timer before the metadata", () => {
    expect(posterStep("loading", { kind: "frameTimeout" })).toEqual({
      phase: "loading",
      action: "none",
    });
  });

  it("captures a frame even if its metadata event was never seen", () => {
    expect(posterStep("loading", { kind: "frame" })).toEqual({
      phase: "settled",
      action: "capture",
    });
  });
});

describe("posterStillSize", () => {
  it("keeps a small frame at its own size", () => {
    expect(posterStillSize(320, 180)).toEqual({ width: 320, height: 180 });
  });

  it("scales a large frame down into the still's box, keeping its shape", () => {
    expect(posterStillSize(3840, 2160)).toEqual({ width: POSTER_STILL_MAX_WIDTH, height: 293 });
    expect(posterStillSize(1080, 1920)).toEqual({ width: 225, height: POSTER_STILL_MAX_HEIGHT });
  });

  it("never rounds a sliver down to nothing", () => {
    expect(posterStillSize(10_000, 1)).toEqual({ width: POSTER_STILL_MAX_WIDTH, height: 1 });
  });

  it("has no still for a frame without a size", () => {
    expect(posterStillSize(0, 180)).toBeNull();
    expect(posterStillSize(320, Number.NaN)).toBeNull();
  });
});
