<script setup lang="ts">
/**
 * Output side of the audio settings popover: playback device, master volume
 * with the peak/limiter readout and a peak meter, auto-level, and hearing
 * protection. Every control binds straight to the matching `useVoiceStore` ref.
 */
import { computed } from "vue";
import { useVoiceStore } from "../../stores/voice";
import { useI18n } from "../../i18n";

/** The store's volume refs are unity gain at 1 (shown as 100%). */
const DEFAULT_VOLUME = 1;
/** Peak meter range: -60 dB reads as empty, 0 dBFS as full. */
const PEAK_FLOOR_DB = -60;
const PEAK_CEIL_DB = 0;
/** The store parks `peakDb` at -180 until the engine has produced any output. */
const PEAK_SILENT_DB = -180;
/** Below this much gain reduction the limiter is not doing anything worth showing. */
const REDUCTION_VISIBLE_DB = -0.5;

const voice = useVoiceStore();
const { t } = useI18n();

const masterPct = computed(() => Math.round(voice.master * 100));
const hasPeak = computed(() => voice.masterMeter.peakDb > PEAK_SILENT_DB);

/** `masterMeter.peakDb` mapped from -60..0 dB onto 0..100%, clamped at both ends. */
const peakPct = computed(() => {
  if (!hasPeak.value) return 0;
  const span = PEAK_CEIL_DB - PEAK_FLOOR_DB;
  const ratio = (voice.masterMeter.peakDb - PEAK_FLOOR_DB) / span;
  return Math.min(100, Math.max(0, Math.round(ratio * 100)));
});

/** Output peak, plus how much the hearing-protection limiter is pulling it down. */
const peakText = computed(() => {
  const reducing = voice.earProtect && voice.masterMeter.reductionDb < REDUCTION_VISIBLE_DB;
  return t("voice.outputPeak", {
    db: voice.masterMeter.peakDb,
    reduction: reducing
      ? t("voice.outputReduction", { db: Math.abs(voice.masterMeter.reductionDb).toFixed(1) })
      : "",
  });
});

function resetMaster(): void {
  voice.master = DEFAULT_VOLUME;
}
</script>

<template>
  <div class="panel">
    <label class="row">
      <span>{{ t("voice.outputDevice") }}</span>
      <select v-model="voice.outputDeviceId">
        <option value="">{{ t("voice.deviceDefault") }}</option>
        <option v-for="d in voice.outputDevices" :key="d.deviceId" :value="d.deviceId">
          {{ d.label || d.deviceId.slice(0, 8) }}
        </option>
      </select>
    </label>

    <div class="col-block">
      <div class="head">
        <span class="label"
          >{{ t("voice.outputVolume", { pct: masterPct }) }}
          <small v-if="hasPeak">{{ peakText }}</small></span
        >
        <button
          type="button"
          class="reset"
          :disabled="voice.master === DEFAULT_VOLUME"
          @click="resetMaster"
        >
          {{ t("voice.resetVolume") }}
        </button>
      </div>
      <input v-model.number="voice.master" type="range" min="0" max="2" step="0.05" />
      <div
        class="meter"
        role="meter"
        :aria-label="t('voice.peakMeter')"
        :aria-valuenow="peakPct"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div class="level" :style="{ width: `${peakPct}%` }"></div>
      </div>
    </div>

    <div class="group">
      <label class="row check">
        <input v-model="voice.autoLevel" type="checkbox" />
        <span>{{ t("voice.autoLevel") }}</span>
      </label>
      <label v-if="voice.autoLevel" class="col sub">
        <span>{{ t("voice.autoLevelTarget", { db: voice.autoLevelTargetDb }) }}</span>
        <input v-model.number="voice.autoLevelTargetDb" type="range" min="-30" max="-8" step="1" />
      </label>
    </div>

    <div class="group">
      <label class="row check">
        <input v-model="voice.earProtect" type="checkbox" />
        <span>{{ t("voice.earProtect") }}</span>
      </label>
      <label v-if="voice.earProtect" class="col sub">
        <span>{{ t("voice.earProtectThreshold", { db: voice.earProtectDb }) }}</span>
        <input v-model.number="voice.earProtectDb" type="range" min="-20" max="-1" step="1" />
      </label>
    </div>
  </div>
</template>

<style scoped src="./settings-panel.css"></style>
