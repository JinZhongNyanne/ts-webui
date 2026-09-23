/**
 * Tiny i18n layer: one flat dictionary per locale, a `t()` that fills
 * `{placeholder}`s, and a `$t` global so templates need no imports.
 *
 * Adding a language means adding a `Messages` table and listing it in LOCALES —
 * every string the UI shows goes through a key in `zh-CN.ts` (the source locale).
 */
import { ref, type App } from "vue";
import { decodeTextCode } from "@jinz/protocol";
import { zhCN, type MessageKey, type Messages } from "./zh-CN";
import { en } from "./en";

export type LocaleCode = "zh-CN" | "en";

export const LOCALES: { code: LocaleCode; label: string; messages: Messages }[] = [
  { code: "zh-CN", label: "简体中文", messages: zhCN },
  { code: "en", label: "English", messages: en },
];

const STORAGE_KEY = "jinz.locale";

function detect(): LocaleCode {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && LOCALES.some((l) => l.code === saved)) return saved as LocaleCode;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export const locale = ref<LocaleCode>(detect());

export function setLocale(code: LocaleCode): void {
  locale.value = code;
  localStorage.setItem(STORAGE_KEY, code);
  applyDocumentLocale();
}

function applyDocumentLocale(): void {
  document.documentElement.lang = locale.value;
  document.title = t("app.title");
}

function table(code: LocaleCode): Messages {
  return LOCALES.find((l) => l.code === code)?.messages ?? zhCN;
}

/** Translates a key, falling back to the source locale and then to the key itself. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const raw = table(locale.value)[key] ?? zhCN[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/**
 * Translates a text code the hub sent (e.g. "hub.connectTimeout"). Anything
 * that is not a known key is passed through verbatim, so raw server text still
 * reaches the user.
 */
export function translateCode(code: string): string {
  const { key, params } = decodeTextCode(code);
  return key in zhCN ? t(key as MessageKey, params) : key;
}

export function useI18n() {
  return { t, locale, setLocale, locales: LOCALES };
}

export function installI18n(app: App): void {
  app.config.globalProperties.$t = t;
  applyDocumentLocale();
}

export type { MessageKey, Messages };
