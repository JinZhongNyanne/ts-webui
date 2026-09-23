<script setup lang="ts">
/**
 * Hotkeys tab of the audio settings popover: one recorder per action, a clear
 * button, conflict warnings, and the "PTT while typing" opt-in.
 */
import { computed } from "vue";
import { HOTKEY_ACTIONS, useHotkeysStore, type HotkeyAction } from "../../stores/hotkeys";
import { useVoiceStore } from "../../stores/voice";
import { useI18n, type MessageKey } from "../../i18n";
import HotkeyRecorder from "./HotkeyRecorder.vue";

const hotkeys = useHotkeysStore();
const voice = useVoiceStore();
const { t } = useI18n();

function actionLabel(action: HotkeyAction): string {
  return t(`hotkeys.action.${action}` as MessageKey);
}

const conflictLines = computed(() =>
  hotkeys.conflicts.map((c) => t("hotkeys.conflict", { a: actionLabel(c.a), b: actionLabel(c.b) })),
);
</script>

<template>
  <div class="panel">
    <p class="hint">{{ t("hotkeys.focusNote") }}</p>

    <div v-for="action in HOTKEY_ACTIONS" :key="action" class="binding" :data-action="action">
      <span class="name" :class="{ conflict: hotkeys.conflicted.has(action) }">
        {{ actionLabel(action) }}
      </span>
      <HotkeyRecorder :action="action" />
      <button
        type="button"
        class="reset"
        :disabled="!hotkeys.bindings[action]"
        @click="hotkeys.clear(action)"
      >
        {{ t("hotkeys.clear") }}
      </button>
    </div>

    <p v-for="line in conflictLines" :key="line" class="error">{{ line }}</p>
    <p v-if="voice.mode !== 'ptt' && hotkeys.bindings.ptt" class="hint">
      {{ t("hotkeys.pttModeHint") }}
    </p>

    <label class="row check">
      <input v-model="hotkeys.pttWhileTyping" type="checkbox" />
      <span>{{ t("hotkeys.pttWhileTyping") }}</span>
    </label>
  </div>
</template>

<style scoped src="./settings-panel.css"></style>
<style scoped>
.binding {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-dim);
}
.binding .name {
  flex: 1;
}
.binding .name.conflict {
  color: var(--danger);
}
.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-dim);
}
.error {
  margin: 0;
  font-size: 12px;
  color: var(--danger);
}
</style>
