/**
 * Draws the chosen square of an image into a canvas of the avatar's size and
 * encodes it (browser only; the maths is in crop.ts, the size rules in
 * avatar-file.ts).
 */
import { outputSize, sourceRect, type CropView } from "./crop";
import { AVATAR_MAX_SIDE, encodeWithinLimit } from "./avatar-file";

/** The crop as an image of at most `limit` bytes; null when even the smallest JPEG is bigger. */
export async function renderAvatar(
  img: CanvasImageSource,
  view: CropView,
  limit: number,
): Promise<Blob | null> {
  const { sx, sy, size } = sourceRect(view);
  const side = outputSize(size, AVATAR_MAX_SIDE);
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, size, size, 0, 0, side, side);
  let opaque: HTMLCanvasElement | null = null;
  return encodeWithinLimit((type, quality) => {
    // JPEG has no transparency, and a canvas turns it black: put it on white.
    const source = type === "image/jpeg" ? (opaque ??= onWhite(canvas)) : canvas;
    return new Promise((resolve) => source.toBlob(resolve, type, quality));
  }, limit);
}

function onWhite(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0);
  }
  return out;
}
