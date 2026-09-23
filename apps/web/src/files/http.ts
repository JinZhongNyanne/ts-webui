/**
 * The hub's file routes from the page (see packages/protocol/src/files.ts for
 * the API). Every failure is a FileTransferError whose message is already
 * translated; `code` is the TeamSpeak error id or the hub's FT_HUB_CODES.
 */
import {
  FT_PASSWORD_HEADER,
  type FtDownloadRequest,
  type FtDownloadTicket,
  type FtErrorBody,
  type FtUploadResult,
} from "@jinz/protocol";
import { translateCode } from "../i18n";

export class FileTransferError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** For "insufficient permissions": the permission the server checked. */
    readonly failedPermission?: string,
  ) {
    super(message);
    this.name = "FileTransferError";
  }
}

/** The page cancelled the transfer (FileTransferError.code). */
export const CANCELLED = "cancelled";

function isErrorBody(body: unknown): body is FtErrorBody {
  const b = body as Partial<FtErrorBody> | null;
  return typeof b?.error === "string" && typeof b.message === "string";
}

/** A refusal from the hub, translated; falls back on the status when the body is not ours. */
export function errorFromResponse(status: number, body: unknown): FileTransferError {
  if (isErrorBody(body)) {
    return new FileTransferError(body.error, translateCode(body.message), body.failedPermission);
  }
  const key =
    status === 403
      ? "ft.forbidden"
      : status === 429
        ? "ft.rateLimited"
        : status === 410
          ? "ft.linkExpired"
          : "ft.failed";
  return new FileTransferError(`http_${status}`, translateCode(key));
}

const networkError = () => new FileTransferError("network", translateCode("ft.network"));

/**
 * Starts a download on the server and returns its one-use link. The link
 * expires within seconds (FT_TICKET_TTL_MS): use it at once, don't store it.
 */
export async function requestDownloadLink(
  sessionId: string,
  req: FtDownloadRequest,
): Promise<FtDownloadTicket> {
  let res: Response;
  try {
    res = await fetch("/api/files/download-ticket", {
      method: "POST",
      headers: { "x-session-id": sessionId, "content-type": "application/json" },
      body: JSON.stringify(req),
    });
  } catch {
    throw networkError();
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw errorFromResponse(res.status, body);
  return body as FtDownloadTicket;
}

/**
 * Fetches a download link into memory (a chat image preview). A refused GET
 * answers plain text, not JSON, so the status names the reason.
 */
export async function fetchDownload(url: string, signal?: AbortSignal): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch {
    if (signal?.aborted) throw new FileTransferError(CANCELLED, translateCode("ft.cancelled"));
    throw networkError();
  }
  if (!res.ok) throw errorFromResponse(res.status, null);
  return res.blob();
}

/** Hands a link to the browser's own download manager (it shows the progress). */
export function startBrowserDownload(url: string, name: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export interface UploadRequest {
  sessionId: string;
  cid: string;
  path: string;
  cpw?: string;
  overwrite?: boolean;
  file: Blob;
  onProgress?: (loaded: number) => void;
  signal?: AbortSignal;
}

/**
 * PUTs the file as the raw body. XHR rather than fetch, for its upload
 * progress events; the browser sets Content-Length from the Blob, which the
 * hub needs before it asks the server for the upload.
 */
export function uploadFile(req: UploadRequest): Promise<FtUploadResult> {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams({ cid: req.cid, path: req.path });
    if (req.overwrite) query.set("overwrite", "1");
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/files/upload?${query}`);
    xhr.setRequestHeader("x-session-id", req.sessionId);
    xhr.setRequestHeader("content-type", "application/octet-stream");
    if (req.cpw) xhr.setRequestHeader(FT_PASSWORD_HEADER, encodeURIComponent(req.cpw));
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => req.onProgress?.(e.loaded);
    xhr.onload = () => {
      if (xhr.status === 201) resolve(xhr.response as FtUploadResult);
      else reject(errorFromResponse(xhr.status, xhr.response));
    };
    xhr.onerror = () => reject(networkError());
    const cancelled = () => new FileTransferError(CANCELLED, translateCode("ft.cancelled"));
    xhr.onabort = () => reject(cancelled());
    if (req.signal?.aborted) {
      reject(cancelled());
      return;
    }
    req.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(req.file);
  });
}
