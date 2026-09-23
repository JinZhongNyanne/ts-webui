<script setup lang="ts">
import { useI18n } from "../i18n";
import { WINDOW_META, type WindowId } from "./windowMeta";

/**
 * One desktop icon. A single click opens its window, as does Enter or Space on
 * a focused icon — the keyboard path a click alone would leave out.
 *
 * There is no "selected" state any more: selection only earned its place while
 * opening took a second click, as the thing the first click did. Now that one
 * click opens, a selected-but-not-open icon is a state the user can barely
 * reach and never needs, so hover and `:focus-visible` carry the feedback on
 * their own.
 */
defineProps<{ id: WindowId }>();
const emit = defineEmits<{ open: [id: WindowId] }>();
const { t } = useI18n();
</script>

<template>
  <button
    class="desk-icon"
    type="button"
    data-testid="desktop-icon"
    :data-window="id"
    :title="t('desktop.open', { name: t(WINDOW_META[id].key) })"
    @click="emit('open', id)"
    @keydown.enter.prevent="emit('open', id)"
    @keydown.space.prevent="emit('open', id)"
  >
    <span class="glyph" aria-hidden="true">{{ WINDOW_META[id].icon }}</span>
    <span class="label">{{ t(WINDOW_META[id].key) }}</span>
  </button>
</template>
