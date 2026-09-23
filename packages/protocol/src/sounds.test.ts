import { describe, expect, it } from "vitest";
import {
  MAX_SOUND_NAME_LENGTH,
  MAX_SOUND_VOLUME,
  normalizeSoundName,
  isSoundVolume,
  clampSoundVolume,
  sniffSoundType,
  soundNameFromFile,
} from "./sounds.js";

const bytes = (...parts: (string | number[])[]): Uint8Array =>
  Uint8Array.from(
    parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );

describe("normalizeSoundName", () => {
  it("trims and folds runs of whitespace", () =>
    expect(normalizeSoundName("  air   horn \n")).toBe("air horn"));

  it("drops control characters", () => expect(normalizeSoundName("a\u0000b\u200bc")).toBe("abc"));

  it("refuses empty and over-long names", () => {
    expect(normalizeSoundName("   ")).toBeNull();
    expect(normalizeSoundName("x".repeat(MAX_SOUND_NAME_LENGTH))).toHaveLength(32);
    expect(normalizeSoundName("x".repeat(MAX_SOUND_NAME_LENGTH + 1))).toBeNull();
  });

  it("counts characters, not UTF-16 units", () =>
    expect(normalizeSoundName("😂".repeat(MAX_SOUND_NAME_LENGTH))).not.toBeNull());

  it("refuses non-strings", () => expect(normalizeSoundName(5 as unknown as string)).toBeNull());
});

describe("soundNameFromFile", () => {
  it("drops the extension and path", () =>
    expect(soundNameFromFile("C:\\sfx\\air_horn.mp3")).toBe("air_horn"));
  it("cuts a long name to the limit", () =>
    expect(soundNameFromFile(`${"y".repeat(50)}.ogg`)).toHaveLength(MAX_SOUND_NAME_LENGTH));
  it("falls back to a default for a bare extension", () =>
    expect(soundNameFromFile(".wav")).toBe("sound"));
});

describe("sound volume", () => {
  it("accepts whole percents from 0 to the maximum", () => {
    expect(isSoundVolume(0)).toBe(true);
    expect(isSoundVolume(MAX_SOUND_VOLUME)).toBe(true);
    expect(isSoundVolume(MAX_SOUND_VOLUME + 1)).toBe(false);
    expect(isSoundVolume(-1)).toBe(false);
    expect(isSoundVolume(50.5)).toBe(false);
    expect(isSoundVolume(Number.NaN)).toBe(false);
    expect(isSoundVolume("50")).toBe(false);
  });

  it("clamps and rounds what a slider produces", () => {
    expect(clampSoundVolume(250)).toBe(MAX_SOUND_VOLUME);
    expect(clampSoundVolume(-3)).toBe(0);
    expect(clampSoundVolume(33.6)).toBe(34);
    expect(clampSoundVolume(Number.NaN)).toBe(100);
  });
});

describe("sniffSoundType", () => {
  it("recognises the supported containers by their first bytes", () => {
    expect(sniffSoundType(bytes("ID3", [4, 0, 0, 0]))).toBe("audio/mpeg");
    expect(sniffSoundType(bytes([0xff, 0xfb, 0x90, 0x44]))).toBe("audio/mpeg");
    expect(sniffSoundType(bytes("OggS", [0, 2]))).toBe("audio/ogg");
    expect(sniffSoundType(bytes("RIFF", [36, 0, 0, 0], "WAVEfmt "))).toBe("audio/wav");
    expect(sniffSoundType(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84], "webm"))).toBe(
      "audio/webm",
    );
    expect(sniffSoundType(bytes([0, 0, 0, 0x20], "ftypM4A ", [0, 0, 0, 0]))).toBe("audio/mp4");
  });

  it("refuses everything else", () => {
    expect(sniffSoundType(bytes("<html>"))).toBeNull();
    expect(sniffSoundType(bytes([0x89], "PNG\r\n"))).toBeNull();
    expect(sniffSoundType(bytes("RIFF", [0, 0, 0, 0], "AVI "))).toBeNull();
    // A Matroska file that is not WebM.
    expect(sniffSoundType(bytes([0x1a, 0x45, 0xdf, 0xa3], "matroska"))).toBeNull();
    // 0xFF 0xE0 with the reserved layer bits is no MPEG audio frame.
    expect(sniffSoundType(bytes([0xff, 0xe0, 0, 0]))).toBeNull();
    expect(sniffSoundType(new Uint8Array(0))).toBeNull();
  });
});
