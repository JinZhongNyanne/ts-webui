/**
 * Asks the hub for a media link (`POST /api/files/media-ticket`, see
 * packages/protocol/src/files.ts): a same-origin URL a `<video>` streams from
 * with range requests, for one file, for ten minutes.
 *
 * Unlike a download link it is not spent by its first use, so it can be a
 * player's `src` and survive every seek. The hub refuses it for anything that
 * is not video or audio, and for the same reasons as a download (a wrong
 * password, a missing permission), which arrive here as a FileTransferError
 * with the message already translated.
 */
import type { FtDownloadRequest, FtMediaTicket } from "@jinz/protocol";
import { FileTransferError, errorFromResponse } from "../../files/http";
import { translateCode } from "../../i18n";

export const MEDIA_TICKET_URL = "/api/files/media-ticket";

export async function requestMediaLink(
  sessionId: string,
  req: FtDownloadRequest,
): Promise<FtMediaTicket> {
  let res: Response;
  try {
    res = await fetch(MEDIA_TICKET_URL, {
      method: "POST",
      headers: { "x-session-id": sessionId, "content-type": "application/json" },
      body: JSON.stringify(req),
    });
  } catch {
    throw new FileTransferError("network", translateCode("ft.network"));
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw errorFromResponse(res.status, body);
  return body as FtMediaTicket;
}
