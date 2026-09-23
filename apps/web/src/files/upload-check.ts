/**
 * What the page can tell about an upload before sending a byte. The hub
 * checks the same again (apps/hub/src/files/limits.ts); checking here only
 * saves the user a failed transfer.
 */
import { joinFtPath, sanitizeFtFileName } from "@jinz/protocol";

const MB = 1024 * 1024;

export type UploadProblem = "tooLarge" | "badName";

/**
 * The largest file this user may upload: the hub's limit (from `hello`), or
 * `i_ft_quota_mb_upload_per_client` when the server reported it and it is
 * smaller (-1 = unlimited). Pass the raw value, undefined when unreported.
 */
export function uploadLimit(hubMaxBytes: number | undefined, quotaMb: number | undefined): number {
  const hub = hubMaxBytes ?? Number.POSITIVE_INFINITY;
  if (quotaMb === undefined || quotaMb < 0) return hub;
  return Math.min(hub, quotaMb * MB);
}

export function checkUpload(size: number, limit: number): UploadProblem | null {
  return size > limit ? "tooLarge" : null;
}

/** Where a browser file goes in folder `dir`; null when no valid path comes out of it. */
export function uploadTarget(dir: string, fileName: string): string | null {
  const name = sanitizeFtFileName(fileName);
  return name ? joinFtPath(dir, name) : null;
}
