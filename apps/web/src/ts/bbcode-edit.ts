/** Editing helpers for the BBCode toolbar (channel description editor). */

export interface WrappedText {
  readonly text: string;
  /** Selection to restore: the wrapped text, or the caret between the tags. */
  readonly start: number;
  readonly end: number;
}

/** Puts `open` / `close` around text[start, end); returns the new text and selection. */
export function wrapSelection(
  text: string,
  start: number,
  end: number,
  open: string,
  close: string,
): WrappedText {
  const clamp = (n: number) => Math.max(0, Math.min(text.length, n));
  const a = clamp(Math.min(start, end));
  const b = clamp(Math.max(start, end));
  return {
    text: text.slice(0, a) + open + text.slice(a, b) + close + text.slice(b),
    start: a + open.length,
    end: b + open.length,
  };
}
