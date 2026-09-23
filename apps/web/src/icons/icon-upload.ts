/**
 * Turns a picked file into icon bytes (browser only: decoding and canvas).
 * See icon-image.ts for the rules; the id is the CRC-32 of what is uploaded.
 */
import { formatBytes, iconIdOf, isBuiltinIconId } from "@jinz/protocol";
import { t } from "../i18n";
import { iconPlan, sniffImageType } from "./icon-image";

export interface PreparedIcon {
  bytes: Uint8Array;
  type: string;
  iconId: number;
}

async function decodeSize(file: Blob): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: 0, height: 0 };
  }
}

async function scaled(file: Blob, width: number, height: number): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file, {
    resizeWidth: width,
    resizeHeight: height,
    resizeQuality: "high",
  });
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error(t("icons.badImage"));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Checks `file` and gets it ready; throws a translated message when it will not do. */
export async function prepareIcon(file: File, maxBytes: number): Promise<PreparedIcon> {
  const original = new Uint8Array(await file.arrayBuffer());
  const type = sniffImageType(original);
  const size = await decodeSize(file);
  const plan = iconPlan({ type, ...size, size: original.length }, maxBytes);
  if (plan.kind === "refuse") throw new Error(t("icons.badImage"));
  const bytes = plan.kind === "asIs" ? original : await scaled(file, plan.width, plan.height);
  if (bytes.length > maxBytes) {
    throw new Error(t("icons.tooLarge", { max: formatBytes(maxBytes) }));
  }
  const iconId = iconIdOf(bytes);
  // A CRC below 1000 would read as a built-in icon: vanishingly rare, but refused.
  if (isBuiltinIconId(iconId) || iconId === 0) throw new Error(t("icons.badImage"));
  return { bytes, type: plan.kind === "asIs" ? type! : "image/png", iconId };
}
