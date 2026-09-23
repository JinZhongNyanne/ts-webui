/**
 * `ts3file://` links: how TeamSpeak 3 points at a file in a channel's file
 * store. The TS3 client writes one when a file is dropped from its file
 * browser into a chat or copied with "Copy URL", and turns it into a link
 * that downloads the file; we send the same thing so native users can click
 * ours, and read theirs.
 *
 *   ts3file://<host>?port=<port>[&serverUID=<uid>]&channel=<cid>&path=<dir>
 *     &filename=<name>&isDir=0&size=<bytes>&fileDateTime=<unix seconds>
 *
 * `path` is the folder (`/` for the channel's root), `filename` the name in
 * it. Values are percent-encoded only where they must be (TS3 writes its
 * "pretty" form: slashes and non-ASCII text as they are); `+` is a plus, not
 * a space. In chat it goes in a `[URL=…]name[/URL]` tag.
 *
 * Only the channel and path are ever used from a received link: the page
 * downloads from the server it is connected to, through the hub, and never
 * turns the link into an href.
 *
 * Pure, so it can be tested on plain node.
 */
import {
  joinFtPath,
  normalizeFtFilePath,
  normalizeFtPath,
  ftDirOf,
  ftNameOf,
} from "@jinz/protocol";

/**
 * TeamSpeak 3 clients take at most 1024 characters of chat (the server
 * itself takes about 8 KB); a file message must reach native users whole.
 */
export const FILE_MESSAGE_MAX_CHARS = 1024;

export const DEFAULT_TS_PORT = 9987;

/** A file in a channel, as a link names it. */
export interface Ts3FileRef {
  host: string;
  port: number;
  serverUid?: string;
  cid: string;
  /** The file's normalised TeamSpeak path (`/dir/name`). */
  path: string;
  /** Bytes, when the link says. */
  size?: number;
  /** Unix seconds of the file's last change, when the link says. */
  datetime?: number;
}

const HOST_RE = /^[A-Za-z0-9.-]{1,253}$/;
/** Canonical decimal ids only, as the hub accepts them (no leading zeros). */
const CID_RE = /^(0|[1-9]\d{0,19})$/;
const COUNT_RE = /^\d{1,15}$/;

/**
 * Percent-encodes what would end a query value (`&`, `#`, `=`), change its
 * meaning (`+`, `%`), end the BBCode tag around it (`[`, `]`), or break the
 * URL (spaces, quotes, angle brackets, control characters).
 */
export function encodeQueryValue(value: string): string {
  return value.replace(/[\x00-\x20\x7f%&#=+[\]"<>\\^`{|}]/g, (c) => {
    const hex = c.charCodeAt(0).toString(16).toUpperCase();
    return `%${hex.padStart(2, "0")}`;
  });
}

function decodeQueryValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A lone "%" (TS3 leaves some as typed): the value as it stands.
    return value;
  }
}

export function buildTs3FileUrl(ref: Ts3FileRef): string {
  const host = HOST_RE.test(ref.host) ? ref.host : "localhost";
  const params: Array<[string, string]> = [["port", String(ref.port)]];
  if (ref.serverUid) params.push(["serverUID", ref.serverUid]);
  params.push(
    ["channel", ref.cid],
    ["path", ftDirOf(ref.path)],
    ["filename", ftNameOf(ref.path)],
    ["isDir", "0"],
  );
  if (ref.size !== undefined) params.push(["size", String(ref.size)]);
  if (ref.datetime !== undefined) params.push(["fileDateTime", String(ref.datetime)]);
  const query = params.map(([k, v]) => `${k}=${encodeQueryValue(v)}`).join("&");
  return `ts3file://${host}?${query}`;
}

function count(raw: string | undefined): number | undefined {
  return raw !== undefined && COUNT_RE.test(raw) ? Number(raw) : undefined;
}

/** The file a `ts3file://` link names, or null when it is not a valid link to a file. */
export function parseTs3FileUrl(raw: string): Ts3FileRef | null {
  const m = /^ts3file:\/\/([^?/#\s]*)\/?\?([^#]*)$/i.exec(raw.trim());
  if (!m) return null;
  const q = new Map<string, string>();
  for (const pair of m[2]!.split("&")) {
    const eq = pair.indexOf("=");
    if (eq > 0) q.set(pair.slice(0, eq), decodeQueryValue(pair.slice(eq + 1)));
  }
  const cid = q.get("channel") ?? "";
  if (!CID_RE.test(cid) || q.get("isDir") === "1") return null;
  const dir = normalizeFtPath(q.get("path") || "/");
  const name = q.get("filename") ?? "";
  const path = dir ? joinFtPath(dir, name) : null;
  if (!path || !normalizeFtFilePath(path)) return null;
  const ref: Ts3FileRef = {
    host: decodeQueryValue(m[1]!),
    port: count(q.get("port")) ?? DEFAULT_TS_PORT,
    cid,
    path,
  };
  const uid = q.get("serverUID");
  if (uid) ref.serverUid = uid;
  const size = count(q.get("size"));
  if (size !== undefined) ref.size = size;
  const datetime = count(q.get("fileDateTime"));
  if (datetime !== undefined) ref.datetime = datetime;
  return ref;
}

/** A file name as link text: brackets would open or close BBCode tags. */
function labelOf(name: string): string {
  return name.replace(/\[/g, "(").replace(/\]/g, ")");
}

/** `label` cut to `max` characters, keeping its extension, with an ellipsis. */
function shorten(label: string, max: number): string {
  if (label.length <= max) return label;
  const dot = label.lastIndexOf(".");
  let ext = dot > 0 && label.length - dot <= 12 ? label.slice(dot) : "";
  if (ext.length + 2 > max) ext = "";
  // By code point, so an emoji is not cut in half.
  let head = "";
  for (const ch of label) {
    if (head.length + ch.length > max - ext.length - 1) break;
    head += ch;
  }
  return `${head}…${ext}`;
}

/** The fewest characters of the name worth showing before giving up the date. */
const MIN_LABEL = 16;

/**
 * The chat message for a shared file: `[URL=ts3file://…]name[/URL]`, within
 * `max` characters. A long name is shortened in the label (the link keeps it
 * whole), and the date is dropped if that is not enough; null when the link
 * alone does not fit.
 */
export function buildFileMessage(ref: Ts3FileRef, max = FILE_MESSAGE_MAX_CHARS): string | null {
  const label = labelOf(ftNameOf(ref.path));
  const withDate = buildTs3FileUrl(ref);
  const withoutDate = buildTs3FileUrl({ ...ref, datetime: undefined });
  const attempts: Array<[string, number]> = [
    [withDate, MIN_LABEL],
    [withoutDate, 1],
  ];
  for (const [url, minLabel] of attempts) {
    const room = max - `[URL=${url}][/URL]`.length;
    if (room >= Math.min(minLabel, label.length)) {
      return `[URL=${url}]${shorten(label, room)}[/URL]`;
    }
  }
  return null;
}
