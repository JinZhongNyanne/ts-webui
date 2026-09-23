<script setup lang="ts">
/**
 * Input side of the audio settings popover: microphone device, input gain
 * with a live level meter, transmit mode (VAD threshold or PTT key), the
 * browser's echo cancellation / noise suppression / auto gain switches plus
 * optional RNNoise, and the auto-enable-after-connect toggle. Every control
 * binds straight to the matching `useVoiceStore` ref; the PTT key is the
 * hotkeys store's `ptt` binding, shared with the Hotkeys tab.
 */
import { computed } from "vue";
import { useVoiceStore } from "../../stores/voice";
import { useI18n } from "../../i18n";
import HotkeyRecorder from "./HotkeyRecorder.vue";

/** The store's volume refs are unity gain at 1 (shown as 100%). */
const DEFAULT_VOLUME = 1;
/** `voice.level` is linear RMS; x400 maps the usable speech range onto 0..100%. */
const LEVEL_TO_PERCENT = 400;

const voice = useVoiceStore();
const { t } = useI18n();

const levelPct = computed(() => Math.min(100, Math.round(voice.level * LEVEL_TO_PERCENT)));
const thresholdPct = computed(() => Math.min(100, Math.round(voice.threshold * LEVEL_TO_PERCENT)));
const micVolumePct = computed(() => Math.round(voice.micVolume * 100));

function resetMicVolume(): void {
  voice.micVolume = DEFAULT_VOLUME;
}

function stateWord(v: boolean | null): string {
  if (v === null) return t("voice.stateUnknown");
  return v ? t("voice.stateOn") : t("voice.stateOff");
}

/** Only shown with a live track: that is when the browser has actually decided. */
const appliedText = computed(() => {
  const a = voice.micApplied;
  if (!a) return null;
  return t("voice.processingApplied", {
    ec: stateWord(a.echoCancellation),
    ns: stateWord(a.noiseSuppression),
    agc: stateWord(a.autoGainControl),
  });
});
</script>

<template>
  <div class="panel">
    <label class="row">
      <span>{{ t("voice.inputDevice") }}</span>
      <select v-model="voice.inputDeviceId">
        <option value="">{{ t("voice.deviceDefault") }}</option>
        <option v-for="d in voice.inputDevices" :key="d.deviceId" :value="d.deviceId">
          {{ d.label || d.deviceId.slice(0, 8) }}
        </option>
      </select>
    </label>

    <div class="col-block">
      <div class="head">
        <span class="label"
          >{{ t("voice.inputVolume", { pct: micVolumePct }) }}
          <small>{{ t("voice.inputVolumeHint") }}</small></span
        >
        <button
          type="button"
          class="reset"
          :disabled="voice.micVolume === DEFAULT_VOLUME"
          @click="resetMicVolume"
        >
          {{ t("voice.resetVolume") }}
        </button>
      </div>
      <input v-model.number="voice.micVolume" type="range" min="0" max="2" step="0.05" />
      <div
        class="meter"
        role="meter"
        :aria-label="t('voice.levelMeter')"
        :aria-valuenow="levelPct"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div class="level" :style="{ width: `${levelPct}%` }"></div>
      </div>
    </div>

    <label class="row">
      <span>{{ t("voice.mode") }}</span>
      <select v-model="voice.mode">
        <option value="vad">{{ t("voice.modeVad") }}</option>
        <option value="ptt">{{ t("voice.modePtt") }}</option>
      </select>
    </label>

    <label v-if="voice.mode === 'vad'" class="col">
      <span
        >{{ t("voice.threshold") }}
        <small>{{ t("voice.currentLevel", { pct: levelPct }) }}</small></span
      >
      <div class="meter">
        <div class="level" :style="{ width: `${levelPct}%` }"></div>
        <div class="marker" :style="{ left: `${thresholdPct}%` }"></div>
      </div>
      <input v-model.number="voice.threshold" type="range" min="0.002" max="0.25" step="0.002" />
    </label>

    <div v-else class="row ptt">
      <span>{{ t("voice.pttKey") }}</span>
      <HotkeyRecorder action="ptt" />
    </div>

    <div class="group processing">
      <span class="label">{{ t("voice.processing") }}</span>
      <label class="row check">
        <input v-model="voice.echoCancellation" type="checkbox" />
        <span>{{ t("voice.echoCancellation") }}</span>
      </label>
      <label class="row check">
        <input v-model="voice.noiseSuppression" type="checkbox" />
        <span>{{ t("voice.noiseSuppression") }}</span>
      </label>
      <label class="row check">
        <input v-model="voice.autoGainControl" type="checkbox" />
        <span>{{ t("voice.autoGainControl") }}</span>
      </label>
      <label class="row check" :title="t('voice.rnnoiseHint')">
        <input v-model="voice.rnnoise" type="checkbox" />
        <span>{{ t("voice.rnnoise") }}</span>
      </label>
      <small class="hint">{{ t("voice.processingMusicHint") }}</small>
      <small v-if="appliedText" class="hint applied">{{ appliedText }}</small>
    </div>

    <label class="row check">
      <input v-model="voice.autoMic" type="checkbox" />
      <span>{{ t("voice.autoMic") }}</span>
    </label>
  </div>
</template>

<style scoped src="./settings-panel.css"></style>
<style scoped>
.ptt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--text-dim);
}
.processing {
  gap: 4px;
}
.hint {
  font-size: 11px;
  color: var(--text-dim);
}
</style>
