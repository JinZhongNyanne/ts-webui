/**
 * `Content-Disposition` for a file served from a TeamSpeak channel.
 *
 * Always `attachment`: the hub's origin must never render a file someone
 * uploaded (an HTML file shown inline would run with the page's rights). The
 * name comes twice, as RFC 6266 suggests: a plain-ASCII `filename` for old
 * clients, with anything that could end the quoted string or the header
 * replaced, and the real name as an RFC 5987 `filename*`.
 */

/** Characters RFC 5987 lets through unencoded in an ext-value (attr-char). */
const ATTR_CHAR = /[A-Za-z0-9!#$&+.^_`|~-]/;

const FALLBACK_NAME = "download";

/** Printable ASCII minus the quote and backslash; everything else becomes `_`. */
function asciiFallback(name: string): string {
  return [...name]
    .map((c) => (/^[\x20-\x7e]$/.test(c) && c !== '"' && c !== "\\" ? c : "_"))
    .join("");
}

function encodeExtValue(name: string): string {
  const bytes = new TextEncoder().encode(name);
  let out = "";
  for (const b of bytes) {
    const c = String.fromCharCode(b);
    out += b < 0x80 && ATTR_CHAR.test(c) ? c : `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

export function contentDisposition(name: string): string {
  const safe = name || FALLBACK_NAME;
  return `attachment; filename="${asciiFallback(safe)}"; filename*=UTF-8''${encodeExtValue(safe)}`;
}
