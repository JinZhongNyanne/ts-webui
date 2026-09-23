/** Request-level checks of the file routes, kept pure for testing. */
import { FtChannelPasswordSchema } from "@jinz/protocol";

const MB = 1024 * 1024;

/**
 * The largest upload this session may start: the hub's own ceiling, or the
 * user's `i_ft_quota_mb_upload_per_client` when the server told us and it is
 * smaller (-1 is unlimited). The quota counts everything the user uploads,
 * so the server may still refuse a smaller file (2069); a file bigger than
 * the whole quota is refused here without asking.
 */
export function uploadLimit(hubMaxBytes: number, quotaMb: number | undefined): number {
  if (quotaMb === undefined || quotaMb < 0) return hubMaxBytes;
  return Math.min(hubMaxBytes, quotaMb * MB);
}

/**
 * The upload's size from a plain `Content-Length`, or null. A chunked body
 * does not count: TeamSpeak wants the size before the first byte.
 */
export function contentLengthOf(
  headers: Record<string, string | string[] | undefined>,
): number | null {
  if (headers["transfer-encoding"] !== undefined) return null;
  const raw = headers["content-length"];
  if (typeof raw !== "string" || !/^\d{1,15}$/.test(raw)) return null;
  return Number(raw);
}

/** The percent-encoded FT_PASSWORD_HEADER, decoded; "" when absent, null when malformed. */
export function decodeChannelPassword(raw: string | string[] | undefined): string | null {
  if (raw === undefined) return "";
  if (typeof raw !== "string") return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return FtChannelPasswordSchema.safeParse(decoded).success ? decoded : null;
}
