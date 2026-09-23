import { describe, expect, it } from "vitest";
import { VOLUME_STEP } from "../volume/quickVolume";
import {
  SEEK_STEP_S,
  VIDEO_VOLUME_MAX,
  clampMediaTime,
  clampMediaVolume,
  formatMediaTime,
  mediaVolumePercent,
  seekBy,
  startsMuted,
  stepMediaVolume,
  timeAtFraction,
  timeFraction,
  volumeAfterUnmute,
} from "./playback";

describe("formatMediaTime", () => {
  it("counts minutes and seconds, and hours only when there are any", () => {
    expect(formatMediaTime(0)).toBe("0:00");
    expect(formatMediaTime(9)).toBe("0:09");
    expect(formatMediaTime(65)).toBe("1:05");
    expect(formatMediaTime(600)).toBe("10:00");
    expect(formatMediaTime(3599)).toBe("59:59");
    expect(formatMediaTime(3600)).toBe("1:00:00");
    expect(formatMediaTime(3661)).toBe("1:01:01");
  });

  it("shows a duration nothing is known about as nothing, never as NaN", () => {
    // A `<video>` reports NaN for the duration until its metadata is in, and
    // Infinity for a stream, and the toolbar must read as a clock throughout.
    expect(formatMediaTime(Number.NaN)).toBe("0:00");
    expect(formatMediaTime(Number.POSITIVE_INFINITY)).toBe("0:00");
    expect(formatMediaTime(-3)).toBe("0:00");
  });
});

describe("clampMediaTime", () => {
  it("keeps a position inside the video", () => {
    expect(clampMediaTime(5, 10)).toBe(5);
    expect(clampMediaTime(-2, 10)).toBe(0);
    expect(clampMediaTime(99, 10)).toBe(10);
  });

  it("is the start while the duration is unknown", () => {
    expect(clampMediaTime(5, Number.NaN)).toBe(0);
    expect(clampMediaTime(5, 0)).toBe(0);
  });
});

describe("seekBy", () => {
  it("steps forwards and backwards without leaving the video", () => {
    expect(seekBy(10, 60, SEEK_STEP_S)).toBe(15);
    expect(seekBy(10, 60, -SEEK_STEP_S)).toBe(5);
    expect(seekBy(2, 60, -SEEK_STEP_S)).toBe(0);
    expect(seekBy(58, 60, SEEK_STEP_S)).toBe(60);
  });
});

describe("timeFraction and timeAtFraction", () => {
  it("are two views of one position", () => {
    expect(timeFraction(30, 60)).toBe(0.5);
    expect(timeAtFraction(0.5, 60)).toBe(30);
  });

  it("read an unknown or empty duration as the start", () => {
    expect(timeFraction(30, Number.NaN)).toBe(0);
    expect(timeFraction(30, 0)).toBe(0);
    expect(timeAtFraction(0.5, Number.NaN)).toBe(0);
  });

  it("refuses a fraction from outside the slider", () => {
    expect(timeFraction(90, 60)).toBe(1);
    expect(timeAtFraction(-1, 60)).toBe(0);
    expect(timeAtFraction(2, 60)).toBe(60);
    expect(timeAtFraction(Number.NaN, 60)).toBe(0);
  });
});

describe("the player's volume", () => {
  it("is a fractional gain in the voice app's own notches, capped at what a media element takes", () => {
    expect(clampMediaVolume(0.5)).toBe(0.5);
    expect(clampMediaVolume(0)).toBe(0);
    expect(clampMediaVolume(9)).toBe(VIDEO_VOLUME_MAX);
    expect(clampMediaVolume(-1)).toBe(0);
    expect(VIDEO_VOLUME_MAX).toBe(1);
  });

  it("snaps to the status bar's step, so repeated nudges never drift", () => {
    let v = 0;
    for (let i = 0; i < 4; i++) v = stepMediaVolume(v, 1);
    expect(v).toBe(4 * VOLUME_STEP);
    expect(stepMediaVolume(1, 1)).toBe(VIDEO_VOLUME_MAX);
    expect(stepMediaVolume(0, -1)).toBe(0);
  });

  it("shows itself as a whole percent", () => {
    expect(mediaVolumePercent(1)).toBe(100);
    expect(mediaVolumePercent(0.35)).toBe(35);
    expect(mediaVolumePercent(0)).toBe(0);
  });

  it("comes back audible when unmuted from silence", () => {
    // Unmuting a video whose volume is 0 would otherwise do nothing at all.
    expect(volumeAfterUnmute(0)).toBe(VIDEO_VOLUME_MAX);
    expect(volumeAfterUnmute(0.4)).toBe(0.4);
  });
});

describe("startsMuted", () => {
  it("opens a video silent while the user is in a call, audible otherwise", () => {
    // This is a voice app: a clip must never talk over a conversation that is
    // already happening. One press on the mute button is all it takes.
    expect(startsMuted(true)).toBe(true);
    expect(startsMuted(false)).toBe(false);
  });
});
