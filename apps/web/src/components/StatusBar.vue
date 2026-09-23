<script setup lang="ts">
import { computed } from "vue";
import { useTsStore } from "../stores/ts";
import { useHubAccessStore } from "../stores/hubAccess";
import { useI18n } from "../i18n";
import QuickVolume from "./QuickVolume.vue";
import { useVoiceStore } from "../stores/voice";
import AddBookmarkButton from "./bookmarks/AddBookmarkButton.vue";
import { openClientDialog } from "./client/client-dialogs";
import { useClientMenus } from "./client/useClientMenus";
import { cancelTalkRequest, setAwayStatus } from "../ts/client-actions";
import { openSettings } from "./settings/settings-panel";

defineEmits<{ "reset-layout": [] }>();
const ts = useTsStore();
const access = useHubAccessStore();
const voice = useVoiceStore();
const { t } = useI18n();
const me = computed(() => ts.selfClient);
const connected = computed(() => ts.connState === "connected");
const stateText = computed(() => {
  if (connected.value) return me.value?.nickname ?? t("status.connected");
  return ts.connState === "connecting" ? t("status.connecting") : t("status.notConnected");
});

function toggleInput(): void {
  ts.setInputMuted(!(me.value?.inputMuted ?? false));
}
function toggleOutput(): void {
  ts.setOutputMuted(!(me.value?.outputMuted ?? false));
}
const clientMenus = useClientMenus();

/** Away asks for a message first; coming back is one click. */
function toggleAway(): void {
  if (me.value?.away) clientMenus.run(setAwayStatus(false));
  else openClientDialog({ kind: "away" });
}

/** Only where it can work: the server refuses a request in a channel that needs none. */
const talkButton = computed(() => (connected.value ? clientMenus.selfTalkAction() : null));

function onTalkButton(): void {
  if (talkButton.value === "cancel") clientMenus.run(cancelTalkRequest());
  else openClientDialog({ kind: "talkRequest" });
}
</script>

<template>
  <footer class="bar glass-host">
    <div class="me">
      <span class="dot" :class="{ on: connected, busy: ts.connState === 'connecting' }"></span>
      <button
        v-if="connected"
        class="nick nick-edit"
        :title="t('nick.change')"
        data-testid="status-nickname"
        @click="openClientDialog({ kind: 'nickname' })"
      >
        {{ stateText }}
      </button>
      <span v-else class="nick">{{ stateText }}</span>
      <span v-if="ts.selfChannel" class="chan">· {{ ts.selfChannel.name }}</span>
      <span
        v-if="ts.latencyMs !== null && ts.hubState === 'open'"
        class="ping"
        :class="{ slow: ts.latencyMs > 200 }"
        :title="t('status.latency')"
        >{{ ts.latencyMs }} ms</span
      >
    </div>
    <!-- The sound controls sit in the middle, where they are found without looking. -->
    <div class="audio">
      <slot name="voice"></slot>
      <QuickVolume
        v-model="voice.micVolume"
        icon="🎙️"
        :label="t('status.inputVolume')"
        :mute-title="t('status.micMuted')"
        :muted="me?.inputMuted ?? false"
        :disabled="!connected"
        @toggle-mute="toggleInput"
      />
      <QuickVolume
        v-model="voice.master"
        icon="🔊"
        :label="t('status.outputVolume')"
        :mute-title="t('status.speakerMuted')"
        :muted="me?.outputMuted ?? false"
        :disabled="!connected"
        @toggle-mute="toggleOutput"
      />
    </div>
    <div class="controls">
      <button
        :class="{ active: me?.away }"
        :disabled="!connected"
        :title="
          me?.away && me.awayMessage ? `${t('status.away')}: ${me.awayMessage}` : t('status.away')
        "
        data-testid="status-away"
        @click="toggleAway"
      >
        {{ me?.away ? `🌙 ${t("status.awayShort")}` : "🌙" }}
      </button>
      <button
        v-if="talkButton"
        :class="{ active: talkButton === 'cancel' }"
        :title="talkButton === 'cancel' ? t('talk.cancel') : t('talk.needed')"
        data-testid="status-talk-request"
        @click="onTalkButton"
      >
        ✋ {{ talkButton === "cancel" ? t("talk.pending") : t("talk.request") }}
      </button>
      <button
        :disabled="!connected"
        :title="t('status.layout')"
        data-testid="status-reset-layout"
        @click="$emit('reset-layout')"
      >
        ⊞
      </button>
      <!-- A hub pinned to one server has nothing to bookmark. -->
      <AddBookmarkButton v-if="connected && !access.fixedServer" />
      <button
        class="gear"
        :class="{ warn: !!voice.error }"
        :title="t('settings.open')"
        data-testid="status-settings"
        @click="openSettings()"
      >
        ⚙️
      </button>
      <button
        v-if="connected"
        class="danger"
        :title="t('status.disconnectTitle')"
        @click="ts.disconnect()"
      >
        {{ t("status.disconnect") }}
      </button>
    </div>
  </footer>
</template>

<style scoped>
.bar {
  /* Equal side columns keep the middle one centred whatever the sides hold. */
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-elev);
}
.me {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-dim);
}
.dot.on {
  background: var(--ok);
}
.dot.busy {
  background: var(--warn);
}
.nick {
  font-weight: 600;
}
.nick-edit {
  padding: 2px 6px;
  border-color: transparent;
  background: transparent;
}
.nick-edit:hover {
  border-color: var(--border);
}
.chan {
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ping {
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
}
.ping.slow {
  color: var(--warn);
}
.audio,
.controls {
  display: flex;
  gap: 6px;
  align-items: center;
}
.controls {
  justify-self: end;
}
button.active {
  border-color: var(--warn);
  color: var(--warn);
}
button.on {
  border-color: var(--ok);
  color: var(--ok);
}
.danger {
  color: var(--danger);
}
.gear {
  padding: 6px 8px;
}
/* A voice error is only spelled out inside the panel; the gear points there. */
.gear.warn {
  border-color: var(--danger);
}
</style>
