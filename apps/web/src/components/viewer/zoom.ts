/**
 * The zoom and pan maths of the picture viewer, as plain numbers: no DOM, no
 * Vue, so every rule below is testable on its own.
 *
 * A view is the picture drawn at `scale` with its top-left corner at (`x`,
 * `y`) inside the viewport (`viewW` × `viewH`, CSS pixels). Every function
 * answers a *new* view; nothing is mutated. Two rules hold for every view:
 *
 * - the zoom stays between `MIN_ZOOM` and `MAX_ZOOM`;
 * - an axis the picture fits on is centred, and an axis it overflows is
 *   clamped so its edge can never be dragged inside the viewport. There is
 *   therefore no state in which the picture has drifted off screen.
 *
 * The same shape serves the two named states the user asks for by name: "fit
 * to window" (`fitScale`, the whole picture visible) and "100%" (`actualView`,
 * one picture pixel per CSS pixel). They are recognised by comparing scales
 * rather than by a mode flag, so a wheel notch that happens to land on 100%
 * lights the same button up.
 */

/** The smallest zoom, for a photograph far larger than the window. */
export const MIN_ZOOM = 0.05;
/** The largest zoom; past this an emoji is nothing but pixels. */
export const MAX_ZOOM = 16;
/** One press of the zoom buttons (and one keyboard + / -). */
export const ZOOM_STEP = 1.25;
/**
 * One wheel notch — deliberately smaller than a button press, since a wheel
 * delivers notches in bursts and a trackpad delivers many.
 */
export const WHEEL_ZOOM_STEP = 1.1;
/** One picture pixel per CSS pixel. */
export const ACTUAL_ZOOM = 1;
/** Scales this close together are the same state to the eye (and to a label). */
const SCALE_EPSILON = 0.005;

export interface PictureSize {
  /** The picture's natural size; 0 until the browser has decoded it. */
  readonly imgW: number;
  readonly imgH: number;
  /** The box the picture is shown in. */
  readonly viewW: number;
  readonly viewH: number;
}

export interface PictureView extends PictureSize {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/**
 * The zoom at which the whole picture is visible. A picture smaller than the
 * window is *not* blown up to fill it: "fit" means "all of it", and a 32-pixel
 * emoji stretched over a 4K screen is not what anyone asked for.
 */
export function fitScale(size: PictureSize): number {
  if (size.imgW <= 0 || size.imgH <= 0) return MIN_ZOOM;
  const fit = Math.min(ACTUAL_ZOOM, size.viewW / size.imgW, size.viewH / size.imgH);
  return clamp(fit, MIN_ZOOM, MAX_ZOOM);
}

/** Centres the axes the picture fits on and clamps the ones it overflows. */
function settle(v: PictureView): PictureView {
  const scale = clamp(v.scale, MIN_ZOOM, MAX_ZOOM);
  const w = v.imgW * scale;
  const h = v.imgH * scale;
  const x = w > v.viewW ? clamp(v.x, v.viewW - w, 0) : (v.viewW - w) / 2;
  const y = h > v.viewH ? clamp(v.y, v.viewH - h, 0) : (v.viewH - h) / 2;
  return { ...v, scale, x, y };
}

/** The whole picture, centred. */
export function fitView(imgW: number, imgH: number, viewW: number, viewH: number): PictureView {
  const size = { imgW, imgH, viewW, viewH };
  return settle({ ...size, scale: fitScale(size), x: 0, y: 0 });
}

/**
 * The view for a (possibly new) picture and viewport.
 *
 * `previous` is kept — its zoom and its offsets — when it was the same
 * picture: a resized window, or a phone rotated, must not throw away what the
 * user was looking at. A different natural size means a different picture (or
 * one that has only just decoded), which starts fitted.
 */
export function viewOf(
  imgW: number,
  imgH: number,
  viewW: number,
  viewH: number,
  previous?: PictureView,
): PictureView {
  if (!previous || previous.imgW !== imgW || previous.imgH !== imgH) {
    return fitView(imgW, imgH, viewW, viewH);
  }
  return settle({ ...previous, viewW, viewH });
}

/** Zooms by `factor`, keeping the picture point under (`cx`, `cy`) where it is. */
export function zoomView(v: PictureView, factor: number, cx: number, cy: number): PictureView {
  const scale = clamp(v.scale * factor, MIN_ZOOM, MAX_ZOOM);
  const ix = (cx - v.x) / v.scale;
  const iy = (cy - v.y) / v.scale;
  return settle({ ...v, scale, x: cx - ix * scale, y: cy - iy * scale });
}

/** Zooms by `factor` around the middle of the viewport (the buttons and keys). */
export function zoomAtCentre(v: PictureView, factor: number): PictureView {
  return zoomView(v, factor, v.viewW / 2, v.viewH / 2);
}

/** 100%, around the middle of the viewport. */
export function actualView(v: PictureView): PictureView {
  return zoomAtCentre(v, ACTUAL_ZOOM / v.scale);
}

/** Moves the picture by a drag of (`dx`, `dy`); an axis that fits cannot move. */
export function panView(v: PictureView, dx: number, dy: number): PictureView {
  return settle({ ...v, x: v.x + dx, y: v.y + dy });
}

/** Whether a drag can move the picture at all — the cursor depends on it. */
export function canPan(v: PictureView): boolean {
  return v.imgW * v.scale > v.viewW || v.imgH * v.scale > v.viewH;
}

const sameScale = (a: number, b: number): boolean => Math.abs(a - b) <= SCALE_EPSILON;

export function isFit(v: PictureView): boolean {
  return sameScale(v.scale, fitScale(v));
}

export function isActual(v: PictureView): boolean {
  return sameScale(v.scale, ACTUAL_ZOOM);
}

/**
 * What a double click (or a double tap) does: fitted goes to 100%, anything
 * else goes back to fitted. Landing on "fitted" from an arbitrary zoom is the
 * more useful of the two, so it is what every other state does.
 */
export function toggleFitActual(v: PictureView): PictureView {
  return isFit(v) ? actualView(v) : fitView(v.imgW, v.imgH, v.viewW, v.viewH);
}

/** The zoom as the whole percentage shown next to the picture's name. */
export function zoomPercent(v: PictureView): number {
  return Math.round(v.scale * 100);
}

/**
 * A pinch: how much the two fingers have spread since the gesture started.
 * A zero starting distance cannot be divided by, and means "no pinch yet".
 */
export function pinchFactor(startDistance: number, distance: number): number {
  return startDistance > 0 ? distance / startDistance : 1;
}
