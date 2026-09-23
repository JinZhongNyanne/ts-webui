/**
 * Pure math behind the status-bar volume controls. Volumes are linear gains in
 * `[VOLUME_MIN, VOLUME_MAX]` where 1 is "unchanged" (100%), mirroring the
 * `master` / `micVolume` refs in the voice store.
 */
export const VOLUME_MIN = 0;
export const VOLUME_MAX = 2;
export const VOLUME_STEP = 0.05;
export const VOLUME_DEFAULT = 1;

/** Clamps a gain into the supported range, snapped to the slider step. */
export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return VOLUME_DEFAULT;
  const clamped = Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, value));
  // Snap via an integer notch count and a single division so repeated ±0.05
  // nudges never drift into 0.30000000000000004.
  const notchesPerUnit = Math.round(1 / VOLUME_STEP);
  return Math.round(clamped * notchesPerUnit) / notchesPerUnit;
}

/**
 * Applies one wheel notch. Scrolling up (negative deltaY) raises the volume,
 * scrolling down lowers it; a zero delta leaves it untouched.
 */
export function stepVolume(current: number, deltaY: number): number {
  if (deltaY === 0 || !Number.isFinite(deltaY)) return clampVolume(current);
  const direction = deltaY < 0 ? 1 : -1;
  return clampVolume(current + direction * VOLUME_STEP);
}

/** Percentage shown next to the slider (1 → 100). */
export function volumePercent(value: number): number {
  return Math.round(clampVolume(value) * 100);
}
