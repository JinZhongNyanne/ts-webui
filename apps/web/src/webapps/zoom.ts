/**
 * How far each site in the Apps window is zoomed, per browser.
 *
 * A framed page cannot be zoomed from outside, so the frame is laid out at
 * 1/zoom of the panel and scaled back up with a CSS transform: the site sees
 * a wider (or narrower) viewport and reflows to it, like browser zoom does.
 */

/** The steps −/+ walk through, as in a browser's own zoom. */
export const ZOOM_STEPS: readonly number[] = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2,
];
export const MIN_ZOOM = ZOOM_STEPS[0]!;
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** The next step in `direction` from `zoom` (which need not be a step itself). */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const current = clampZoom(zoom);
  const next =
    direction > 0
      ? ZOOM_STEPS.find((s) => s > current + 1e-9)
      : [...ZOOM_STEPS].reverse().find((s) => s < current - 1e-9);
  return next ?? current;
}

/** Saved zooms, re-validated: storage is user-editable and may hold anything. */
export function parseZooms(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value) && value !== 1) {
      out[id] = clampZoom(value);
    }
  }
  return out;
}
