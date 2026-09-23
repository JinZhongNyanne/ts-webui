<script setup lang="ts">
/**
 * Dock panel for the soundboard: every clip on this hub, shared by everyone,
 * as a grid of tiles (see SoundTile). A click plays a clip into the channel
 * through the voice engine; "stop all" stops what this user started. Clips
 * are uploaded with the button or by dropping a file anywhere on the panel.
 */
import { computed, ref } from "vue";
import {
  MAX_SOUND_NAME_LENGTH,
  MAX_SOUND_SECONDS,
  MAX_SOUNDS,
  SOUND_EXTENSIONS,
} from "@jinz/protocol";
import { useSoundboardStore } from "../stores/soundboard";
import { useTsStore } from "../stores/ts";
import { useI18n, type MessageKey } from "../i18n";
import type { UploadError } from "../soundboard/rules";
import SoundTile from "./soundboard/SoundTile.vue";

const store = useSoundboardStore();
const ts = useTsStore();
const { t } = useI18n();

const name = ref("");
const busy = ref(false);
const dragDepth = ref(0);
const uploadError = ref<UploadError | null>(null);
const saveFailed = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const ACCEPT = Object.values(SOUND_EXTENSIONS)
  .map((ext) => `.${ext}`)
  .join(",");

const UPLOAD_ERRORS: Record<UploadError, MessageKey> = {
  full: "sound.errFull",
  empty: "sound.errEmpty",
  tooBig: "sound.errTooBig",
  type: "sound.errType",
  tooLong: "sound.errTooLong",
  decode: "sound.errDecode",
  name: "sound.errName",
  failed: "sound.errFailed",
};

const muted = computed(() => ts.selfClient?.inputMuted ?? false);

/** One line saying why the last click did nothing, if it did nothing. */
const playNotice = computed(() => {
  const n = store.notice;
  if (!n) return null;
  switch (n.kind) {
    case "notConnected":
      return t("sound.blockNotConnected");
    case "muted":
      // Shown permanently below while muted.
      return muted.value ? null : t("sound.blockMuted");
    case "noTalkPower":
      return t("sound.blockNoTalkPower");
    case "codec":
      return t("sound.blockCodec");
    case "failed":
      return t("sound.playFailed", { reason: n.detail });
  }
  return null;
});

async function send(file: File | undefined): Promise<void> {
  if (!file || busy.value) return;
  busy.value = true;
  uploadError.value = await store.upload(file, name.value);
  busy.value = false;
  if (!uploadError.value) name.value = "";
}

function onPick(ev: Event): void {
  const input = ev.target as HTMLInputElement;
  void send(input.files?.[0]);
  input.value = ""; // picking the same file again should upload again
}

function hasFiles(ev: DragEvent): boolean {
  return ev.dataTransfer?.types.includes("Files") ?? false;
}

function onDragEnter(ev: DragEvent): void {
  if (hasFiles(ev)) dragDepth.value++;
}

function onDragLeave(ev: DragEvent): void {
  if (hasFiles(ev)) dragDepth.value = Math.max(0, dragDepth.value - 1);
}

function onDrop(ev: DragEvent): void {
  dragDepth.value = 0;
  void send(ev.dataTransfer?.files[0]);
}
</script>

<template>
  <div
    class="soundboard"
    :class="{ dropping: dragDepth > 0 }"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <div class="bar">
      <span class="count">{{ t("sound.count", { n: store.sounds.length, max: MAX_SOUNDS }) }}</span>
      <button
        type="button"
        class="stop"
        :disabled="!store.anyPlaying"
        data-testid="sound-stop-all"
        @click="store.stopAll()"
      >
        ■ {{ t("sound.stopAll") }}
      </button>
    </div>

    <p v-if="muted" class="notice warn" data-testid="sound-muted">{{ t("sound.blockMuted") }}</p>
    <p v-if="playNotice" class="notice warn" data-testid="sound-notice">{{ playNotice }}</p>
    <p v-if="saveFailed" class="notice error">{{ t("sound.saveFailed") }}</p>

    <div class="grid">
      <SoundTile
        v-for="sound in store.sounds"
        :key="sound.id"
        :sound="sound"
        @failed="saveFailed = true"
      />
    </div>
    <p v-if="store.loaded && !store.sounds.length" class="empty">{{ t("sound.empty") }}</p>

    <form class="upload" @submit.prevent="fileInput?.click()">
      <p class="hint">{{ t("sound.intro") }}</p>
      <div class="upload-row">
        <input
          v-model="name"
          type="text"
          :maxlength="MAX_SOUND_NAME_LENGTH"
          :placeholder="t('sound.name')"
          :aria-label="t('sound.name')"
          data-testid="sound-upload-name"
        />
        <button type="submit" class="primary" :disabled="busy" data-testid="sound-upload">
          {{ busy ? t("sound.uploading") : t("sound.upload") }}
        </button>
        <input
          ref="fileInput"
          class="file"
          type="file"
          :accept="ACCEPT + ',audio/*'"
          data-testid="sound-upload-file"
          @change="onPick"
        />
      </div>
      <p v-if="uploadError" class="notice error" data-testid="sound-upload-error">
        {{
          t(UPLOAD_ERRORS[uploadError], { seconds: MAX_SOUND_SECONDS, max: MAX_SOUND_NAME_LENGTH })
        }}
      </p>
      <p class="hint">{{ t("sound.uploadHint", { seconds: MAX_SOUND_SECONDS }) }}</p>
    </form>

    <div v-if="dragDepth > 0" class="drop-hint" aria-hidden="true">{{ t("sound.dropHere") }}</div>
  </div>
</template>

<style scoped>
.soundboard {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  overflow-y: auto;
  min-height: 0;
}
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.count {
  font-size: 11px;
  color: var(--text-dim);
}
.stop {
  margin-left: auto;
  font-size: 12px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 6px;
}
.upload {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.upload-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.upload-row input[type="text"] {
  flex: 1 1 160px;
  min-width: 0;
}
.file {
  display: none;
}
.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}
.hint,
.empty,
.notice {
  margin: 0;
  font-size: 11px;
  color: var(--text-dim);
}
.notice.warn {
  color: var(--warn);
}
.notice.error {
  color: var(--danger);
}
.drop-hint {
  position: absolute;
  inset: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed var(--accent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg) 85%, transparent);
  font-size: 14px;
  pointer-events: none;
}
</style>
