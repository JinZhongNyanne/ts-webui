import { describe, expect, it } from "vitest";
import { appliedFrom, DEFAULT_PROCESSING, micConstraints, needsNewTrack } from "./processing";

describe("micConstraints", () => {
  it("passes each switch through separately", () => {
    const c = micConstraints({ ...DEFAULT_PROCESSING, echoCancellation: false });
    expect(c).toMatchObject({
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: true,
    });
    expect(c.deviceId).toBeUndefined();
  });

  it("pins the chosen device", () => {
    expect(micConstraints(DEFAULT_PROCESSING, "abc").deviceId).toEqual({ exact: "abc" });
  });

  it("keeps the old always-on behaviour by default", () => {
    expect(DEFAULT_PROCESSING).toEqual({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      rnnoise: false,
    });
  });
});

describe("needsNewTrack", () => {
  it("reopens the track for browser-side switches only", () => {
    const d = DEFAULT_PROCESSING;
    expect(needsNewTrack(d, { ...d, autoGainControl: false })).toBe(true);
    expect(needsNewTrack(d, { ...d, noiseSuppression: false })).toBe(true);
    expect(needsNewTrack(d, { ...d, rnnoise: true })).toBe(false);
    expect(needsNewTrack(d, { ...d })).toBe(false);
  });
});

describe("appliedFrom", () => {
  it("reads booleans and marks what the browser did not report", () => {
    expect(appliedFrom({ echoCancellation: false, autoGainControl: true })).toEqual({
      echoCancellation: false,
      noiseSuppression: null,
      autoGainControl: true,
    });
  });
});
