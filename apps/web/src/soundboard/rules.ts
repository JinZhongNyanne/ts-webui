/**
 * The soundboard's page-side rules, pure so they can be tested without a
 * browser: what may be uploaded (checked before the hub sees it), when a clip
 * may go out into the channel, and the anti-spam limits on playing.
 */
import {
  MAX_SOUND_BYTES,
  MAX_SOUND_SECONDS,
  MAX_SOUNDS,
  clampSoundVolume,
  sniffSoundType,
} from "@jinz/protocol";

export type UploadError =
  "full" | "empty" | "tooBig" | "type" | "tooLong" | "decode" | "name" | "failed";

export type PlayBlock = "notConnected" | "muted" | "noTalkPower" | "codec";

/** Minimum gap between two clips this user starts, so a stuck click cannot spam. */
export const CLIP_COOLDOWN_MS = 300;
/** Clips this user may have playing at once. */
export const MAX_PLAYING_CLIPS = 4;
/** Decoders pad a few ms of silence onto some formats; that is not "too long". */
const DURATION_SLACK_S = 0.1;

/** What stops a file from being uploaded, before it is decoded; null when nothing. */
export function checkUploadFile(size: number, head: Uint8Array, count: number): UploadError | null {
  if (count >= MAX_SOUNDS) return "full";
  if (size <= 0) return "empty";
  if (size > MAX_SOUND_BYTES) return "tooBig";
  if (!sniffSoundType(head)) return "type";
  return null;
}

/** Whether a decoded clip is short enough; a clip that decoded to nothing is broken. */
export function checkDuration(seconds: number): UploadError | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return "decode";
  return seconds > MAX_SOUND_SECONDS + DURATION_SLACK_S ? "tooLong" : null;
}

/**
 * Why a clip may not go out into the channel right now; null when it may.
 *
 * Without talk power the transmit gate (audio/gate.ts) sends nothing, so a
 * clip would only play to us while we believed the channel heard it; it is
 * refused instead. Holding the whisper key sends the clip to the whisper
 * targets, which talk power does not govern, so that still lets it out.
 */
export function playBlocker(state: {
  connected: boolean;
  inputMuted: boolean;
  codecSupported: boolean;
  /** We have the talk power our channel asks for. */
  canTalk: boolean;
  /** The whisper hold-key is down. */
  whisperPressed: boolean;
}): PlayBlock | null {
  if (!state.connected) return "notConnected";
  if (state.inputMuted) return "muted";
  if (!state.canTalk && !state.whisperPressed) return "noTalkPower";
  if (!state.codecSupported) return "codec";
  return null;
}

export interface Cooldown {
  /** True (and the cooldown restarts) when enough time has passed since the last one. */
  take(now: number): boolean;
}

export function createCooldown(ms: number): Cooldown {
  let next = -Infinity;
  return {
    take(now) {
      if (now < next) return false;
      next = now + ms;
      return true;
    },
  };
}

/** One more clip of `id` playing. */
export function countUp(
  counts: Readonly<Record<string, number>>,
  id: string,
): Record<string, number> {
  return { ...counts, [id]: (counts[id] ?? 0) + 1 };
}

/** One clip of `id` fewer; the key goes when none are left. */
export function countDown(
  counts: Readonly<Record<string, number>>,
  id: string,
): Record<string, number> {
  const { [id]: current = 0, ...rest } = counts;
  return current > 1 ? { ...rest, [id]: current - 1 } : rest;
}

/** A stored percent as a linear gain. */
export function volumeToGain(percent: number): number {
  return clampSoundVolume(percent) / 100;
}
