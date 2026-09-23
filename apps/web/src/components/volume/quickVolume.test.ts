import { describe, expect, it } from "vitest";
import {
  clampVolume,
  stepVolume,
  volumePercent,
  VOLUME_DEFAULT,
  VOLUME_MAX,
  VOLUME_MIN,
  VOLUME_STEP,
} from "./quickVolume";

describe("clampVolume", () => {
  it("keeps in-range values", () => {
    expect(clampVolume(1)).toBe(1);
    expect(clampVolume(0.5)).toBe(0.5);
  });

  it("clamps to the supported range", () => {
    expect(clampVolume(-1)).toBe(VOLUME_MIN);
    expect(clampVolume(5)).toBe(VOLUME_MAX);
  });

  it("snaps to the slider step", () => {
    expect(clampVolume(0.1 + 0.2)).toBeCloseTo(0.3, 10);
    expect(clampVolume(0.3)).toBe(0.3);
  });

  it("falls back to the default for non-finite input", () => {
    expect(clampVolume(Number.NaN)).toBe(VOLUME_DEFAULT);
    expect(clampVolume(Number.POSITIVE_INFINITY)).toBe(VOLUME_DEFAULT);
  });
});

describe("stepVolume", () => {
  it("raises on scroll up and lowers on scroll down", () => {
    expect(stepVolume(1, -100)).toBeCloseTo(1 + VOLUME_STEP, 10);
    expect(stepVolume(1, 100)).toBeCloseTo(1 - VOLUME_STEP, 10);
  });

  it("never leaves the range", () => {
    expect(stepVolume(VOLUME_MAX, -100)).toBe(VOLUME_MAX);
    expect(stepVolume(VOLUME_MIN, 100)).toBe(VOLUME_MIN);
  });

  it("does not drift across many notches", () => {
    const result = Array.from({ length: 6 }, () => -1).reduce(
      (acc, delta) => stepVolume(acc, delta),
      0,
    );
    expect(result).toBeCloseTo(0.3, 10);
  });

  it("ignores a zero or invalid delta", () => {
    expect(stepVolume(0.75, 0)).toBe(0.75);
    expect(stepVolume(0.75, Number.NaN)).toBe(0.75);
  });
});

describe("volumePercent", () => {
  it("maps 1 to 100 and rounds", () => {
    expect(volumePercent(1)).toBe(100);
    expect(volumePercent(0.05)).toBe(5);
    expect(volumePercent(2)).toBe(200);
  });
});
