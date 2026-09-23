<script setup lang="ts">
/**
 * The phone layout: one view at a time, picked from a bottom tab bar, with the
 * voice controls always in reach above it.
 *
 * It renders the very same panel components the dock does — no mobile forks of
 * the channel tree, the chat, the video wall or the music panel. What differs
 * is only how they are arranged and reached. Panels stay mounted and are hidden
 * with `v-show`, as in the dock, so switching tabs keeps scroll positions and
 * does not tear down a live video subscription.
 */
import { computed, ref, watch } from "vue";
import { useTsStore } from "../stores/ts";
import { useRtcStore } from "../stores/rtc";
import { useMusicStore } from "../stores/music";
import { useI18n } from "../i18n";
import ChannelTree from "../components/ChannelTree.vue";
import InfoPanel from "../components/InfoPanel.vue";
import MusicPanel from "../components/MusicPanel.vue";
import VideoPanel from "../components/VideoPanel.vue";
import FileBrowserPanel from "../components/FileBrowserPanel.vue";
import { useFileBrowserStore } from "../stores/fileBrowser";
import MobileChatView from "./MobileChatView.vue";
import MobileMenuSheet from "./MobileMenuSheet.vue";
import MobileSheet from "./MobileSheet.vue";
import MobileTabBar from "./MobileTabBar.vue";
import MobileTopBar from "./MobileTopBar.vue";
import MobileVoiceBar from "./MobileVoiceBar.vue";
import { resolveTab, totalUnread, visibleTabs, type MobileTabId } from "./tabs";

const ts = useTsStore();
const rtc = useRtcStore();
const music = useMusicStore();
const { t } = useI18n();

const requestedTab = ref<MobileTabId>("tree");
const menuOpen = ref(false);
const infoOpen = ref(false);
const filesOpen = ref(false);
const fileBrowser = useFileBrowserStore();

/** Same condition the dock uses to decide whether a music panel belongs. */
const wantMusic = computed(
  () => ts.features.music && (music.available || !!ts.profile.musicBot.trim()),
);
const tabs = computed(() => visibleTabs({ music: wantMusic.value, video: ts.features.video }));
/** The tab actually shown: a bot or a hub feature can disappear mid-session. */
const tab = computed(() => resolveTab(requestedTab.value, tabs.value));
const unread = computed(() => totalUnread(ts.unread));

function show(next: MobileTabId): void {
  requestedTab.value = next;
}

// Opening a conversation (tapping 💬 in the tree, or a poke arriving) is a
// request to read it — on the desktop it raises a panel; here it means the chat.
watch(
  () => ts.activeConversation,
  () => show("chat"),
);
// Someone started sharing, or the user asked to watch: the dock reveals the
// video panel, so the phone switches to the video tab.
watch(
  () => rtc.revealTick,
  () => {
    if (ts.features.video) show("video");
  },
);
// "Browse files…" (channel menu) or "Files" (menu sheet): the file browser's sheet.
watch(
  () => fileBrowser.openTick,
  () => {
    menuOpen.value = false;
    filesOpen.value = true;
  },
);
</script>

<template>
  <div class="mshell">
    <MobileTopBar @open-menu="menuOpen = true" />

    <main class="view">
      <div v-show="tab === 'tree'" class="pane">
        <ChannelTree />
        <button
          class="info-fab"
          :disabled="!ts.selection"
          :title="t('mobile.selectionInfo')"
          @click="infoOpen = true"
        >
          ℹ️
        </button>
      </div>
      <div v-show="tab === 'chat'" class="pane">
        <MobileChatView />
      </div>
      <div v-if="ts.features.video" v-show="tab === 'video'" class="pane">
        <VideoPanel />
      </div>
      <div v-if="wantMusic" v-show="tab === 'music'" class="pane">
        <MusicPanel />
      </div>
    </main>

    <MobileVoiceBar />
    <MobileTabBar
      :tabs="tabs"
      :active="tab"
      :unread="unread"
      :live-video="rtc.publishers.length > 0"
      @select="show"
    />

    <MobileMenuSheet v-if="menuOpen" @close="menuOpen = false" />
    <MobileSheet v-if="infoOpen" :title="t('info.title')" @close="infoOpen = false">
      <div class="info">
        <InfoPanel v-if="ts.selection" />
        <p v-else class="empty">{{ t("mobile.noSelection") }}</p>
      </div>
    </MobileSheet>
    <MobileSheet v-if="filesOpen" :title="t('fb.title')" @close="filesOpen = false">
      <div class="files">
        <FileBrowserPanel />
      </div>
    </MobileSheet>
  </div>
</template>

<style scoped>
.mshell {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg);
}
.view {
  flex: 1;
  min-height: 0;
  position: relative;
}
.pane {
  position: absolute;
  inset: 0;
  display: flex;
  min-height: 0;
}
.pane > * {
  flex: 1;
  min-width: 0;
  min-height: 0;
}
/* Floats over the tree because the tree fills the pane; the tree's own rows
   carry no room for an info affordance on a narrow screen. */
.info-fab {
  position: absolute;
  /* The pane is inside the shell, so the tab bar's own inset does not help it:
     in landscape the button would sit under the rounded corner. */
  right: calc(12px + env(safe-area-inset-right, 0px));
  bottom: 12px;
  width: 48px;
  height: 48px;
  border-radius: 24px;
  font-size: 20px;
  background: var(--bg-elev-2);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
}
.info {
  min-height: 40dvh;
  display: flex;
}
.info > * {
  flex: 1;
  min-width: 0;
}
/* `dvh` for the same reason MobileSheet does; the sheet caps it either way. */
.files {
  height: 70dvh;
  display: flex;
}
.files > * {
  flex: 1;
  min-width: 0;
}
.empty {
  margin: 0;
  padding: 24px 16px;
  color: var(--text-dim);
  font-size: 13px;
}
</style>
