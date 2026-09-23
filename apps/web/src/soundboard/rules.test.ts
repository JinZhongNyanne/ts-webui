import { describe, expect, it } from "vitest";
import { MAX_SOUND_BYTES, MAX_SOUND_SECONDS, MAX_SOUNDS } from "@jinz/protocol";
import {
  CLIP_COOLDOWN_MS,
  MAX_PLAYING_CLIPS,
  checkDuration,
  checkUploadFile,
  countDown,
  countUp,
  createCooldown,
  playBlocker,
  volumeToGain,
} from "./rules";

const WAV_HEAD = Uint8Array.from([..."RIFF\0\0\0\0WAVE"].map((c) => c.charCodeAt(0)));

describe("checkUploadFile", () => {
  it("passes a small audio file while there is room", () =>
    expect(checkUploadFile(1000, WAV_HEAD, 0)).toBeNull());

  it("says what is wrong, cheapest check first", () => {
    expect(checkUploadFile(1000, WAV_HEAD, MAX_SOUNDS)).toBe("full");
    expect(checkUploadFile(0, WAV_HEAD, 0)).toBe("empty");
    expect(checkUploadFile(MAX_SOUND_BYTES + 1, WAV_HEAD, 0)).toBe("tooBig");
    expect(checkUploadFile(1000, Uint8Array.from([1, 2, 3, 4]), 0)).toBe("type");
  });
});

describe("checkDuration", () => {
  it("allows up to the limit, with a hair of slack for encoder padding", () => {
    expect(checkDuration(MAX_SOUND_SECONDS)).toBeNull();
    expect(checkDuration(MAX_SOUND_SECONDS + 0.04)).toBeNull();
    expect(checkDuration(MAX_SOUND_SECONDS + 0.5)).toBe("tooLong");
    expect(checkDuration(0)).toBe("decode");
    expect(checkDuration(Number.NaN)).toBe("decode");
  });
});

describe("playBlocker", () => {
  const ok = {
    connected: true,
    inputMuted: false,
    codecSupported: true,
    canTalk: true,
    whisperPressed: false,
  };
  it("lets a clip out when nothing is in the way", () => expect(playBlocker(ok)).toBeNull());
  it("names the first obstacle", () => {
    expect(playBlocker({ ...ok, connected: false })).toBe("notConnected");
    expect(playBlocker({ ...ok, inputMuted: true })).toBe("muted");
    expect(playBlocker({ ...ok, canTalk: false })).toBe("noTalkPower");
    expect(playBlocker({ ...ok, codecSupported: false })).toBe("codec");
  });
  it("lets a clip out to the whisper targets without talk power while whispering", () =>
    expect(playBlocker({ ...ok, canTalk: false, whisperPressed: true })).toBeNull());
});

describe("createCooldown", () => {
  it("lets one play through per cooldown", () => {
    const cooldown = createCooldown(CLIP_COOLDOWN_MS);
    expect(cooldown.take(1000)).toBe(true);
    expect(cooldown.take(1000 + CLIP_COOLDOWN_MS - 1)).toBe(false);
    expect(cooldown.take(1000 + CLIP_COOLDOWN_MS)).toBe(true);
  });
});

describe("playing counts", () => {
  it("count clips per sound without touching the old map", () => {
    const empty: Readonly<Record<string, number>> = {};
    const one = countUp(empty, "a");
    const two = countUp(one, "a");
    expect(empty).toEqual({});
    expect(two).toEqual({ a: 2 });
    expect(countDown(two, "a")).toEqual({ a: 1 });
    expect(countDown(one, "a")).toEqual({});
    expect(countDown(empty, "a")).toEqual({});
  });

  it("cap how many clips play at once", () => expect(MAX_PLAYING_CLIPS).toBeGreaterThan(1));
});

describe("volumeToGain", () => {
  it("maps percent to a linear gain", () => {
    expect(volumeToGain(100)).toBe(1);
    expect(volumeToGain(200)).toBe(2);
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(500)).toBe(2);
  });
});
