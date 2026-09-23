/**
 * The hub has no locale of its own, so any text it means for a human is sent as
 * a key the web client looks up in its message tables, optionally carrying
 * `{placeholder}` values. Anything the web client does not recognise as a key
 * (a raw driver/server message, say) is shown verbatim.
 *
 * Wire form: `key` or `key\u0001{"name":"value"}`.
 */
const SEP = "\u0001";

export interface TextCode {
  key: string;
  params?: Record<string, string>;
}

export function encodeTextCode(key: string, params?: Record<string, string>): string {
  return params && Object.keys(params).length ? `${key}${SEP}${JSON.stringify(params)}` : key;
}

export function decodeTextCode(text: string): TextCode {
  const i = text.indexOf(SEP);
  if (i < 0) return { key: text };
  try {
    const params = JSON.parse(text.slice(i + 1)) as Record<string, string>;
    return { key: text.slice(0, i), params };
  } catch {
    return { key: text.slice(0, i) };
  }
}
