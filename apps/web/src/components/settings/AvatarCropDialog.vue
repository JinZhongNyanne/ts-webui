<script setup lang="ts">
/**
 * Square crop for the TeamSpeak avatar: drag or the arrow keys to move,
 * wheel, +/- or the slider to zoom (crop maths in avatar/crop.ts). Saving
 * scales the square to at most 300 px, compresses it under the server's
 * limit (avatar/render.ts) and hands it to `upload`; we close once that went
 * through. Cancel stops an upload that is still running.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { formatBytes } from "@jinz/protocol";
import AppDialog from "../ui/AppDialog.vue";
import { useI18n } from "../../i18n";
import { MAX_ZOOM, initialView, panView, zoomView, type CropView } from "../../avatar/crop";
import { renderAvatar } from "../../avatar/render";

const props = defineProps<{
  file: File;
  /** Largest file the server takes (bytes). */
  limit: number;
  /** Uploads the result; rejects with a readable message. */
  upload: (blob: Blob, signal: AbortSignal) => Promise<void>;
}>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();

/** Side of the crop box on screen (CSS px). */
const BOX = 240;
/** How far one arrow key moves the image, and what one +/- step zooms by. */
const PAN_STEP = 10;
const ZOOM_STEP = 1.1;
const url = URL.createObjectURL(props.file);
const img = ref<HTMLImageElement | null>(null);
const view = shallowRef<CropView | null>(null);
const failed = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);
let drag: { id: number; x: number; y: number } | null = null;
let uploadAbort: AbortController | null = null;

const imgStyle = computed(() => {
  const v = view.value;
  if (!v) return { visibility: "hidden" as const };
  return {
    width: `${v.imgW}px`,
    height: `${v.imgH}px`,
    transform: `translate(${v.x}px, ${v.y}px) scale(${v.scale})`,
  };
});
/** The slider: 1 = the image just covers the box, MAX_ZOOM = fully zoomed in. */
const zoom = computed(() => {
  const v = view.value;
  return v ? v.scale / (BOX / Math.min(v.imgW, v.imgH)) : 1;
});

function onLoad(): void {
  const el = img.value;
  if (!el?.naturalWidth || !el.naturalHeight) {
    failed.value = true;
    return;
  }
  view.value = initialView(el.naturalWidth, el.naturalHeight, BOX);
}

function onPointerDown(ev: PointerEvent): void {
  if (!view.value || drag) return;
  drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
  (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
}

function onPointerMove(ev: PointerEvent): void {
  if (!view.value || drag?.id !== ev.pointerId) return;
  view.value = panView(view.value, ev.clientX - drag.x, ev.clientY - drag.y);
  drag = { ...drag, x: ev.clientX, y: ev.clientY };
}

function onPointerUp(ev: PointerEvent): void {
  if (drag?.id === ev.pointerId) drag = null;
}

function onWheel(ev: WheelEvent): void {
  if (!view.value) return;
  const box = (ev.currentTarget as HTMLElement).getBoundingClientRect();
  const factor = Math.exp(-ev.deltaY * 0.0015);
  view.value = zoomView(view.value, factor, ev.clientX - box.left, ev.clientY - box.top);
}

/** Arrow keys pan, + and - zoom around the middle: the mouse is not the only way. */
function onKey(ev: KeyboardEvent): void {
  const v = view.value;
  if (!v) return;
  const pan: Record<string, [number, number]> = {
    ArrowLeft: [-PAN_STEP, 0],
    ArrowRight: [PAN_STEP, 0],
    ArrowUp: [0, -PAN_STEP],
    ArrowDown: [0, PAN_STEP],
  };
  const move = pan[ev.key];
  if (move) view.value = panView(v, move[0], move[1]);
  else if (ev.key === "+" || ev.key === "=") view.value = zoomView(v, ZOOM_STEP, BOX / 2, BOX / 2);
  else if (ev.key === "-") view.value = zoomView(v, 1 / ZOOM_STEP, BOX / 2, BOX / 2);
  else return;
  ev.preventDefault();
}

function onSlider(ev: Event): void {
  if (!view.value) return;
  const target = Number((ev.target as HTMLInputElement).value);
  view.value = zoomView(view.value, target / zoom.value, BOX / 2, BOX / 2);
}

async function save(): Promise<void> {
  const el = img.value;
  const v = view.value;
  if (!el || !v || saving.value) return;
  saving.value = true;
  error.value = null;
  uploadAbort = new AbortController();
  try {
    const blob = await renderAvatar(el, v, props.limit);
    if (!blob) {
      error.value = t("avatar.tooLarge", { max: formatBytes(props.limit) });
      return;
    }
    await props.upload(blob, uploadAbort.signal);
    emit("close");
  } catch (err) {
    if (!uploadAbort.signal.aborted) error.value = err instanceof Error ? err.message : String(err);
  } finally {
    uploadAbort = null;
    saving.value = false;
  }
}

/** Cancel (or closing the dialog) stops an upload that is still on its way. */
function close(): void {
  uploadAbort?.abort();
  emit("close");
}

onMounted(() => {
  if (img.value?.complete) onLoad();
});
onBeforeUnmount(() => {
  uploadAbort?.abort();
  URL.revokeObjectURL(url);
});
</script>

<template>
  <AppDialog width="320px" :title="t('avatar.cropTitle')" @close="close">
    <div class="crop" data-testid="avatar-crop">
      <p v-if="failed" class="error" role="alert">{{ t("avatar.badImage") }}</p>
      <div
        v-else
        class="box"
        :style="{ width: `${BOX}px`, height: `${BOX}px` }"
        tabindex="0"
        role="application"
        :aria-label="t('avatar.cropArea')"
        data-testid="avatar-crop-box"
        @keydown="onKey"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @wheel.prevent="onWheel"
      >
        <img
          ref="img"
          :src="url"
          alt=""
          draggable="false"
          :style="imgStyle"
          @load="onLoad"
          @error="failed = true"
        />
      </div>
      <label v-if="!failed" class="zoom">
        <span>{{ t("avatar.zoom") }}</span>
        <input
          type="range"
          min="1"
          :max="MAX_ZOOM"
          step="0.01"
          :value="zoom"
          :disabled="!view"
          data-testid="avatar-zoom"
          @input="onSlider"
        />
      </label>
      <p class="hint">{{ t("avatar.cropHint") }}</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </div>
    <template #footer>
      <button type="button" data-testid="avatar-cancel" @click="close">
        {{ t("dialog.cancel") }}
      </button>
      <button
        type="button"
        class="primary"
        data-testid="avatar-save"
        :disabled="!view || saving"
        @click="save"
      >
        {{ saving ? t("avatar.saving") : t("avatar.save") }}
      </button>
    </template>
  </AppDialog>
</template>

<style scoped>
.crop {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.box {
  position: relative;
  overflow: hidden;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg);
  cursor: grab;
  touch-action: none;
  user-select: none;
  flex: none;
}
.box:active {
  cursor: grabbing;
}
.box img {
  position: absolute;
  left: 0;
  top: 0;
  max-width: none;
  transform-origin: 0 0;
  pointer-events: none;
}
.zoom {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  font-size: 12px;
}
.zoom input {
  flex: 1;
}
.hint {
  margin: 0;
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.5;
  text-align: center;
}
.error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}
</style>
