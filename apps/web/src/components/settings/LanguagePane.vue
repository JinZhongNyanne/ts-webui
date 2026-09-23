<script setup lang="ts">
import { useI18n } from "../../i18n";
import type { LocaleCode } from "../../i18n";

/** Settings pane: the UI languages, the current one marked. */
const { locale, setLocale, locales } = useI18n();

function choose(code: LocaleCode): void {
  setLocale(code);
}
</script>

<template>
  <div class="pane" role="radiogroup">
    <button
      v-for="l in locales"
      :key="l.code"
      role="radio"
      class="item"
      :class="{ current: l.code === locale }"
      :aria-checked="l.code === locale"
      @click="choose(l.code)"
    >
      {{ l.label }}
    </button>
  </div>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.item {
  border: none;
  background: transparent;
  text-align: left;
  padding: 7px 10px;
  border-radius: 6px;
  font-size: 13px;
}
.item:hover {
  background: var(--bg-elev-2);
}
.item.current {
  color: var(--accent);
  font-weight: 600;
}
</style>
