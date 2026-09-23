<script setup lang="ts">
import { computed, ref } from "vue";
import { ASSET_LIMITS, useProfilesStore, type ProfileAsset } from "../../stores/profiles";
import { useTsStore } from "../../stores/ts";
import { useI18n } from "../../i18n";
import AvatarSection from "./AvatarSection.vue";

const ts = useTsStore();
const profiles = useProfilesStore();
const { t } = useI18n();
const iconInput = ref<HTMLInputElement | null>(null);
const soundInput = ref<HTMLInputElement | null>(null);

const myIcon = computed(() => profiles.ownUrl("icon"));
const mySound = computed(() => profiles.ownUrl("sound"));
/** Picked while offline: shown locally, uploaded for everyone on connect. */
const waiting = computed(() => profiles.pending && ts.connState !== "connected");
const errorText = computed(() => {
  switch (profiles.error) {
    case "too-large":
      return t("profile.errorTooLarge");
    case "bad-type":
      return t("profile.errorBadType");
    case null:
    case undefined:
      return "";
    default:
      return t("profile.errorFailed");
  }
});

async function pick(asset: ProfileAsset, ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ""; // allow re-picking the same file after a failure
  if (file) await profiles.upload(asset, file);
}

function previewSound(): void {
  profiles.playOwnSound();
}
</script>

<template>
  <div class="pane">
    <p v-if="waiting" class="hint pending">{{ t("profile.pendingUpload") }}</p>
    <p v-if="errorText" class="error">{{ errorText }}</p>

    <AvatarSection />

    <section>
      <div class="label">{{ t("profile.icon") }}</div>
      <div class="row">
        <div class="preview">
          <img v-if="myIcon" :src="myIcon" alt="" />
          <span v-else class="none">{{ t("profile.none") }}</span>
        </div>
        <div class="actions">
          <button :disabled="profiles.busy" @click="iconInput?.click()">
            {{ myIcon ? t("profile.replace") : t("profile.choose") }}
          </button>
          <button v-if="myIcon" :disabled="profiles.busy" @click="profiles.remove('icon')">
            {{ t("profile.remove") }}
          </button>
        </div>
      </div>
      <p class="hint">{{ t("profile.iconHint") }}</p>
      <input
        ref="iconInput"
        type="file"
        class="file"
        :accept="ASSET_LIMITS.icon.accept"
        @change="pick('icon', $event)"
      />
    </section>

    <section>
      <div class="label">{{ t("profile.sound") }}</div>
      <div class="row">
        <div class="actions">
          <button :disabled="profiles.busy" @click="soundInput?.click()">
            {{ mySound ? t("profile.replace") : t("profile.choose") }}
          </button>
          <button v-if="mySound" :disabled="profiles.busy" @click="previewSound">
            {{ t("profile.preview") }}
          </button>
          <button v-if="mySound" :disabled="profiles.busy" @click="profiles.remove('sound')">
            {{ t("profile.remove") }}
          </button>
        </div>
        <span v-if="!mySound" class="none">{{ t("profile.none") }}</span>
      </div>
      <p class="hint">{{ t("profile.soundHint") }}</p>
      <input
        ref="soundInput"
        type="file"
        class="file"
        :accept="ASSET_LIMITS.sound.accept"
        @change="pick('sound', $event)"
      />
    </section>
  </div>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.label {
  font-size: 12px;
  font-weight: 600;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.preview {
  width: 48px;
  height: 48px;
  border: 1px solid var(--border);
  border-radius: 8px;
  display: grid;
  place-items: center;
  overflow: hidden;
  flex: none;
}
.preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.none {
  color: var(--text-dim);
  font-size: 11px;
}
.pending {
  color: var(--warn);
}
.hint {
  margin: 0;
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.5;
}
.error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}
.file {
  display: none;
}
</style>
