/**
 * Pure logic behind the clip-volume popover. A clip's volume is a whole
 * percent the hub stores and everyone shares, so it is not the same quantity as
 * the status bar's gains in `volume/quickVolume.ts` (0–2, fractional): the
 * bounds here come from the protocol, which is what the hub validates against.
 *
 * The slider and the value box are two views of one number, and typing is
 * allowed to be momentarily unusable ("1", "", "1x") without anything being
 * sent. A draft therefore carries the last good value alongside the raw text,
 * so a rejected edit falls back instead of reaching the hub as rubbish. Drafts
 * are replaced, never edited in place.
 */
import { clampSoundVolume, DEFAULT_SOUND_VOLUME, MAX_SOUND_VOLUME } from "@jinz/protocol";

export const CLIP_VOLUME_MIN = 0;
export const CLIP_VOLUME_MAX = MAX_SOUND_VOLUME;
export const CLIP_VOLUME_DEFAULT = DEFAULT_SOUND_VOLUME;
/** One notch of the slider and of an arrow key; the box still takes any percent. */
export const CLIP_VOLUME_STEP = 5;

/** What the popover shows: one value, the text the box holds, and whether that text is usable. */
export interface VolumeDraft {
  /** The last percent good enough to send. */
  readonly value: number;
  /** Exactly what the value box shows, which may be mid-typing. */
  readonly text: string;
  /** True when the text is finished enough to judge and the answer is "no". */
  readonly invalid: boolean;
}

/** A percent the hub would accept, snapped to the slider's notches. */
export function snapClipVolume(value: number): number {
  if (!Number.isFinite(value)) return CLIP_VOLUME_DEFAULT;
  const clamped = clampSoundVolume(value);
  return clampSoundVolume(Math.round(clamped / CLIP_VOLUME_STEP) * CLIP_VOLUME_STEP);
}

/** Moves `notches` steps up (positive) or down (negative), staying in range. */
export function stepClipVolume(current: number, notches: number): number {
  if (!Number.isFinite(notches)) return snapClipVolume(current);
  return snapClipVolume(snapClipVolume(current) + notches * CLIP_VOLUME_STEP);
}

/** Whole percents only, `%` and surrounding spaces tolerated; null when unusable. */
export function parseClipVolume(text: string): number | null {
  const trimmed = text.trim().replace(/%$/, "").trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < CLIP_VOLUME_MIN || value > CLIP_VOLUME_MAX) return null;
  return value;
}

/** The draft the popover opens with: the shared volume, shown as a plain percent. */
export function volumeDraft(volume: number): VolumeDraft {
  const value = clampSoundVolume(volume);
  return { value, text: String(value), invalid: false };
}

/** The draft after the slider moved; the box follows it exactly. */
export function draftFromSlider(raw: number | string): VolumeDraft {
  return volumeDraft(snapClipVolume(Number(raw)));
}

/**
 * The draft after a keystroke in the value box. Empty or bare-sign text is
 * someone still typing, so it is shown without complaint and without moving the
 * value; anything else that will not parse is flagged there and then.
 */
export function draftFromText(draft: VolumeDraft, text: string): VolumeDraft {
  const parsed = parseClipVolume(text);
  if (parsed !== null) return { value: parsed, text, invalid: false };
  const unfinished = text.trim() === "" || text.trim() === "-" || text.trim() === "+";
  return { value: draft.value, text, invalid: !unfinished };
}

/**
 * The draft once the user is done with the box (blur, Enter, or a commit): the
 * text falls back to the last good value unless it already says exactly that,
 * so nothing is left on screen that the hub never agreed to.
 */
export function settleDraft(draft: VolumeDraft): VolumeDraft {
  return parseClipVolume(draft.text) === draft.value ? draft : volumeDraft(draft.value);
}

/** Only a usable draft that really differs from the shared volume is worth sending. */
export function shouldCommitVolume(draft: VolumeDraft, shared: number): boolean {
  return !draft.invalid && draft.value !== clampSoundVolume(shared);
}
