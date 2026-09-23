<script setup lang="ts">
/**
 * Renders whatever `confirmDialog()` is waiting on. Mounted once in App.vue,
 * so any code — a store action, a context-menu handler — can ask without
 * owning a component of its own.
 */
import { useI18n } from "../../i18n";
import AppDialog from "./AppDialog.vue";
import { confirmQueue } from "./confirm";

const { t } = useI18n();
const current = confirmQueue.current;
</script>

<template>
  <!-- Keyed by id: the next queued prompt is a fresh dialog, with fresh focus. -->
  <AppDialog
    v-if="current"
    :key="current.id"
    :title="current.title"
    :danger="current.danger"
    @close="confirmQueue.answer(current.id, false)"
  >
    <p v-if="current.message" class="message">{{ current.message }}</p>
    <template #footer>
      <button type="button" @click="confirmQueue.answer(current.id, false)">
        {{ current.cancelLabel ?? t("dialog.cancel") }}
      </button>
      <!--
        Focused first, as in a native confirm — unless the action is
        destructive, where a reflexive Enter must not be the thing that fires it.
      -->
      <button
        type="button"
        :class="current.danger ? 'danger' : 'primary'"
        :autofocus="!current.danger"
        @click="confirmQueue.answer(current.id, true)"
      >
        {{ current.confirmLabel ?? t("dialog.ok") }}
      </button>
    </template>
  </AppDialog>
</template>

<style scoped>
.message {
  margin: 0;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
</style>
