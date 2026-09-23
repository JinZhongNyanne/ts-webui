import { describe, expect, it } from "vitest";
import { DEFAULT_SOUND_VOLUME, MAX_SOUND_VOLUME } from "@jinz/protocol";
import {
  CLIP_VOLUME_MAX,
  CLIP_VOLUME_MIN,
  CLIP_VOLUME_STEP,
  draftFromSlider,
  draftFromText,
  parseClipVolume,
  settleDraft,
  shouldCommitVolume,
  snapClipVolume,
  stepClipVolume,
  volumeDraft,
} from "./clipVolume";

describe("clip volume bounds", () => {
  it("matches the range the hub stores", () => {
    expect(CLIP_VOLUME_MIN).toBe(0);
    expect(CLIP_VOLUME_MAX).toBe(MAX_SOUND_VOLUME);
  });
});

describe("snapClipVolume", () => {
  it("keeps a whole percent in range", () => {
    expect(snapClipVolume(100)).toBe(100);
    expect(snapClipVolume(0)).toBe(CLIP_VOLUME_MIN);
    expect(snapClipVolume(MAX_SOUND_VOLUME)).toBe(CLIP_VOLUME_MAX);
  });

  it("clamps outside the range", () => {
    expect(snapClipVolume(-30)).toBe(CLIP_VOLUME_MIN);
    expect(snapClipVolume(9000)).toBe(CLIP_VOLUME_MAX);
  });

  it("snaps to the slider notch", () => {
    expect(snapClipVolume(102)).toBe(100);
    expect(snapClipVolume(103)).toBe(105);
  });

  it("falls back to the default for nonsense", () => {
    expect(snapClipVolume(Number.NaN)).toBe(DEFAULT_SOUND_VOLUME);
    expect(snapClipVolume(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SOUND_VOLUME);
  });
});

describe("stepClipVolume", () => {
  it("nudges by whole notches in either direction", () => {
    expect(stepClipVolume(100, 1)).toBe(100 + CLIP_VOLUME_STEP);
    expect(stepClipVolume(100, -1)).toBe(100 - CLIP_VOLUME_STEP);
  });

  it("never leaves the range", () => {
    expect(stepClipVolume(CLIP_VOLUME_MAX, 1)).toBe(CLIP_VOLUME_MAX);
    expect(stepClipVolume(CLIP_VOLUME_MIN, -1)).toBe(CLIP_VOLUME_MIN);
  });
});

describe("parseClipVolume", () => {
  it("accepts a whole percent, with or without a sign of percentage", () => {
    expect(parseClipVolume("0")).toBe(0);
    expect(parseClipVolume(" 75 ")).toBe(75);
    expect(parseClipVolume("120%")).toBe(120);
  });

  it("rejects anything that is not a whole number", () => {
    expect(parseClipVolume("")).toBeNull();
    expect(parseClipVolume("loud")).toBeNull();
    expect(parseClipVolume("50.5")).toBeNull();
    expect(parseClipVolume("1e2")).toBeNull();
    expect(parseClipVolume("--5")).toBeNull();
  });

  it("rejects rather than silently clamping an out-of-range value", () => {
    expect(parseClipVolume("-1")).toBeNull();
    expect(parseClipVolume(String(MAX_SOUND_VOLUME + 1))).toBeNull();
  });
});

describe("volumeDraft", () => {
  it("shows the shared volume as a plain percent", () => {
    expect(volumeDraft(80)).toEqual({ value: 80, text: "80", invalid: false });
  });

  it("never starts from a value the hub would refuse", () => {
    expect(volumeDraft(9000)).toEqual({ value: CLIP_VOLUME_MAX, text: "200", invalid: false });
  });
});

describe("draftFromSlider", () => {
  it("keeps the slider and the value box in step", () => {
    expect(draftFromSlider(45)).toEqual({ value: 45, text: "45", invalid: false });
  });

  it("reads the raw string a range input hands over", () => {
    expect(draftFromSlider("45")).toEqual({ value: 45, text: "45", invalid: false });
  });
});

describe("draftFromText", () => {
  const from = volumeDraft(100);

  it("moves the value when the typed percent is usable", () => {
    expect(draftFromText(from, "130")).toEqual({ value: 130, text: "130", invalid: false });
  });

  it("keeps the last good value but flags the typing when it is not", () => {
    expect(draftFromText(from, "12x")).toEqual({ value: 100, text: "12x", invalid: true });
  });

  it("flags an out-of-range percent instead of sending it", () => {
    expect(draftFromText(from, "500")).toEqual({ value: 100, text: "500", invalid: true });
  });

  it("leaves half-typed input alone so a minus or an empty box is not an error", () => {
    expect(draftFromText(from, "").invalid).toBe(false);
    expect(draftFromText(from, "").value).toBe(100);
  });
});

describe("settleDraft", () => {
  it("leaves a good draft as it is", () => {
    const good = draftFromText(volumeDraft(100), "130");
    expect(settleDraft(good)).toEqual(good);
  });

  it("falls the text back to the last good value", () => {
    expect(settleDraft(draftFromText(volumeDraft(100), "500"))).toEqual({
      value: 100,
      text: "100",
      invalid: false,
    });
  });

  it("returns a new draft rather than editing the old one", () => {
    const bad = draftFromText(volumeDraft(100), "nope");
    settleDraft(bad);
    expect(bad).toEqual({ value: 100, text: "nope", invalid: true });
  });
});

describe("shouldCommitVolume", () => {
  it("sends only a real change", () => {
    expect(shouldCommitVolume(volumeDraft(120), 100)).toBe(true);
    expect(shouldCommitVolume(volumeDraft(100), 100)).toBe(false);
  });

  it("sends nothing while the value box holds rubbish", () => {
    expect(shouldCommitVolume(draftFromText(volumeDraft(100), "oops"), 55)).toBe(false);
  });
});
