/**
 * What an uploaded icon may be. Native TS3 clients draw icons at 16×16 and
 * name them by the CRC-32 of the file's bytes, so a small PNG/JPEG/GIF goes up
 * byte for byte (its id is then the one a native client would give it); a
 * bigger one is scaled down to 16 px and saved as PNG. The server caps the
 * size with i_max_icon_filesize (8192 bytes for Server Admin on a live TS3
 * 3.13 server; too big is refused with 2565 when the upload starts).
 */

export const ICON_SIDE = 16;
/** i_max_icon_filesize's usual value, for servers that do not tell us. */
export const ICON_DEFAULT_LIMIT = 8192;
export const ICON_ACCEPT = "image/png,image/jpeg,image/gif";

export type IconImageType = "image/png" | "image/jpeg" | "image/gif";

const startsWith = (bytes: Uint8Array, sig: readonly number[]) =>
  bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);

/** The image type by magic bytes, for the formats native clients show; null otherwise. */
export function sniffImageType(bytes: Uint8Array): IconImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  return null;
}

/** The largest icon file (bytes); null when the server allows none (0). */
export function iconByteLimit(permValue: number | undefined): number | null {
  if (permValue === 0) return null;
  return permValue === undefined || permValue < 0 ? ICON_DEFAULT_LIMIT : permValue;
}

export interface IconImage {
  type: IconImageType | null;
  /** Natural size; 0 when the browser could not decode it. */
  width: number;
  height: number;
  /** Bytes. */
  size: number;
}

export type IconPlan =
  | { kind: "asIs" }
  | { kind: "resize"; width: number; height: number }
  | { kind: "refuse"; reason: "badType" };

/** Upload the file as it is, scale it into 16×16 first, or refuse it. */
export function iconPlan(img: IconImage, maxBytes: number): IconPlan {
  if (!img.type || img.width <= 0 || img.height <= 0) return { kind: "refuse", reason: "badType" };
  const fits = img.width <= ICON_SIDE && img.height <= ICON_SIDE;
  if (fits && img.size <= maxBytes) return { kind: "asIs" };
  const scale = Math.min(1, ICON_SIDE / Math.max(img.width, img.height));
  return {
    kind: "resize",
    width: Math.max(1, Math.round(img.width * scale)),
    height: Math.max(1, Math.round(img.height * scale)),
  };
}
