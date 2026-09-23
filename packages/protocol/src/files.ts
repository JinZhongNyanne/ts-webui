/**
 * Channel file transfer (M3): paths, names and the HTTP API's shapes, shared
 * by the hub (which must never send a path it did not check) and the page
 * (which should not ask for one the hub would refuse).
 *
 * TeamSpeak paths are absolute inside a channel's file store: `/` is the
 * root, `/dir/file.txt` a file. The server resolves `..` itself, but the hub
 * does not rely on that: a path with dot segments, control characters or a
 * backslash (a separator on a Windows server) is refused outright rather than
 * cleaned up, so what the user sees is what the server gets.
 *
 * HTTP API (hub, apps/hub/src/files/routes.ts):
 *   POST /api/files/download-ticket   x-session-id; JSON FtDownloadRequest
 *        -> 200 FtDownloadTicket | FtErrorBody
 *   GET  /api/files/download/:ticket  single use, FT_TICKET_TTL_MS; the bytes
 *   POST /api/files/media-ticket      x-session-id; JSON FtDownloadRequest
 *        -> 200 FtMediaTicket | FtErrorBody (only for ftMediaMimeOf names)
 *   GET|HEAD /api/files/media/:ticket many uses, FT_MEDIA_TICKET_TTL_MS;
 *        honours `Range: bytes=a-` (206), served inline as ftMediaMimeOf
 *   PUT  /api/files/upload?cid=&path=&overwrite=1
 *        x-session-id, FT_PASSWORD_HEADER, content-type
 *        application/octet-stream, Content-Length; raw body
 *        -> 201 FtUploadResult | FtErrorBody
 */
import { z } from "zod";
import { DECIMAL_ID } from "./ids.js";

/** Longest path the hub sends (characters). */
export const FT_PATH_MAX = 500;
/** Longest single file or directory name (characters). */
export const FT_NAME_MAX = 255;

/**
 * Carries the channel password of an upload, percent-encoded
 * (encodeURIComponent): a header, not the query, so it never shows up in a
 * request log, and encoded because headers are Latin-1.
 */
export const FT_PASSWORD_HEADER = "x-ts-channel-password";

/**
 * How long a download link lives, and it works once. TeamSpeak drops a
 * transfer nobody connects to after about 10 s (seen on a live 3.13 server),
 * and the hub has already asked for it when it hands out the link.
 */
export const FT_TICKET_TTL_MS = 8_000;

/**
 * How long a media link lives. Unlike a download link it is used many times
 * (a `<video>` asks again for every seek), so it cannot be one-use; ten
 * minutes covers watching a clip shared in chat, and the page asks for a new
 * one after that. It still names one file of one session and nothing else.
 */
export const FT_MEDIA_TICKET_TTL_MS = 10 * 60_000;

/**
 * Transfers a session's media links may open per minute (each seek is one
 * `ftinitdownload`, which spends the hub-wide TeamSpeak command budget).
 */
export const FT_MEDIA_OPENS_PER_MIN = 12;

const BAD_CHARS = /[\x00-\x1f\x7f\\]/;

/** One path segment: no separator, not a dot name, not blank, not too long. */
export function isFtName(name: string): boolean {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= FT_NAME_MAX &&
    name.trim().length > 0 &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !BAD_CHARS.test(name)
  );
}

/**
 * The canonical form of a TeamSpeak path (`/` or `/a/b`, no trailing slash),
 * or null when it is not one the hub will send.
 */
export function normalizeFtPath(raw: string): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/") || BAD_CHARS.test(raw)) return null;
  const segments = raw.split("/").filter((s) => s.length > 0);
  if (!segments.every(isFtName)) return null;
  const path = `/${segments.join("/")}`;
  return path.length <= FT_PATH_MAX ? path : null;
}

/** Like normalizeFtPath, but the root itself is not a file. */
export function normalizeFtFilePath(raw: string): string | null {
  const path = normalizeFtPath(raw);
  return path && path !== "/" ? path : null;
}

/** `dir` + `name`, or null when either is not valid. */
export function joinFtPath(dir: string, name: string): string | null {
  const base = normalizeFtPath(dir);
  if (!base || !isFtName(name)) return null;
  return normalizeFtPath(base === "/" ? `/${name}` : `${base}/${name}`);
}

/** The directory a normalised path lives in (`/` for the root and its children). */
export function ftDirOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut <= 0 ? "/" : path.slice(0, cut);
}

/** The last segment of a normalised path; "" for the root. */
export function ftNameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * A browser file name made fit for a TeamSpeak path: separators, control
 * characters and what a Windows server could not store (`:*?"<>|`) become
 * `_`, the ends are trimmed, and a long name is shortened in front of its
 * extension. Null when nothing usable is left.
 */
export function sanitizeFtFileName(name: string): string | null {
  const cleaned = name.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, "_").trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return null;
  if (cleaned.length <= FT_NAME_MAX) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 && cleaned.length - dot <= 16 ? cleaned.slice(dot) : "";
  const shortened = `${cleaned.slice(0, FT_NAME_MAX - ext.length).trimEnd()}${ext}`;
  return isFtName(shortened) ? shortened : null;
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** `1536` -> "1.5 KB": binary multiples, at most one decimal, for messages and lists. */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const shown = unit === 0 || value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${shown} ${UNITS[unit]}`;
}

/**
 * The only types the hub serves a channel file as inline, by the file's
 * extension: video and audio a browser plays in a `<video>` or `<audio>`.
 *
 * The type comes from the *name*, against this list, and never from anything
 * the TeamSpeak server or the uploader declares: a file served inline from the
 * hub's origin runs with the page's rights if a browser renders it, so HTML,
 * SVG, XML, PDF and scripts must never get here whatever they are called. A
 * file named `x.mp4` that holds HTML is still sent as `video/mp4`, with
 * `nosniff`, and a browser shows a broken video rather than a page.
 */
const MEDIA_MIME_BY_EXT: Readonly<Record<string, string>> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  weba: "audio/webm",
  wav: "audio/wav",
  flac: "audio/flac",
};

/** The inline type of a media file by its name; null for anything not video or audio. */
export function ftMediaMimeOf(name: string): string | null {
  if (typeof name !== "string") return null;
  const dot = name.lastIndexOf(".");
  // A dot name (".mp4") has no extension, only a name.
  if (dot <= 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return Object.hasOwn(MEDIA_MIME_BY_EXT, ext) ? MEDIA_MIME_BY_EXT[ext]! : null;
}

const channelIdSchema = z.string().regex(DECIMAL_ID, "must be a decimal id");

/** A path already in canonical form: the hub sends exactly what it checked. */
export const FtPathSchema = z
  .string()
  .max(FT_PATH_MAX)
  .refine((p) => normalizeFtPath(p) === p, "not a normalised TeamSpeak path");

export const FtFilePathSchema = FtPathSchema.refine((p) => p !== "/", "not a file path");

/** Channel passwords travel in clear to the hub, which hashes them for TeamSpeak. */
export const FtChannelPasswordSchema = z.string().max(128);

export const FtDownloadRequestSchema = z
  .object({ cid: channelIdSchema, path: FtFilePathSchema, cpw: FtChannelPasswordSchema.optional() })
  .strict();
export type FtDownloadRequest = z.infer<typeof FtDownloadRequestSchema>;

export const FtUploadQuerySchema = z
  .object({
    cid: channelIdSchema,
    path: FtFilePathSchema,
    overwrite: z
      .enum(["0", "1"])
      .optional()
      .transform((v) => v === "1"),
  })
  .strict();
export type FtUploadQuery = z.infer<typeof FtUploadQuerySchema>;

/** What `POST /api/files/download-ticket` answers. */
export interface FtDownloadTicket {
  /** Same-origin path to navigate to (or put in an `<a href download>`); works once. */
  url: string;
  /** Unix ms after which the link is refused. */
  expiresAt: number;
  size: number;
  /** The file's name, for the page to show. */
  name: string;
}

/** What `POST /api/files/media-ticket` answers. */
export interface FtMediaTicket {
  /**
   * Same-origin path for a `<video>` or `<audio>` `src`: answers `Range`
   * requests, many times, until `expiresAt` or until the session ends.
   */
  url: string;
  /** Unix ms after which the link is refused. */
  expiresAt: number;
  size: number;
  /** The file's name, for the page to show. */
  name: string;
  /** The type it is served as (ftMediaMimeOf of the name). */
  type: string;
}

/** What a finished upload answers. */
export interface FtUploadResult {
  path: string;
  size: number;
}

/**
 * Every refusal of the file routes. `error` is a TeamSpeak error id ("2568",
 * "781"...) or one of FT_HUB_CODES; `message` is a text code the page
 * translates (see text-code.ts).
 */
export interface FtErrorBody {
  error: string;
  message: string;
  /** For "insufficient permissions": the permission the server checked, by name. */
  failedPermission?: string;
}

/** Refusals that come from the hub rather than from the TeamSpeak server. */
export const FT_HUB_CODES = {
  notConnected: "not_connected",
  badRequest: "bad_request",
  lengthRequired: "length_required",
  tooLarge: "too_large",
  /** This session already runs as many transfers as it may. */
  busy: "busy",
  rateLimited: "rate_limited",
  /** The download link was used already, expired, or belongs to a gone session. */
  expired: "expired",
  /** The browser went away or the TeamSpeak connection broke mid-transfer. */
  aborted: "aborted",
  /** A media link was asked for a file that is not video or audio (ftMediaMimeOf). */
  notMedia: "not_media",
  failed: "failed",
} as const;

/** The hub's own transfer limits, sent in `hello` (HubFeatures.files). */
export interface FtLimits {
  /** Largest upload the hub accepts (HUB_FT_MAX_UPLOAD_BYTES). */
  maxUploadBytes: number;
  /** Transfers one session may run at once (HUB_FT_MAX_TRANSFERS_PER_SESSION). */
  maxTransfers: number;
  /**
   * The hub serves range-capable media links (`POST /api/files/media-ticket`),
   * so a video can stream instead of being fetched whole. Absent from hubs
   * that predate them, which the page then treats as false.
   */
  mediaStreaming?: boolean;
}

/** A `ftgetfilelist` row as the page uses it. */
export interface FtEntry {
  name: string;
  /** Bytes; 0 for directories. */
  size: number;
  /** Unix seconds of the last change. */
  datetime: number;
  isDir: boolean;
}
