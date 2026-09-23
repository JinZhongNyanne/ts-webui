/**
 * Lyrics for the scrolling lyrics view.
 *
 * The bot answers `/music/lyrics/:id` with `{ lyrics: [{ time, text,
 * translation? }] }`, `time` in seconds, already merged with the translation.
 * Older builds and some providers hand back a raw LRC string instead, so that
 * is parsed here too. Either way the payload crosses a trust boundary: rows
 * that cannot be placed on the timeline are dropped rather than thrown on.
 *
 * Pure module: no Vue, no fetch.
 */

export interface LyricLine {
  /** Seconds from the start of the song. */
  time: number;
  text: string;
  translation?: string;
}

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

function tagSeconds(min: string, sec: string, frac: string | undefined): number {
  const fraction = frac ? Number(frac) / 10 ** frac.length : 0;
  return Number(min) * 60 + Number(sec) + fraction;
}

/** `[mm:ss.xx] text` lines; one line may carry several time tags. */
export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const times: number[] = [];
    let rest = raw;
    for (const m of raw.matchAll(TIME_TAG)) times.push(tagSeconds(m[1]!, m[2]!, m[3]));
    if (times.length === 0) continue;
    rest = raw.replace(TIME_TAG, "").trim();
    if (!rest) continue;
    for (const time of times) out.push({ time, text: rest });
  }
  return out.sort((a, b) => a.time - b.time);
}

function fromRow(r: unknown): LyricLine | null {
  if (typeof r !== "object" || r === null) return null;
  const { time, text, translation } = r as Record<string, unknown>;
  if (typeof time !== "number" || !Number.isFinite(time) || time < 0) return null;
  if (typeof text !== "string" || !text.trim()) return null;
  const line: LyricLine = { time, text: text.trim() };
  if (typeof translation === "string" && translation.trim()) {
    line.translation = translation.trim();
  }
  return line;
}

/** Whatever `/music/lyrics/:id` answered, as timed lines in play order. */
export function parseLyrics(payload: unknown): LyricLine[] {
  if (typeof payload !== "object" || payload === null) return [];
  const lyrics = (payload as { lyrics?: unknown }).lyrics;
  if (typeof lyrics === "string") return parseLrc(lyrics);
  if (!Array.isArray(lyrics)) return [];
  return lyrics
    .map(fromRow)
    .filter((l): l is LyricLine => l !== null)
    .sort((a, b) => a.time - b.time);
}

/** The line being sung at `elapsed` seconds, or -1 before the first one. */
export function activeLineIndex(lines: readonly LyricLine[], elapsed: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.time <= elapsed) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
