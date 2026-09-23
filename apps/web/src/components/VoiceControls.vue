<script setup lang="ts">
/**
 * Voice toolbar: the mic button, and the whisper pill while whispering. Its
 * settings (device, transmit mode, playback, hotkeys, whisper list) live in
 * the settings panel, behind the status-bar gear.
 *
 * Without talk power in this channel the button says so instead of offering
 * a "talking" state that the server would silently throw away.
 */
import { computed } from "vue";
import { useVoiceStore } from "../stores/voice";
import { useVoice } from "../audio/useVoice";
import { useI18n } from "../i18n";
import WhisperPill from "./whisper/WhisperPill.vue";

const voice = useVoiceStore();
const v = useVoice();
const { t } = useI18n();

/** Every label the button can show; all are laid out so its width never changes. */
const labels = computed(() => [
  `🔈 ${t("voice.start")}`,
  `🎤 ${t("voice.micOff")}`,
  `🎤 ${t("voice.micOn")}`,
  `🎤 ${t("voice.talking")}`,
  `🚫 ${t("voice.noTalkPower")}`,
]);

/** Mic on, but this channel would not let us be heard (roadmap D1). */
const silenced = computed(() => voice.micEnabled && !voice.canTalk && !voice.transmitting);

const micLabel = computed(() => {
  if (!voice.engineReady) return labels.value[0];
  if (!voice.micEnabled) return labels.value[1];
  if (voice.transmitting) return labels.value[3];
  return silenced.value ? labels.value[4] : labels.value[2];
});

const micTitle = computed(() => {
  if (!voice.codecSupported) return t("voice.codecUnsupported");
  return silenced.value ? t("talk.needed") : t("voice.toggleMic");
});

async function onMicClick(): Promise<void> {
  if (!voice.engineReady) {
    await v.start();
    if (voice.autoMic) await v.enableMic();
    return;
  }
  await v.toggleMic();
}
</script>

<template>
  <button
    class="mic"
    :class="{
      on: voice.micEnabled,
      tx: voice.transmitting,
      warn: !voice.codecSupported,
      silenced,
    }"
    :title="micTitle"
    data-testid="voice-mic"
    :data-can-talk="voice.canTalk"
    @click="onMicClick"
  >
    <!-- Stacked in one grid cell: the widest label sizes the button, so starting to
         talk does not nudge the centred controls sideways. -->
    <span class="labels">
      <span v-for="label in labels" :key="label" :class="{ shown: label === micLabel }">{{
        label
      }}</span>
    </span>
  </button>
  <WhisperPill />
</template>

<style scoped>
.labels {
  display: inline-grid;
}
.labels > span {
  grid-area: 1 / 1;
  visibility: hidden;
  text-align: center;
}
.labels > .shown {
  visibility: visible;
}
.mic.on {
  border-color: var(--ok);
}
.mic.tx {
  background: rgba(61, 220, 132, 0.18);
  color: var(--ok);
}
.mic.warn {
  border-color: var(--warn);
}
.mic.silenced {
  border-color: var(--danger);
  color: var(--text-dim);
}
</style>
