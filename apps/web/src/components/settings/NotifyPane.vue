<script setup lang="ts">
/**
 * Settings pane for the sound pack and desktop notifications: the two
 * master switches, the cue volume, the browser permission state, and one row
 * per event with its sound / popup switches, a preview and a custom-sound slot.
 */
import { computed, onMounted, ref } from "vue";
import { useNotifyStore } from "../../stores/notify";
import { useI18n, type MessageKey } from "../../i18n";
import { CUE_GROUPS, CUE_META, eventsInGroup, type CueEvent } from "../../notify/events";
import { CUSTOM_SOUND_MAX_BYTES } from "../../notify/customSounds";

const notify = useNotifyStore();
const { t } = useI18n();
const fileInput = ref<HTMLInputElement | null>(null);
/** The event a file picker was opened for. */
const uploadFor = ref<CueEvent | null>(null);

// The user may have changed it in the browser since this pane was last shown.
onMounted(() => notify.refreshPermission());

const volumePct = computed(() => Math.round(notify.volume * 100));

const permissionText = computed(() => {
  switch (notify.permission) {
    case "granted":
      return t("notify.permissionGranted");
    case "denied":
      return t("notify.permissionDenied");
    case "unsupported":
      return t("notify.permissionUnsupported");
    default:
      return t("notify.permissionDefault");
  }
});

const errorText = computed(() => {
  switch (notify.error) {
    case "too-large":
      return t("notify.errTooLarge", { kb: CUSTOM_SOUND_MAX_BYTES / 1024 });
    case "bad-type":
      return t("notify.errBadType");
    case "decode":
      return t("notify.errDecode");
    case "storage":
      return t("notify.errStorage");
    default:
      return null;
  }
});

function groupLabel(group: string): string {
  return t(`notify.group.${group}` as MessageKey);
}

function pick(event: CueEvent): void {
  uploadFor.value = event;
  fileInput.value?.click();
}

async function onFile(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || !uploadFor.value) return;
  await notify.setCustomSound(uploadFor.value, file);
}

function onNotificationsToggle(ev: Event): void {
  void notify.setNotifications((ev.target as HTMLInputElement).checked);
}
</script>

<template>
  <div class="pane">
    <label class="row switch">
      <input v-model="notify.sounds" type="checkbox" />
      <span>{{ t("notify.sounds") }}</span>
    </label>
    <label class="col">
      <span>{{ t("notify.volume", { pct: volumePct }) }}</span>
      <input v-model.number="notify.volume" type="range" min="0" max="1" step="0.05" />
    </label>

    <label class="row switch">
      <input
        :checked="notify.notifications"
        type="checkbox"
        :disabled="notify.permission === 'unsupported'"
        @change="onNotificationsToggle"
      />
      <span>{{ t("notify.notifications") }}</span>
    </label>
    <p class="hint" :class="{ warn: notify.permission === 'denied' }">
      {{ permissionText }}
      <button
        v-if="notify.permission === 'default'"
        type="button"
        class="small"
        @click="notify.requestPermission()"
      >
        {{ t("notify.permissionAsk") }}
      </button>
    </p>
    <p class="hint">{{ t("notify.backgroundOnly") }}</p>
    <p v-if="errorText" class="error">{{ errorText }}</p>

    <table class="events">
      <thead>
        <tr>
          <th>{{ t("notify.colEvent") }}</th>
          <th>{{ t("notify.colSound") }}</th>
          <th>{{ t("notify.colPopup") }}</th>
          <th></th>
        </tr>
      </thead>
      <tbody v-for="group in CUE_GROUPS" :key="group">
        <tr class="group">
          <td colspan="4">{{ groupLabel(group) }}</td>
        </tr>
        <tr v-for="ev in eventsInGroup(group)" :key="ev" :data-event="ev">
          <td class="name">
            {{ notify.label(ev) }}
            <small v-if="notify.customSounds.has(ev)" class="custom">{{
              t("notify.customSound", { name: notify.customSounds.get(ev) ?? "" })
            }}</small>
          </td>
          <td>
            <input
              v-model="notify.events[ev].sound"
              type="checkbox"
              :aria-label="`${notify.label(ev)} · ${t('notify.colSound')}`"
            />
          </td>
          <td>
            <input
              v-if="CUE_META[ev].notifiable"
              v-model="notify.events[ev].notify"
              type="checkbox"
              :aria-label="`${notify.label(ev)} · ${t('notify.colPopup')}`"
            />
          </td>
          <td class="actions">
            <button
              type="button"
              class="icon"
              :title="t('notify.preview')"
              @click="notify.preview(ev)"
            >
              ▶
            </button>
            <button type="button" class="icon" :title="t('notify.upload')" @click="pick(ev)">
              📁
            </button>
            <button
              v-if="notify.customSounds.has(ev)"
              type="button"
              class="icon"
              :title="t('notify.resetSound')"
              @click="notify.clearCustomSound(ev)"
            >
              ↺
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p class="hint">{{ t("notify.ttsHint") }}</p>
    <input ref="fileInput" type="file" accept="audio/*" hidden @change="onFile" />
  </div>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
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
.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-dim);
}
.hint.warn,
.error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}
.small {
  margin-left: 6px;
  padding: 2px 8px;
  font-size: 11px;
}
.events {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.events th {
  text-align: left;
  font-weight: normal;
  color: var(--text-dim);
  padding: 2px 4px;
}
.events td {
  padding: 2px 4px;
  vertical-align: middle;
}
.events input {
  width: auto;
}
.group td {
  padding-top: 8px;
  color: var(--accent);
  font-size: 11px;
}
.name small {
  display: block;
  color: var(--text-dim);
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
}
.actions {
  white-space: nowrap;
  text-align: right;
}
.icon {
  padding: 1px 5px;
  font-size: 11px;
}
input[type="range"] {
  width: 100%;
  padding: 0;
  border: none;
  background: transparent;
}
</style>
