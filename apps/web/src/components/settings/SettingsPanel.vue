<script setup lang="ts">
/**
 * The settings dialog: a tab list and the chosen pane.
 *
 * On the desktop the tabs are a column beside the pane; on a phone
 * `AppDialog` turns into a bottom sheet and the tabs become a scrolling row
 * above it. Only the shown pane is mounted, so a pane that fetches something
 * (the TTS voice list) or checks something (notification permission) does it
 * when opened.
 */
import { computed } from "vue";
import { useI18n } from "../../i18n";
import { useViewport } from "../../mobile/useViewport";
import { useVoiceStore } from "../../stores/voice";
import AppDialog from "../ui/AppDialog.vue";
import MicSettings from "../voice/MicSettings.vue";
import PlaybackSettings from "../voice/PlaybackSettings.vue";
import HotkeySettings from "../voice/HotkeySettings.vue";
import WhisperPane from "../whisper/WhisperPane.vue";
import ProfilePane from "./ProfilePane.vue";
import TtsPane from "./TtsPane.vue";
import ChatPane from "./ChatPane.vue";
import NotifyPane from "./NotifyPane.vue";
import ThemePane from "./ThemePane.vue";
import LanguagePane from "./LanguagePane.vue";
import AdvancedPane from "./AdvancedPane.vue";
import {
  closeSettings,
  resolveSettingsTab,
  settingsTab,
  settingsTabs,
  type SettingsTab,
} from "./settings-panel";

const { t } = useI18n();
const { isMobile } = useViewport();
const voice = useVoiceStore();

const tabs = computed(() => settingsTabs(isMobile.value));
const active = computed(() => resolveSettingsTab(settingsTab.value, isMobile.value));
const activeInfo = computed(() => tabs.value.find((tab) => tab.id === active.value)!);
const isVoiceTab = computed(() => active.value === "mic" || active.value === "playback");

function select(tab: SettingsTab): void {
  settingsTab.value = tab;
}
</script>

<template>
  <AppDialog :title="t('settings.title')" width="780px" @close="closeSettings">
    <div class="layout" :class="{ mobile: isMobile }">
      <nav class="tabs" role="tablist" :aria-orientation="isMobile ? 'horizontal' : 'vertical'">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          role="tab"
          class="tab"
          :class="{ active: tab.id === active }"
          :aria-selected="tab.id === active"
          :data-testid="`settings-tab-${tab.id}`"
          @click="select(tab.id)"
        >
          <span class="icon" aria-hidden="true">{{ tab.icon }}</span>
          <span class="label">{{ t(tab.label) }}</span>
        </button>
      </nav>

      <section class="content" role="tabpanel" :aria-label="t(activeInfo.label)">
        <h4 v-if="!isMobile">{{ t(activeInfo.label) }}</h4>
        <template v-if="isVoiceTab">
          <p v-if="voice.error" class="error">{{ voice.error }}</p>
          <p v-if="voice.canEncode === false" class="error">{{ t("voice.noEncoder") }}</p>
        </template>
        <ProfilePane v-if="active === 'profile'" />
        <MicSettings v-else-if="active === 'mic'" />
        <PlaybackSettings v-else-if="active === 'playback'" />
        <HotkeySettings v-else-if="active === 'hotkeys'" />
        <WhisperPane v-else-if="active === 'whisper'" />
        <TtsPane v-else-if="active === 'tts'" />
        <ChatPane v-else-if="active === 'chat'" />
        <NotifyPane v-else-if="active === 'notify'" />
        <ThemePane v-else-if="active === 'theme'" />
        <LanguagePane v-else-if="active === 'language'" />
        <AdvancedPane v-else />
      </section>
    </div>
  </AppDialog>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: 16px;
  /* A fixed height, so switching tabs does not make the dialog jump. */
  height: min(620px, calc(100vh - 120px));
  min-height: 0;
}
.tabs {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  border-right: 1px solid var(--border);
  padding-right: 10px;
}
.tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-dim);
  text-align: left;
  font-size: 13px;
  cursor: pointer;
}
.tab:hover {
  background: var(--bg-elev-2);
  color: inherit;
}
.tab.active {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
}
.icon {
  flex: none;
  width: 20px;
  text-align: center;
}
.label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.content {
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 4px;
}
h4 {
  margin: 0;
}
.error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}

/* ---- phone: tabs as a scrolling chip row above the pane ---- */
.layout.mobile {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  height: calc(85vh - 90px);
}
.mobile .tabs {
  flex-direction: row;
  overflow-x: auto;
  overflow-y: hidden;
  border-right: none;
  padding: 0 0 6px;
  border-bottom: 1px solid var(--border);
  scrollbar-width: none;
}
.mobile .tab {
  flex: none;
  min-height: 40px;
  border: 1px solid var(--border);
  border-radius: 20px;
}
.mobile .tab.active {
  border-color: var(--accent);
}
.mobile .content {
  padding-right: 0;
}
</style>
