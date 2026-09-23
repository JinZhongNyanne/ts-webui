/**
 * The soundboard's clips, shared by everyone on a hub, and the rules for
 * uploading and editing one. The hub enforces them; the page checks the same
 * rules first so the user gets an answer without a round trip.
 */

export interface SharedSound {
  readonly id: string;
  readonly name: string;
  /** Loudness in percent (0–MAX_SOUND_VOLUME), the same for everyone. */
  readonly volume: number;
  /** What the file really is, from its first bytes. */
  readonly contentType: SoundType;
  readonly bytes: number;
  /** Nickname of whoever uploaded it. */
  readonly addedBy: string;
  readonly addedAt: number;
}

export type SoundType = "audio/mpeg" | "audio/ogg" | "audio/wav" | "audio/webm" | "audio/mp4";

export const MAX_SOUNDS = 60;
export const MAX_SOUND_NAME_LENGTH = 32;
export const MAX_SOUND_BYTES = 1024 * 1024;
/** The page decodes a clip before uploading it; the hub cannot, and relies on the size cap. */
export const MAX_SOUND_SECONDS = 15;
export const MAX_SOUND_VOLUME = 200;
export const DEFAULT_SOUND_VOLUME = 100;

/** File extensions to store (and name) each type with. */
export const SOUND_EXTENSIONS: Readonly<Record<SoundType, string>> = {
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "audio/mp4": "m4a",
};

/** Control, format and zero-width characters: invisible in a tile, confusing in a name. */
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;

/** A clip name as stored: trimmed, single-spaced, 1–MAX_SOUND_NAME_LENGTH characters; else null. */
export function normalizeSoundName(input: string): string | null {
  if (typeof input !== "string") return null;
  const name = input.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  const length = [...name].length;
  return length >= 1 && length <= MAX_SOUND_NAME_LENGTH ? name : null;
}

/** The name a dropped file suggests: its base name without the extension. */
export function soundNameFromFile(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const stem = base.replace(/\.[^.]*$/, "");
  const cut = [...stem].slice(0, MAX_SOUND_NAME_LENGTH).join("");
  return normalizeSoundName(cut) ?? "sound";
}

/** True for a whole percent the hub will store. */
export function isSoundVolume(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_SOUND_VOLUME
  );
}

/** A slider value made storable: rounded and kept in range (NaN falls back to 100 %). */
export function clampSoundVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SOUND_VOLUME;
  return Math.min(MAX_SOUND_VOLUME, Math.max(0, Math.round(value)));
}

function ascii(data: Uint8Array, at: number, text: string): boolean {
  if (data.length < at + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (data[at + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function contains(data: Uint8Array, text: string, within: number): boolean {
  const end = Math.min(data.length, within) - text.length;
  for (let i = 0; i <= end; i++) if (ascii(data, i, text)) return true;
  return false;
}

/** An MPEG audio frame header: 11 sync bits, a valid version and layer. */
function isMpegFrame(data: Uint8Array): boolean {
  if (data.length < 2 || data[0] !== 0xff) return false;
  const b1 = data[1]!;
  return (b1 & 0xe0) === 0xe0 && (b1 & 0x18) !== 0x08 && (b1 & 0x06) !== 0;
}

/**
 * What a clip really is, judged from its first bytes (a few KB suffice), or
 * null when it is none of the supported kinds. The browser's claimed type is
 * never used: it comes from the file name.
 */
export function sniffSoundType(data: Uint8Array): SoundType | null {
  if (ascii(data, 0, "ID3") || isMpegFrame(data)) return "audio/mpeg";
  if (ascii(data, 0, "OggS")) return "audio/ogg";
  if (ascii(data, 0, "RIFF") && ascii(data, 8, "WAVE")) return "audio/wav";
  // EBML, with the WebM doc type in its header (plain Matroska is refused).
  if (data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) {
    return contains(data, "webm", 64) ? "audio/webm" : null;
  }
  if (ascii(data, 4, "ftyp")) return "audio/mp4";
  return null;
}
