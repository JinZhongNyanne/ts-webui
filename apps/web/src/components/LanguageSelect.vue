<script setup lang="ts">
import { useI18n } from "../i18n";
import type { LocaleCode } from "../i18n";

/** The UI-language dropdown; used on the connect screen and in the profile popover. */
const { locale, setLocale, locales } = useI18n();

function onChange(ev: Event): void {
  const code = (ev.target as HTMLSelectElement).value;
  if (locales.some((l) => l.code === code)) setLocale(code as LocaleCode);
}
</script>

<template>
  <select class="lang" :value="locale" :title="$t('profile.language')" @change="onChange">
    <option v-for="l in locales" :key="l.code" :value="l.code">{{ l.label }}</option>
  </select>
</template>

<style scoped>
.lang {
  font-size: 12px;
  padding: 4px 8px;
}
</style>
