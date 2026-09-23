import { ref, watch } from "vue";
import { defineStore } from "pinia";
import { DEFAULT_THEME, PRESETS, normalizeTheme, type Theme } from "../theme/theme";
import { applyTheme, isSafeMode } from "../theme/apply";

const KEY = "jinz.theme.v1";

function load(): Theme {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalizeTheme(JSON.parse(raw)) : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function save(theme: Theme): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(theme));
  } catch {
    /* ignore quota errors: the theme still applies for this session */
  }
}

export const useThemeStore = defineStore("theme", () => {
  const theme = ref<Theme>(load());
  const safeMode = isSafeMode();

  /** Every change goes through here: a new, validated theme replaces the old one. */
  function update(fn: (current: Theme) => Theme): void {
    theme.value = normalizeTheme(fn(theme.value));
  }

  /** A preset replaces the look but keeps the user's hand-written CSS. */
  function applyPreset(id: string): void {
    const preset = PRESETS.find((p) => p.id === id);
    if (preset) update((cur) => ({ ...preset.theme, customCss: cur.customCss }));
  }

  function reset(): void {
    update(() => DEFAULT_THEME);
  }

  watch(
    theme,
    (t) => {
      applyTheme(t, safeMode);
      save(t);
    },
    { immediate: true },
  );

  return { theme, safeMode, update, applyPreset, reset };
});
