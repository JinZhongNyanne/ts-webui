<script setup lang="ts">
/**
 * The phone's counterpart of the desktop status bar: the in-call actions, and
 * a way into the same settings panel the desktop gear opens.
 */
import { computed } from "vue";
import { useTsStore } from "../stores/ts";
import { useRtcStore } from "../stores/rtc";
import { useI18n } from "../i18n";
import MobileSheet from "./MobileSheet.vue";
import { openClientDialog } from "../components/client/client-dialogs";
import { useClientMenus } from "../components/client/useClientMenus";
import { setAwayStatus } from "../ts/client-actions";
import { openSettings } from "../components/settings/settings-panel";
import { useFileBrowserStore } from "../stores/fileBrowser";

const emit = defineEmits<{ close: [] }>();
const ts = useTsStore();
const rtc = useRtcStore();
const fileBrowser = useFileBrowserStore();
const { t } = useI18n();

const me = computed(() => ts.selfClient);
const connected = computed(() => ts.connState === "connected");

const clientMenus = useClientMenus();

/** As on the desktop: away asks for a message, coming back is one tap. */
function toggleAway(): void {
  if (me.value?.away) clientMenus.run(setAwayStatus(false));
  else openClientDialog({ kind: "away" });
}

function disconnect(): void {
  ts.disconnect();
  emit("close");
}

function settings(): void {
  emit("close");
  openSettings();
}
</script>

<template>
  <MobileSheet :title="t('mobile.menuTitle')" @close="emit('close')">
    <div class="menu">
      <div class="row">
        <button :class="{ active: me?.away }" :disabled="!connected" @click="toggleAway">
          🌙 {{ t("status.awayShort") }}
        </button>
        <button :disabled="!connected" @click="openClientDialog({ kind: 'nickname' })">
          ✏️ {{ t("nick.title") }}
        </button>
        <button
          v-if="rtc.available"
          :class="{ on: rtc.screenOn }"
          :disabled="!connected || !ts.selfChannel || rtc.state === 'connecting'"
          @click="rtc.toggleScreen()"
        >
          🖥️
          {{ rtc.screenOn ? t("status.stopShareLabel") : t("status.shareScreenLabel") }}
        </button>
      </div>

      <button
        v-if="connected && ts.features.files"
        class="settings"
        data-testid="mobile-open-files"
        @click="fileBrowser.open()"
      >
        📁 {{ t("fb.title") }}
      </button>

      <button class="settings" data-testid="mobile-open-settings" @click="settings">
        ⚙️ {{ t("settings.title") }}
      </button>

      <button v-if="connected" class="disconnect" @click="disconnect">
        {{ t("status.disconnect") }}
      </button>
    </div>
  </MobileSheet>
</template>

<style scoped>
.menu {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 12px 20px;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.row button {
  flex: 1 1 30%;
  min-height: 44px;
}
.settings {
  min-height: 44px;
  text-align: left;
}
.disconnect {
  min-height: 44px;
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 50%, transparent);
}
button.active {
  border-color: var(--warn);
  color: var(--warn);
}
button.on {
  border-color: var(--ok);
  color: var(--ok);
}
</style>
