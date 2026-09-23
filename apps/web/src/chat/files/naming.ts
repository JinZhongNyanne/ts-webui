/**
 * Names for files shared in chat. They go into the channel's root, where
 * other people's files are too, so an upload never replaces one: a taken
 * name gets " (2)", " (3)"… like a file manager does, and when the folder
 * cannot be listed (no browse permission) the name gets a timestamp instead.
 */
import { FT_NAME_MAX } from "@jinz/protocol";

/** Splits off the last extension; a leading dot is part of the name (".env"). */
function splitExt(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

/** `stem + suffix + ext`, cutting the stem so the whole fits FT_NAME_MAX. */
function withSuffix(name: string, suffix: string): string {
  const [stem, ext] = splitExt(name);
  const room = FT_NAME_MAX - suffix.length - ext.length;
  return `${stem.slice(0, Math.max(1, room)).trimEnd()}${suffix}${ext}`;
}

/** `name`, or the first of "name (2)", "name (3)"… that is not in `taken` (case ignored). */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  const lower = new Set([...taken].map((n) => n.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const next = withSuffix(name, ` (${n})`);
    if (!lower.has(next.toLowerCase())) return next;
  }
}

const pad = (n: number): string => String(n).padStart(2, "0");

function stamp(at: Date): string {
  const date = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  return `${date}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
}

/** "photo.jpg" -> "photo_20260919-070503.jpg" (local time). */
export function stampedName(name: string, at: Date): string {
  return withSuffix(name, `_${stamp(at)}`);
}

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/bmp": "bmp",
};

/** A name for pasted clipboard data, which comes without one (or as "image.png"). */
export function pastedName(mime: string, at: Date): string {
  const ext = EXT_BY_MIME[mime];
  return ext ? `image_${stamp(at)}.${ext}` : `file_${stamp(at)}.bin`;
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
};

/**
 * The image type to show a file as, by its extension; null for anything
 * that is not a plain picture (SVG is a document that can carry scripts).
 */
export function imageMimeOf(name: string): string | null {
  const [, ext] = splitExt(name);
  return MIME_BY_EXT[ext.slice(1).toLowerCase()] ?? null;
}

/**
 * Videos are trickier than pictures: a container is not a codec, and a file a
 * browser cannot play must not be offered as one it can — a player that shows
 * a black box and an error is worse than the plain download card the file
 * would otherwise have had.
 *
 * So only the three containers every current browser plays are listed, and
 * only for the codecs anyone actually shares in them: MP4 (H.264/AAC), WebM
 * (VP8/VP9/AV1 with Vorbis or Opus) and Ogg. Matroska, AVI, WMV, FLV and
 * QuickTime are left out on purpose, `.mov` included: some browsers play some
 * `.mov` files and none play all of them, and a maybe is not good enough to
 * hang a play button on. `.ogg` is left out as well, being an audio file far
 * more often than a video one.
 *
 * The extension is all there is to go on: a `ts3file://` link carries a name,
 * never a content type, and reading the file's first bytes would mean fetching
 * it — which is the very thing nothing may do before the user asks.
 */
const VIDEO_MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
};

/** The video type to play a file as, by its extension; null when no browser would. */
export function videoMimeOf(name: string): string | null {
  const [, ext] = splitExt(name);
  return VIDEO_MIME_BY_EXT[ext.slice(1).toLowerCase()] ?? null;
}

/**
 * The type to hand a `blob:` URL the page shows itself, picture or video.
 * A blob with the wrong type is a file a `<video>` refuses to play, so this is
 * what previews.ts and videos.ts label their bytes with.
 */
export function playableMimeOf(name: string): string | null {
  return imageMimeOf(name) ?? videoMimeOf(name);
}
