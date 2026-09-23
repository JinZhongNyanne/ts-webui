/**
 * Square crop for the avatar picker: the image is drawn at `scale` with its
 * top-left corner at (`x`, `y`) inside a square `box` (CSS pixels), and the
 * box is what gets kept. Every function returns a new view; all of them keep
 * the box covered, so the crop never has an empty edge.
 */

/** How far past "just covers the box" the user may zoom in. */
export const MAX_ZOOM = 8;

export interface CropView {
  /** The image's natural size. */
  readonly imgW: number;
  readonly imgH: number;
  /** Side of the square crop box, in CSS pixels. */
  readonly box: number;
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

/** The smallest scale at which the image still covers the box. */
function coverScale(v: Pick<CropView, "imgW" | "imgH" | "box">): number {
  return v.box / Math.min(v.imgW, v.imgH);
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Scale within bounds, then the offsets so the image covers the box. */
export function clampView(v: CropView): CropView {
  const min = coverScale(v);
  const scale = clamp(v.scale, min, min * MAX_ZOOM);
  const x = clamp(v.x, v.box - v.imgW * scale, 0);
  const y = clamp(v.y, v.box - v.imgH * scale, 0);
  return { ...v, scale, x, y };
}

/** Centred, the short side filling the box. */
export function initialView(imgW: number, imgH: number, box: number): CropView {
  const scale = coverScale({ imgW, imgH, box });
  return clampView({
    imgW,
    imgH,
    box,
    scale,
    x: (box - imgW * scale) / 2,
    y: (box - imgH * scale) / 2,
  });
}

/** Moves the image by a drag of (`dx`, `dy`). */
export function panView(v: CropView, dx: number, dy: number): CropView {
  return clampView({ ...v, x: v.x + dx, y: v.y + dy });
}

/** Zooms by `factor` around (`cx`, `cy`) in box coordinates (the cursor, or the centre). */
export function zoomView(v: CropView, factor: number, cx: number, cy: number): CropView {
  const min = coverScale(v);
  const scale = clamp(v.scale * factor, min, min * MAX_ZOOM);
  // The image point under (cx, cy) stays there.
  const ix = (cx - v.x) / v.scale;
  const iy = (cy - v.y) / v.scale;
  return clampView({ ...v, scale, x: cx - ix * scale, y: cy - iy * scale });
}

/** The square of the image, in its own pixels, that the box shows. */
export function sourceRect(v: CropView): { sx: number; sy: number; size: number } {
  // "+ 0" turns -0 (from x = 0) into 0.
  return { sx: -v.x / v.scale + 0, sy: -v.y / v.scale + 0, size: v.box / v.scale };
}

/** Side of the saved image: the crop's own size, at most `max`, never upscaled. */
export function outputSize(sourceSize: number, max: number): number {
  return Math.max(1, Math.min(max, Math.round(sourceSize)));
}
