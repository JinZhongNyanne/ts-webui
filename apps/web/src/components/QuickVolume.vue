<script setup lang="ts">
/**
 * Split status-bar control for one audio direction: the mute toggle on the
 * left, a caret on the right that opens a compact volume popover. Wheel
 * scrolling over either button nudges the volume without opening anything.
 */
import { computed, ref } from "vue";
import { useI18n } from "../i18n";
import { usePopover } from "../composables/usePopover";
import {
  stepVolume,
  volumePercent,
  VOLUME_DEFAULT,
  VOLUME_MAX,
  VOLUME_MIN,
  VOLUME_STEP,
} from "./volume/quickVolume";

const props = defineProps<{
  modelValue: number;
  label: string;
  icon: string;
  /** Tooltip of the mute toggle; falls back to the volume label. */
  muteTitle?: string;
  muted: boolean;
  disabled: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [value: number]; "toggle-mute": [] }>();
const { t } = useI18n();

const SPEAKER_ICON = "🔊";
const SPEAKER_MUTED_ICON = "🔇";

const root = ref<HTMLElement | null>(null);
/** Aligned on the trigger's right edge: these sit at the end of the status bar. */
const { open, toggle, panel, style } = usePopover(root, { align: "end" });

const silent = computed(() => props.modelValue <= VOLUME_MIN);
const pct = computed(() => volumePercent(props.modelValue));
const shownIcon = computed(() =>
  props.icon === SPEAKER_ICON && (props.muted || silent.value) ? SPEAKER_MUTED_ICON : props.icon,
);
/** The speaker icon already says "muted"; only the mic gets the word. */
const toggleText = computed(() =>
  props.muted && props.icon !== SPEAKER_ICON
    ? `${shownIcon.value} ${t("status.mutedShort")}`
    : shownIcon.value,
);

function setVolume(value: number): void {
  emit("update:modelValue", value);
}

function onWheel(ev: WheelEvent): void {
  ev.preventDefault();
  setVolume(stepVolume(props.modelValue, ev.deltaY));
}

function onSlider(ev: Event): void {
  const target = ev.target;
  if (!(target instanceof HTMLInputElement)) return;
  setVolume(stepVolume(Number(target.value), 0));
}
</script>

<template>
  <div ref="root" class="quick" @wheel="onWheel">
    <button
      class="mute"
      :class="{ active: muted, silent: silent && !muted }"
      :disabled="disabled"
      :title="muteTitle ?? label"
      @click="emit('toggle-mute')"
    >
      {{ toggleText }}
    </button>
    <button
      class="caret"
      :class="{ active: open }"
      :title="t('status.openVolume')"
      :aria-expanded="open"
      @click="toggle"
    >
      ▾
    </button>

    <!-- Teleported out of the bar so the popover is not clipped by a dock
         window or by the bar's own blur; `style` pins it to the caret. The
         wheel handler comes along, since scrolling over it still nudges. -->
    <teleport to="body">
      <div v-if="open" ref="panel" class="popover glass" :style="style" @wheel="onWheel">
        <div class="head">
          <span class="name">{{ label }}</span>
          <span class="pct" :class="{ zero: silent }">{{ t("status.volumePct", { pct }) }}</span>
        </div>
        <input
          type="range"
          :min="VOLUME_MIN"
          :max="VOLUME_MAX"
          :step="VOLUME_STEP"
          :value="modelValue"
          :aria-label="label"
          @input="onSlider"
        />
        <button
          class="reset"
          :disabled="modelValue === VOLUME_DEFAULT"
          @click="setVolume(VOLUME_DEFAULT)"
        >
          {{ t("status.resetVolume") }}
        </button>
      </div>
    </teleport>
  </div>
</template>

<style scoped>
.quick {
  position: relative;
  display: inline-flex;
  align-items: stretch;
}
.mute {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}
.caret {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  border-left: none;
  padding: 6px 6px;
  color: var(--text-dim);
  font-size: 11px;
}
/* A 19px-wide caret is a mouse target; a fingertip needs the whole minimum,
   and the icon beside it came out a pixel short of one too. */
@media (pointer: coarse) {
  .caret,
  .mute {
    min-width: var(--touch-target);
  }
}
button.active {
  border-color: var(--warn);
  color: var(--warn);
}
.mute.silent {
  color: var(--text-dim);
  text-decoration: line-through;
  text-decoration-color: var(--warn);
}
/* Placed by `usePopover`: fixed, on the popover layer, anchored on the caret. */
.popover {
  width: 220px;
  max-width: var(--popover-max-width, 100vw);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  font-size: 12px;
  color: var(--text-dim);
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.name {
  font-weight: 600;
  color: var(--text);
}
.pct {
  font-variant-numeric: tabular-nums;
  color: var(--accent);
}
.pct.zero {
  color: var(--warn);
}
input[type="range"] {
  width: 100%;
  padding: 0;
  border: none;
  background: transparent;
}
.reset {
  align-self: flex-end;
  padding: 4px 10px;
  font-size: 12px;
}
</style>
