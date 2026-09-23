<script setup lang="ts">
/**
 * One clip on the soundboard. The big button plays it into the channel; the
 * row below previews it for this user only, renames it inline, deletes it for
 * everyone, or opens the clip's shared volume (see SoundVolumePopover — the
 * volume is not inline because the tile is itself a play button and a drag
 * target). The tile keeps no copy of the volume: the sound the store holds is
 * the one truth, so nothing here can drift out of step with everyone else.
 */
import { computed, nextTick, ref } from "vue";
import { MAX_SOUND_NAME_LENGTH, type SharedSound } from "@jinz/protocol";
import { useSoundboardStore } from "../../stores/soundboard";
import { useI18n } from "../../i18n";
import { confirmDialog } from "../ui/confirm";
import SoundVolumePopover from "./SoundVolumePopover.vue";

const props = defineProps<{ sound: SharedSound }>();
const emit = defineEmits<{ failed: [] }>();
const store = useSoundboardStore();
const { t } = useI18n();

const playing = computed(() => (store.playing[props.sound.id] ?? 0) > 0);
const tooltip = computed(() =>
  props.sound.addedBy
    ? `${t("sound.play", { name: props.sound.name })}\n${t("sound.addedBy", { name: props.sound.addedBy })}`
    : t("sound.play", { name: props.sound.name }),
);

const editing = ref(false);
const draftName = ref("");
const nameInput = ref<HTMLInputElement | null>(null);

async function startRename(): Promise<void> {
  draftName.value = props.sound.name;
  editing.value = true;
  await nextTick();
  nameInput.value?.select();
}

async function commitRename(): Promise<void> {
  if (!editing.value) return;
  editing.value = false;
  const name = draftName.value.trim();
  if (!name || name === props.sound.name) return;
  if (!(await store.rename(props.sound.id, name))) emit("failed");
}

/** Saves a new shared volume; the popover shows the shared one again either way. */
async function saveVolume(value: number): Promise<boolean> {
  const ok = await store.setVolume(props.sound.id, value);
  if (!ok) emit("failed");
  return ok;
}

async function removeForEveryone(): Promise<void> {
  const ok = await confirmDialog({
    title: t("sound.deleteConfirm", { name: props.sound.name }),
    message: t("sound.deleteConfirmHint"),
    confirmLabel: t("dialog.delete"),
    danger: true,
  });
  if (ok && !(await store.remove(props.sound.id))) emit("failed");
}
</script>

<template>
  <div class="tile" :class="{ playing }" data-testid="sound-tile">
    <input
      v-if="editing"
      ref="nameInput"
      v-model="draftName"
      class="name-input"
      type="text"
      :maxlength="MAX_SOUND_NAME_LENGTH"
      :aria-label="t('sound.rename')"
      data-testid="sound-rename-input"
      @keydown.enter.prevent="commitRename"
      @keydown.esc.prevent="editing = false"
      @blur="commitRename"
    />
    <button
      v-else
      type="button"
      class="play"
      :title="tooltip"
      :aria-label="t('sound.play', { name: sound.name })"
      data-testid="sound-play"
      @click="store.play(sound)"
    >
      <span class="indicator" aria-hidden="true">{{ playing ? "🔊" : "▶" }}</span>
      <span class="name" data-testid="sound-name">{{ sound.name }}</span>
      <span v-if="playing" class="sr-only">{{ t("sound.playing") }}</span>
    </button>
    <div class="row">
      <button
        type="button"
        class="icon"
        :title="t('sound.preview')"
        :aria-label="t('sound.preview')"
        data-testid="sound-preview"
        @click="store.preview(sound)"
      >
        🎧
      </button>
      <SoundVolumePopover :name="sound.name" :volume="sound.volume" :commit="saveVolume" />
      <button
        type="button"
        class="icon"
        :title="t('sound.rename')"
        :aria-label="t('sound.rename')"
        data-testid="sound-rename"
        @click="startRename"
      >
        ✎
      </button>
      <button
        type="button"
        class="icon danger"
        :title="t('sound.delete')"
        :aria-label="t('sound.delete')"
        data-testid="sound-delete"
        @click="removeForEveryone"
      >
        🗑
      </button>
    </div>
  </div>
</template>

<style scoped>
.tile {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
  min-width: 0;
}
.tile.playing {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent) inset;
}
.play {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 40px;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--bg-elev-2);
  text-align: left;
  font-size: 13px;
  color: var(--text);
}
.play:hover {
  border-color: var(--accent);
}
.indicator {
  flex: none;
  width: 1.2em;
  text-align: center;
  color: var(--text-dim);
}
.tile.playing .indicator {
  animation: pulse 0.8s ease-in-out infinite alternate;
}
@keyframes pulse {
  from {
    opacity: 0.4;
  }
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.name-input {
  min-height: 40px;
  font-size: 13px;
}
.row {
  display: flex;
  align-items: center;
  gap: 2px;
}
.icon {
  flex: none;
  padding: 2px 5px;
  border: none;
  background: transparent;
  font-size: 12px;
  color: var(--text-dim);
}
.icon:hover {
  color: var(--text);
}
.icon.danger:hover {
  color: var(--danger);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
@media (prefers-reduced-motion: reduce) {
  .tile.playing .indicator {
    animation: none;
  }
}
</style>
