<script setup lang="ts">
/**
 * Where the file browser is: the channel's root (by the channel's name), then
 * each folder; every crumb but the last goes there. On a narrow window the
 * trail scrolls sideways rather than wrapping.
 */
import { computed } from "vue";
import { breadcrumbs } from "../../files/browser";
import { useI18n } from "../../i18n";

const props = defineProps<{ path: string; rootLabel: string }>();
const emit = defineEmits<{ go: [path: string] }>();
const { t } = useI18n();

const crumbs = computed(() => breadcrumbs(props.path));
</script>

<template>
  <nav class="crumbs" :aria-label="t('fb.path')" data-testid="fb-breadcrumb">
    <template v-for="(c, i) in crumbs" :key="c.path">
      <span v-if="i > 0" class="sep" aria-hidden="true">›</span>
      <span v-if="i === crumbs.length - 1" class="crumb current" aria-current="location">
        {{ c.name || rootLabel }}
      </span>
      <button
        v-else
        type="button"
        class="crumb"
        :data-path="c.path"
        data-testid="fb-crumb"
        @click="emit('go', c.path)"
      >
        {{ c.name || rootLabel }}
      </button>
    </template>
  </nav>
</template>

<style scoped>
.crumbs {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
  white-space: nowrap;
  font-size: 12px;
}
.crumb {
  flex: none;
  max-width: 16em;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 1px 6px;
  border-color: transparent;
  background: transparent;
}
button.crumb:hover {
  border-color: var(--border);
}
.current {
  font-weight: 600;
}
.sep {
  color: var(--text-dim);
}
</style>
