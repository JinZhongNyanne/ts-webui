/**
 * Guesses the language of a chat message from its script, so the browser voice
 * matches what is being read instead of the UI language.
 */
export type SpeechLang = "zh-CN" | "ja-JP" | "ko-KR" | "ru-RU" | "en-US";

const SCRIPTS: { lang: SpeechLang; re: RegExp }[] = [
  { lang: "ja-JP", re: /[\u3040-\u30ff]/u },
  { lang: "ko-KR", re: /[\uac00-\ud7af\u1100-\u11ff]/u },
  { lang: "zh-CN", re: /[\u4e00-\u9fff\u3400-\u4dbf]/u },
  { lang: "ru-RU", re: /[\u0400-\u04ff]/u },
];

/** Kana wins over Han because Japanese text mixes both; otherwise first script hit. */
export function detectLanguage(text: string, fallback: SpeechLang = "en-US"): SpeechLang {
  for (const { lang, re } of SCRIPTS) {
    if (re.test(text)) return lang;
  }
  return fallback;
}

/** Maps a UI locale to the speech language used when the text gives no hint. */
export function fallbackFor(locale: string): SpeechLang {
  return locale.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

/** Picks the voice whose language matches best: exact tag, then same primary language. */
export function pickVoice<T extends { lang: string }>(
  voices: readonly T[],
  lang: SpeechLang,
): T | null {
  const want = lang.toLowerCase();
  const exact = voices.find((v) => v.lang.toLowerCase().replace("_", "-") === want);
  if (exact) return exact;
  const primary = want.slice(0, 2);
  return voices.find((v) => v.lang.toLowerCase().startsWith(primary)) ?? null;
}
