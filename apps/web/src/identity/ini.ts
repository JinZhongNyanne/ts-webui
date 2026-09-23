/**
 * The TeamSpeak 3 client's identity export (`Tools → Identities → Export`):
 *
 * ```ini
 * [Identity]
 * id=Default
 * identity="123V<obfuscated key>"
 * nickname=Someone
 * phonetic_nickname=
 * ```
 *
 * The reader is lenient about the rest (CRLF, BOM, comments, other sections,
 * several identities in one file) because files come from different client
 * versions and third-party tools.
 */

export interface IniIdentity {
  /** The `id=` label, when the file has one. */
  name: string;
  /** Raw `identity=` value with quotes removed. */
  identity: string;
  nickname: string;
}

function unquote(value: string): string {
  const v = value.trim();
  return v.length >= 2 && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v;
}

/** True when the text looks like an ini file rather than a bare identity string. */
export function looksLikeIni(text: string): boolean {
  return /^\s*\[[^\]]+\]/m.test(text) || /^\s*(?:\d+[\\/])?identity\s*=/m.test(text);
}

/** Every `[Identity]`-style block that carries an `identity=` value. */
export function parseIdentityIni(text: string): IniIdentity[] {
  const out: IniIdentity[] = [];
  let current: Partial<IniIdentity> = {};
  const flush = (): void => {
    if (current.identity) {
      out.push({
        name: current.name ?? "",
        identity: current.identity,
        nickname: current.nickname ?? "",
      });
    }
    current = {};
  };
  for (const rawLine of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      flush();
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    // Settings-style dumps prefix keys with an index ("1\identity=").
    const key = line
      .slice(0, eq)
      .trim()
      .replace(/^\d+[\\/]/, "")
      .toLowerCase();
    const value = unquote(line.slice(eq + 1));
    if (key === "identity") {
      // A second identity= without a new section header starts a new entry.
      if (current.identity) flush();
      current.identity = value;
    } else if (key === "id") current.name = value;
    else if (key === "nickname") current.nickname = value;
  }
  flush();
  return out;
}

/** Newlines would break the line-based format; nothing legitimate contains them. */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

export function formatIdentityIni(entry: IniIdentity): string {
  return (
    [
      "[Identity]",
      `id=${oneLine(entry.name)}`,
      `identity="${entry.identity}"`,
      `nickname=${oneLine(entry.nickname)}`,
      "phonetic_nickname=",
    ].join("\n") + "\n"
  );
}
