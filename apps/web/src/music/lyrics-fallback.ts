/**
 * Lyrics from another platform when the song's own has none.
 *
 * Bilibili and YouTube have no lyrics at all, and a NetEase/QQ/Kugou track the
 * bot cannot get lyrics for is often on one of the others with them. So when
 * the song's own platform comes back empty (or fails), the same song is looked
 * up on each other lyrics platform the bot has enabled, and the first close
 * enough match with lyrics wins.
 *
 * "Close enough" is strict on purpose: lyrics for the wrong song are worse than
 * none. The title must match (after dropping bracketed tags like 【MV】), and a
 * track of a very different length is refused because its timings would be
 * off. Where the platform names real artists they must overlap. A video's
 * "artist" is its uploader, so there the title has to name the singer, and the
 * video's length must be known: a cover or a guitar lesson shares the title too.
 *
 * Pure module: the bot calls come in through `LyricsSource`.
 */
import type { MusicSong } from "@jinz/protocol";
import { parseLyrics, type LyricLine } from "./lyrics";

/** Platforms that serve lyrics, in the order they are tried. */
export const LYRICS_PLATFORMS = ["netease", "qq", "kugou"] as const;

/** Platforms whose "artist" is an uploader or channel, not who sings. */
const UPLOADER_PLATFORMS = new Set(["bilibili", "youtube"]);

/** Candidates looked at per platform. */
const SEARCH_LIMIT = 8;
/** Lengths this close (seconds) count as the same recording. */
const SAME_LENGTH_S = 3;
/** Lengths this far apart are a different cut; its timings would be wrong. */
const OTHER_CUT_S = 15;
/** Fewer lines than this is a "纯音乐，请欣赏" placeholder, not lyrics worth borrowing. */
const MIN_BORROWED_LINES = 3;

export interface LyricsSource {
  lyrics(id: string, platform: string): Promise<unknown>;
  search(query: string, platform: string, limit: number): Promise<{ songs?: MusicSong[] }>;
}

export interface FoundLyrics {
  lines: LyricLine[];
  /** Where they came from when that is not the song's own platform; null otherwise. */
  from: string | null;
}

type SongInfo = Pick<MusicSong, "id" | "name" | "platform" | "artist" | "duration">;

const BRACKETS = /【[^】]*】|\[[^\]]*\]|\([^)]*\)|（[^）]*）|《|》|「|」/g;

/** The title without tags such as 【MV】, (Live) or [Remastered]. */
export function cleanTitle(name: string): string {
  const cleaned = name.replace(BRACKETS, " ").replace(/\s+/g, " ").trim();
  return cleaned || name.trim();
}

/** Lower case, letters and digits only, so punctuation and spacing never decide a match. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function artists(s: string | undefined): string[] {
  return (s ?? "")
    .split(/[/,&、，;；]|\s+(?:feat\.?|ft\.?|x)\s+/i)
    .map(norm)
    .filter(Boolean);
}

/** How closely the titles agree: 4 exact, 2 once version tags are dropped, 1 contained; else 0. */
function titleScore(song: SongInfo, candidate: SongInfo, video: boolean): number {
  const want = norm(cleanTitle(song.name));
  const have = norm(candidate.name);
  const haveClean = norm(cleanTitle(candidate.name));
  if (!want || !haveClean) return 0;
  if (have === want || have === norm(song.name)) return 4;
  if (haveClean === want) return 2;
  // A video title tends to carry the song title and more ("《晴天》- 周杰伦 无损").
  if (video && haveClean.length >= 2 && want.includes(haveClean)) return 1;
  return 0;
}

/**
 * How well `candidate` matches `song`; null when it must not be used. Higher
 * is better.
 */
export function matchScore(song: SongInfo, candidate: SongInfo): number | null {
  const video = UPLOADER_PLATFORMS.has(song.platform);
  let score = titleScore(song, candidate, video);
  if (score === 0) return null;

  const theirs = artists(candidate.artist);
  // Whether a singer was confirmed; without one only a same-length track will do.
  let singer: boolean;
  if (video) {
    const title = norm(song.name);
    singer = theirs.some((a) => a.length >= 2 && title.includes(a));
    // A cover or a lesson carries the song's title too; the singer must be named.
    if (!singer) return null;
    score += 3;
  } else {
    const mine = artists(song.artist);
    if (mine.length > 0 && !mine.some((a) => theirs.includes(a))) return null;
    singer = mine.length > 0;
    if (singer) score += 2;
  }

  const a = song.duration ?? 0;
  const b = candidate.duration ?? 0;
  const known = a > 0 && b > 0;
  const gap = known ? Math.abs(a - b) : Infinity;
  // A video of unknown length may be anything; a track with no artist must match exactly.
  if ((video && !known) || (!singer && gap > SAME_LENGTH_S)) return null;
  if (known && gap > OTHER_CUT_S) return null;
  if (gap <= SAME_LENGTH_S) score += 1;
  return score;
}

/** The best acceptable match among `candidates`, or null. */
export function bestMatch(song: SongInfo, candidates: readonly SongInfo[]): SongInfo | null {
  let best: SongInfo | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const s = matchScore(song, c);
    if (s !== null && s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  return best;
}

/** Other platforms to try, in order: enabled ones only, once `enabled` is known. */
export function fallbackPlatforms(own: string, enabled: readonly string[]): string[] {
  return LYRICS_PLATFORMS.filter((p) => p !== own && (enabled.length === 0 || enabled.includes(p)));
}

async function tryOwn(song: SongInfo, source: LyricsSource): Promise<LyricLine[] | null> {
  try {
    return parseLyrics(await source.lyrics(String(song.id), song.platform));
  } catch {
    return null;
  }
}

async function tryPlatform(
  song: SongInfo,
  platform: string,
  source: LyricsSource,
): Promise<LyricLine[]> {
  const query = UPLOADER_PLATFORMS.has(song.platform)
    ? cleanTitle(song.name)
    : `${cleanTitle(song.name)} ${song.artist ?? ""}`.trim();
  const found = await source.search(query, platform, SEARCH_LIMIT);
  const match = bestMatch(song, found.songs ?? []);
  if (!match) return [];
  const lines = parseLyrics(await source.lyrics(String(match.id), platform));
  return lines.length >= MIN_BORROWED_LINES ? lines : [];
}

/**
 * The song's lyrics, from its own platform or, failing that, another one.
 * Throws only when the song's own platform failed and no other had lyrics,
 * so the view can still tell "could not load" from "has none".
 */
export async function findLyrics(
  song: SongInfo,
  enabled: readonly string[],
  source: LyricsSource,
): Promise<FoundLyrics> {
  const own = await tryOwn(song, source);
  if (own && own.length > 0) return { lines: own, from: null };
  for (const platform of fallbackPlatforms(song.platform, enabled)) {
    try {
      const lines = await tryPlatform(song, platform, source);
      if (lines.length > 0) return { lines, from: platform };
    } catch {
      // That platform is down or refused; the next one may still have them.
    }
  }
  if (own === null) throw new Error("lyrics unavailable");
  return { lines: [], from: null };
}
