/**
 * TeamSpeak "spacers": channels whose name is a layout instruction rather than
 * a name. The rules, as the TS3 client applies them:
 *
 * - Only a top-level channel (parent 0) can be a spacer. The same name on a
 *   sub-channel is shown literally, which is why the parent is part of the test.
 * - The name must start with `[spacer…]`, optionally prefixed with an alignment
 *   letter (`l` left, `c` centre, `r` right; plain `[spacer]` is left) and/or a
 *   `*`, which repeats the text until the row is full (`[*spacer]-`,
 *   `[*cspacer]=`). With `*` the alignment is moot: the row is filled anyway.
 * - Anything between `spacer` and `]` is ignored. Servers use it to keep the
 *   names unique (`[cspacer1]`, `[cspacer2]`), since TS forbids duplicates.
 * - Everything after `]` is the visible text; it may be empty (a blank row).
 */
const SPACER_RE = /^\[(\*)?([lcr])?spacer[^\]]*\](.*)$/is;

export type SpacerAlign = "left" | "center" | "right" | "repeat";

export interface Spacer {
  align: SpacerAlign;
  text: string;
}

const ALIGN_BY_LETTER: Record<string, SpacerAlign> = { l: "left", c: "center", r: "right" };

/** Parses a channel name as a spacer, or null when it is an ordinary channel. */
export function parseSpacer(name: string, parentId = "0"): Spacer | null {
  if (parentId !== "0") return null;
  const m = SPACER_RE.exec(name);
  if (!m) return null;
  const [, star, letter, text = ""] = m;
  const align: SpacerAlign = star
    ? "repeat"
    : (ALIGN_BY_LETTER[(letter ?? "l").toLowerCase()] ?? "left");
  return { align, text };
}

export function isSpacer(name: string, parentId = "0"): boolean {
  return parseSpacer(name, parentId) !== null;
}

/** A channel's name as shown: spacers lose their `[…spacer…]` prefix. */
export function displayChannelName(name: string, parentId = "0"): string {
  const spacer = parseSpacer(name, parentId);
  if (!spacer) return name;
  return spacer.align === "repeat" ? spacer.text : spacer.text.trim();
}

/**
 * Enough copies of a repeat-spacer's text to overflow any sane tree width; the
 * row clips the rest. Measuring the row in pixels would tie this to layout for
 * no visible gain.
 */
export const SPACER_FILL_CHARS = 400;

export function spacerFill(text: string, chars = SPACER_FILL_CHARS): string {
  if (!text) return "";
  return text.repeat(Math.max(1, Math.ceil(chars / text.length)));
}
