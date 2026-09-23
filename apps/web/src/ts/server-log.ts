/**
 * The virtual server's log (`logview`, answered by `notifyserverlog`), parsed
 * and filtered without Vue or the hub so it is easy to test.
 *
 * Each row carries one line in `l`, in TeamSpeak's own file format:
 *
 *   2026-09-21 21:28:13.473568|INFO    |VirtualServer |1  |client 'x'(id:4) was …
 *
 * time (UTC), level, channel and virtual server id, padded with spaces, then
 * the message, which may itself hold a `|`. The first row also carries
 * `last_pos` (where the next page starts, 0 at the start of the file with
 * `reverse=1`) and `file_size`.
 */
import type { TsCmdRow } from "@jinz/protocol";

/** The levels a TS3 server writes; anything else reads as UNKNOWN. */
export const LOG_LEVELS = ["CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG", "UNKNOWN"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LogEntry {
  /** Unix ms, 0 when the line has no time we can read. */
  readonly at: number;
  readonly level: LogLevel;
  readonly channel: string;
  readonly message: string;
  /** The line as the server wrote it, for copying. */
  readonly raw: string;
}

export interface LogPage {
  /** In the order the server sent them: newest first when paging backwards. */
  readonly entries: readonly LogEntry[];
  readonly lastPos: number;
  readonly fileSize: number;
}

/** `time|level|channel|sid|message`: the message is everything after the fourth `|`. */
const COLUMNS = 5;
const TIME_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/;

function parseTime(text: string): number {
  const m = TIME_RE.exec(text.trim());
  if (!m) return 0;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  // Microseconds on the wire; a Date holds milliseconds.
  const millis = m[7] ? Math.floor(Number(m[7].padEnd(6, "0")) / 1000) : 0;
  return Date.UTC(y, mo - 1, d, h, mi, s, millis);
}

function levelOf(text: string): LogLevel {
  const level = text.trim().toUpperCase();
  return (LOG_LEVELS as readonly string[]).includes(level) ? (level as LogLevel) : "UNKNOWN";
}

/** One log line, or null for an empty one. A line in no known shape is kept whole. */
export function parseLogLine(line: string): LogEntry | null {
  if (!line.trim()) return null;
  const parts = line.split("|");
  if (parts.length < COLUMNS) {
    return { at: 0, level: "UNKNOWN", channel: "", message: line.trim(), raw: line };
  }
  const [time, level, channel] = parts;
  return {
    at: parseTime(time ?? ""),
    level: levelOf(level ?? ""),
    channel: (channel ?? "").trim(),
    message: parts
      .slice(COLUMNS - 1)
      .join("|")
      .trim(),
    raw: line,
  };
}

const int = (v: string | undefined): number => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
};

export function parseLogPage(rows: readonly TsCmdRow[]): LogPage {
  const first = rows[0];
  const entries = rows.flatMap((r) => parseLogLine(r["l"] ?? "") ?? []);
  return { entries, lastPos: int(first?.["last_pos"]), fileSize: int(first?.["file_size"]) };
}

/** Where the next (older) page starts, or null once the start of the file is reached. */
export function nextLogPage(page: LogPage): number | null {
  return page.lastPos > 0 ? page.lastPos : null;
}

export interface LogFilter {
  readonly levels: ReadonlySet<string>;
  readonly query: string;
}

/** The entries of the chosen levels whose message or channel holds the query. */
export function filterLog(entries: readonly LogEntry[], filter: LogFilter): LogEntry[] {
  const q = filter.query.trim().toLowerCase();
  return entries.filter(
    (e) =>
      filter.levels.has(e.level) &&
      (!q || e.message.toLowerCase().includes(q) || e.channel.toLowerCase().includes(q)),
  );
}
