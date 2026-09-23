/**
 * The arithmetic behind the video player's transport bar (`VideoViewer.vue`),
 * kept here and free of the DOM for the same reason `zoom.ts` is: a clock that
 * says "NaN:aN" and a slider that can be dragged past the end of a clip are
 * bugs worth having tests for, and a `<video>` element cannot be had in these
 * tests at all.
 *
 * ## The volume is the voice app's own quantity
 *
 * A video's loudness is a fractional gain this listener chose for themselves,
 * exactly like the master gain in the status bar, so it reuses
 * `volume/quickVolume.ts` — the same 0.05 notches, the same whole-percent
 * label, the same drift-free snapping — rather than becoming a third idiom
 * beside that one and the soundboard's shared whole percents
 * (`soundboard/clipVolume.ts`, which are the server's business, not this
 * page's). The one thing that does differ is the ceiling: quickVolume goes to
 * 2 because the voice engine can amplify in software, while
 * `HTMLMediaElement.volume` is defined only over 0…1 and silently clamps
 * anything above it. Promising 200% and delivering 100% would be a lie, so the
 * ceiling below is the element's and the slider stops there.
 */
import { VOLUME_STEP, clampVolume, volumePercent } from "../volume/quickVolume";

/** One arrow-key nudge along the video, in seconds. */
export const SEEK_STEP_S = 5;
/** What `HTMLMediaElement.volume` accepts at most; louder is not on offer. */
export const VIDEO_VOLUME_MAX = 1;

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

/** A duration that is a real number of seconds; 0 for the NaN a `<video>` starts with. */
function realSeconds(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * "1:05", or "1:01:01" once there are hours. Anything unknowable — the NaN a
 * `<video>` reports before its metadata arrives, the Infinity of a stream, a
 * negative from arithmetic that went wrong — reads as the start, because the
 * bar must look like a clock from the first frame it is on screen.
 */
export function formatMediaTime(seconds: number): string {
  const whole = Math.floor(realSeconds(seconds));
  const hours = Math.floor(whole / SECONDS_PER_HOUR);
  const minutes = Math.floor((whole % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const rest = whole % SECONDS_PER_MINUTE;
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(rest)}`;
  return `${minutes}:${pad(rest)}`;
}

/** `seconds` brought inside a video of `duration`; the start while that is unknown. */
export function clampMediaTime(seconds: number, duration: number): number {
  const end = realSeconds(duration);
  if (end === 0 || !Number.isFinite(seconds)) return 0;
  return Math.min(end, Math.max(0, seconds));
}

/** `deltaS` seconds along from `current`, without leaving the video. */
export function seekBy(current: number, duration: number, deltaS: number): number {
  if (!Number.isFinite(deltaS)) return clampMediaTime(current, duration);
  return clampMediaTime(clampMediaTime(current, duration) + deltaS, duration);
}

/** Where the playhead sits as a fraction of the whole, for the seek slider. */
export function timeFraction(current: number, duration: number): number {
  const end = realSeconds(duration);
  return end === 0 ? 0 : clampMediaTime(current, duration) / end;
}

/** The position a slider at `fraction` of the way along stands for. */
export function timeAtFraction(fraction: number, duration: number): number {
  if (!Number.isFinite(fraction)) return 0;
  const end = realSeconds(duration);
  return clampMediaTime(Math.min(1, Math.max(0, fraction)) * end, end);
}

/** A gain the media element will really apply, snapped to the status bar's notches. */
export function clampMediaVolume(value: number): number {
  return Math.min(VIDEO_VOLUME_MAX, clampVolume(value));
}

/** `notches` steps louder (positive) or quieter (negative), staying in range. */
export function stepMediaVolume(current: number, notches: number): number {
  if (!Number.isFinite(notches)) return clampMediaVolume(current);
  return clampMediaVolume(clampMediaVolume(current) + notches * VOLUME_STEP);
}

/** The gain as the whole percent shown beside the slider (1 → 100). */
export function mediaVolumePercent(value: number): number {
  return volumePercent(clampMediaVolume(value));
}

/**
 * The gain to unmute to. Unmuting a video whose slider was dragged all the way
 * down would otherwise do nothing at all, which reads as a broken button.
 */
export function volumeAfterUnmute(value: number): number {
  const gain = clampMediaVolume(value);
  return gain > 0 ? gain : VIDEO_VOLUME_MAX;
}

/**
 * Whether a video opens silent. This is a voice app before it is anything
 * else: someone in a call who opens a clip is very often showing it to the
 * people they are talking to, and a clip that starts talking over them is the
 * kind of accident nobody forgives. So a video opened during a call is muted
 * until its own mute button says otherwise — visibly, in the button's own
 * state, never as a mystery — and one opened outside a call plays as normal.
 *
 * Note that this is about the *first* frame of audio, not about autoplay:
 * nothing in the player ever sets `autoplay`, and the video opens paused.
 */
export function startsMuted(inCall: boolean): boolean {
  return inCall;
}
