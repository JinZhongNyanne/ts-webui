<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useTtsStore } from "../../stores/tts";
import { useI18n } from "../../i18n";

const tts = useTtsStore();
const { t } = useI18n();

onMounted(() => void tts.loadEdgeVoices());

const zhEdge = computed(() => tts.edgeVoices.filter((v) => v.locale.startsWith("zh")));
const otherEdge = computed(() => tts.edgeVoices.filter((v) => !v.locale.startsWith("zh")));
</script>

<template>
  <div class="pane">
    <label class="switch">
      <input v-model="tts.enabled" type="checkbox" />
      <span>{{ tts.enabled ? t("tts.switchOn") : t("tts.switchOff") }}</span>
    </label>
    <p v-if="tts.error" class="error">{{ tts.error }}</p>

    <label class="row">
      <span>{{ t("tts.engine") }}</span>
      <select v-model="tts.provider">
        <option value="edge">{{ t("tts.engineEdge") }}</option>
        <option value="browser" :disabled="!tts.browserSupported">
          {{ t("tts.engineBrowser") }}
        </option>
      </select>
    </label>

    <label v-if="tts.provider === 'edge'" class="row">
      <span>{{ t("tts.voice") }}</span>
      <select v-model="tts.edgeVoice">
        <optgroup :label="t('tts.chinese')">
          <option v-for="v in zhEdge" :key="v.name" :value="v.name">
            {{ v.friendly }} ({{ v.gender === "Female" ? t("tts.female") : t("tts.male") }})
          </option>
        </optgroup>
        <optgroup :label="t('tts.otherLanguages')">
          <option v-for="v in otherEdge" :key="v.name" :value="v.name">
            {{ v.friendly }} · {{ v.locale }}
          </option>
        </optgroup>
      </select>
    </label>
    <label v-else class="row">
      <span>{{ t("tts.voice") }}</span>
      <select v-model="tts.browserVoice">
        <option value="">{{ t("tts.voiceAuto") }}</option>
        <option v-for="v in tts.browserVoices" :key="v.name" :value="v.name">
          {{ v.name }} · {{ v.lang }}
        </option>
      </select>
    </label>

    <label class="col">
      <span>{{ t("tts.volume", { pct: Math.round(tts.volume * 100) }) }}</span>
      <input v-model.number="tts.volume" type="range" min="0" max="1" step="0.05" />
    </label>
    <label class="col">
      <span>{{ t("tts.rate", { rate: tts.rate.toFixed(2) }) }}</span>
      <input v-model.number="tts.rate" type="range" min="0.5" max="2" step="0.05" />
    </label>

    <div class="group">
      <div class="label">{{ t("tts.readWhat") }}</div>
      <label class="chk"
        ><input v-model="tts.readChannelChat" type="checkbox" /> {{ t("tree.channelChat") }}</label
      >
      <label class="chk"
        ><input v-model="tts.readPrivateChat" type="checkbox" /> {{ t("tree.privateChat") }}</label
      >
      <label class="chk"
        ><input v-model="tts.readServerChat" type="checkbox" /> {{ t("tree.serverChat") }}</label
      >
      <label class="chk"
        ><input v-model="tts.readPokes" type="checkbox" /> {{ t("tree.poke") }}</label
      >
      <label class="chk"
        ><input v-model="tts.readJoinLeave" type="checkbox" /> {{ t("tts.joinLeave") }}</label
      >
      <label class="chk"
        ><input v-model="tts.readOwnMessages" type="checkbox" /> {{ t("tts.ownMessages") }}</label
      >
      <label class="chk"
        ><input v-model="tts.speakSenderName" type="checkbox" /> {{ t("tts.speakSender") }}</label
      >
    </div>

    <div class="row actions">
      <button @click="tts.test()">▶ {{ t("tts.test") }}</button>
      <button @click="tts.stop()">⏹ {{ t("tts.stop") }}</button>
    </div>
  </div>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--text-dim);
}
.row select {
  width: 200px;
}
.switch {
  display: flex;
  font-size: 12px;
  align-items: center;
  gap: 6px;
}
.switch input {
  width: auto;
}
.col {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-dim);
}
.group {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 10px;
  font-size: 12px;
}
.group .label {
  grid-column: 1 / -1;
  color: var(--text-dim);
}
.chk {
  display: flex;
  align-items: center;
  gap: 6px;
}
.chk input {
  width: auto;
}
.actions {
  justify-content: flex-start;
}
.error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}
input[type="range"] {
  width: 100%;
  padding: 0;
  border: none;
  background: transparent;
}
</style>
