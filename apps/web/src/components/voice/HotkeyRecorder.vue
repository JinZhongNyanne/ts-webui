<script setup lang="ts">
/**
 * A button that records one hotkey binding. Click it, then press the combo:
 * a key with any modifiers, a bare modifier (recorded on its release, so that
 * Ctrl+K is still possible), or the middle / side mouse buttons. Escape
 * cancels; leaving the button (blur) cancels too.
 */
import { computed, onBeforeUnmount, ref } from "vue";
import { useHotkeysStore, type HotkeyAction } from "../../stores/hotkeys";
import {
  comboFromKey,
  comboFromMouse,
  comboLabel,
  formatCombo,
  isModifierCode,
  parseCombo,
} from "../../hotkeys/combo";
import { useI18n } from "../../i18n";

const props = defineProps<{ action: HotkeyAction }>();
const hotkeys = useHotkeysStore();
const { t } = useI18n();

const recording = computed(() => hotkeys.recording === props.action);
/** A modifier pressed on its own; becomes the binding if released before any other key. */
const pendingModifier = ref<string | null>(null);

const label = computed(() => {
  if (recording.value) return t("hotkeys.recording");
  const combo = parseCombo(hotkeys.bindings[props.action]);
  return combo ? comboLabel(combo) : t("hotkeys.unbound");
});

function start(): void {
  pendingModifier.value = null;
  hotkeys.recording = props.action;
}

function stop(): void {
  pendingModifier.value = null;
  if (hotkeys.recording === props.action) hotkeys.recording = null;
}

// Closing the settings mid-recording removes this element without a reliable
// blur, and a recording left set silences every hotkey (PTT too) until reload.
onBeforeUnmount(stop);

function commit(combo: string): void {
  hotkeys.bind(props.action, combo);
  stop();
}

function onKeydown(ev: KeyboardEvent): void {
  if (!recording.value) return;
  ev.preventDefault();
  // The popover closes on a document-level Escape, and the page-level hotkey
  // listener must not run the combo being recorded.
  ev.stopPropagation();
  if (ev.code === "Escape") {
    stop();
    return;
  }
  if (isModifierCode(ev.code)) {
    pendingModifier.value = ev.code;
    return;
  }
  pendingModifier.value = null;
  commit(formatCombo(comboFromKey(ev)));
}

function onKeyup(ev: KeyboardEvent): void {
  if (!recording.value) return;
  ev.preventDefault();
  ev.stopPropagation();
  if (pendingModifier.value && ev.code === pendingModifier.value) commit(pendingModifier.value);
}

function onMousedown(ev: MouseEvent): void {
  if (!recording.value) return;
  const combo = comboFromMouse(ev);
  if (!combo) return; // left / right click: leave the button usable
  ev.preventDefault();
  // Recording ends right here, so the page-level hotkey listener would
  // otherwise see this same press and run the action just bound to it.
  ev.stopPropagation();
  commit(formatCombo(combo));
}
</script>

<template>
  <button
    type="button"
    class="recorder"
    :class="{ recording }"
    :title="t('hotkeys.recordTitle')"
    @click="recording ? undefined : start()"
    @keydown="onKeydown"
    @keyup="onKeyup"
    @mousedown="onMousedown"
    @auxclick.prevent
    @contextmenu="recording && $event.preventDefault()"
    @blur="stop"
  >
    {{ label }}
  </button>
</template>

<style scoped>
.recorder {
  min-width: 120px;
  padding: 3px 8px;
  font-size: 12px;
  text-align: center;
}
.recording {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
