<script setup lang="ts">
/**
 * 网易云 / QQ音乐 / 酷狗 — the platform switch beside a discover heading.
 * With a single source it is just a label, so the user still sees where the
 * list comes from.
 */
import { useI18n } from "../../i18n";
import { SOURCE_LABEL_KEYS } from "../../music/discover-sources";

defineProps<{ sources: string[]; modelValue: string | null }>();
const emit = defineEmits<{ "update:modelValue": [string] }>();
const { t } = useI18n();

const label = (p: string): string =>
  p in SOURCE_LABEL_KEYS ? t(SOURCE_LABEL_KEYS[p as keyof typeof SOURCE_LABEL_KEYS]) : p;
</script>

<template>
  <span v-if="sources.length > 1" class="tabs" role="tablist">
    <button
      v-for="p in sources"
      :key="p"
      type="button"
      role="tab"
      class="tab"
      :class="{ active: p === modelValue }"
      :aria-selected="p === modelValue"
      @click="p !== modelValue && emit('update:modelValue', p)"
    >
      {{ label(p) }}
    </button>
  </span>
  <span v-else-if="sources.length === 1" class="single">{{ label(sources[0]!) }}</span>
</template>

<style scoped>
.tabs {
  display: inline-flex;
  gap: 2px;
}
.tab,
.single {
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
  border-radius: 999px;
}
.tab {
  border: none;
  background: none;
  color: var(--text-dim);
}
.tab:hover {
  color: var(--text);
  background: var(--bg-elev-2);
}
.tab.active {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  font-weight: 600;
}
.single {
  color: var(--text-dim);
  background: var(--bg-elev-2);
}
</style>
