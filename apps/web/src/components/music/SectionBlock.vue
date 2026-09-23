<script setup lang="ts">
/**
 * A titled block in the discover / library tabs. A section the bot cannot
 * serve renders nothing at all: the user cannot log the bot into NetEase from
 * here, so an error about it would only be noise.
 *
 * A section with several source tabs is the exception. One platform lacking the
 * list must not take the tabs with it, or the user could never switch back, so
 * the heading stays and only the body says the source has nothing here.
 */
import { computed } from "vue";
import { useI18n } from "../../i18n";
import type { Section } from "../../music/section";

const props = defineProps<{
  title: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- any row type
  section: Section<any>;
  /** Shown instead of the slot when the load succeeded but returned nothing. */
  emptyText?: string;
  /** How many source tabs the heading carries (the `tabs` slot). */
  sourceCount?: number;
  /**
   * How many rows the slot actually renders, when that is not the whole loaded
   * list. 我的收藏 comes back for every platform at once and is filtered down to
   * its source tab, so only this count can tell that the tab has nothing.
   */
  visibleCount?: number;
}>();

const { t } = useI18n();
const switchable = computed(() => (props.sourceCount ?? 0) > 1);
const show = computed(() => !props.section.hidden || switchable.value);
const empty = computed(() => (props.visibleCount ?? props.section.items.length) === 0);
</script>

<template>
  <section v-if="show" class="block">
    <h4>
      <span>{{ title }}</span>
      <slot name="tabs"></slot>
    </h4>
    <p v-if="section.loading" class="hint">{{ t("music.loading") }}</p>
    <p v-else-if="section.hidden" class="hint">{{ t("music.sourceUnsupported") }}</p>
    <p v-else-if="section.error" class="hint error">{{ section.error }}</p>
    <p v-else-if="empty && emptyText" class="hint">{{ emptyText }}</p>
    <slot v-else></slot>
  </section>
</template>

<style scoped>
.block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
h4 {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-dim);
}
.hint.error {
  color: var(--danger);
}
</style>
