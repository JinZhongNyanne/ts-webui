<script setup lang="ts">
/**
 * The one control that must never be more than a thumb away: talk, and hear.
 *
 * It sits above the tab bar and stays put whichever view is showing, because on
 * a phone there is no status bar to fall back on. The gear opens the settings
 * panel on its microphone tab.
 *
 * Without talk power in this channel it says so, the way the desktop's mic
 * button does (components/VoiceControls.vue, from audio/talk-power.ts): the
 * server would silently drop the voice, so the button never claims to be
 * talking. A phone has no status bar and no tooltips, so the reason is spelt
 * out above the button, with the talk-power request next to it — as big as a
 * fingertip needs (`--touch-target`).
 */
import { computed } from "vue";
import { useVoiceStore } from "../stores/voice";
import { useVoice } from "../audio/useVoice";
import { useTsStore } from "../stores/ts";
import { useI18n } from "../i18n";
import { openSettings } from "../components/settings/settings-panel";
import { openClientDialog } from "../components/client/client-dialogs";
import { useClientMenus } from "../components/client/useClientMenus";
import { cancelTalkRequest } from "../ts/client-actions";

const voice = useVoiceStore();
const v = useVoice();
const ts = useTsStore();
const { t } = useI18n();

const me = computed(() => ts.selfClient);
const connected = computed(() => ts.connState === "connected");
const outputMuted = computed(() => me.value?.outputMuted ?? false);

/** Mic on, but this channel would not let us be heard (roadmap D1). */
const silenced = computed(() => voice.micEnabled && !voice.canTalk && !voice.transmitting);

const micLabel = computed(() => {
  if (!voice.engineReady) return t("voice.start");
  if (!voice.micEnabled) return t("voice.micOff");
  if (voice.transmitting) return t("voice.talking");
  return silenced.value ? t("voice.noTalkPower") : t("voice.micOn");
});

const micIcon = computed(() => {
  if (silenced.value) return "🚫";
  return voice.micEnabled ? "🎤" : "🔈";
});

const clientMenus = useClientMenus();

/** Only where it can work: the server refuses a request in a channel that needs none. */
const talkAction = computed(() =>
  silenced.value && connected.value ? clientMenus.selfTalkAction() : null,
);

function onTalkAction(): void {
  if (talkAction.value === "cancel") clientMenus.run(cancelTalkRequest());
  else openClientDialog({ kind: "talkRequest" });
}

/**
 * Why the mic cannot transmit, if it cannot: no WebCodecs encoder at all
 * (common on iOS Safari), or a channel whose codec is not Opus.
 */
const blocked = computed(() => {
  if (voice.canEncode === false) return t("mobile.listenOnly");
  if (!voice.codecSupported) return t("voice.codecUnsupported");
  return null;
});

async function onMicClick(): Promise<void> {
  if (!voice.engineReady) {
    await v.start();
    if (voice.autoMic) await v.enableMic();
    return;
  }
  await v.toggleMic();
}

function toggleOutput(): void {
  ts.setOutputMuted(!outputMuted.value);
}
</script>

<template>
  <div class="voicebar glass-host">
    <p v-if="blocked" class="blocked">{{ blocked }}</p>
    <div v-else-if="silenced" class="blocked silenced-note" data-testid="mobile-no-talk-power">
      <span>{{ t("talk.needed") }}</span>
      <button
        v-if="talkAction"
        class="talk-request"
        :class="{ active: talkAction === 'cancel' }"
        data-testid="mobile-talk-request"
        @click="onTalkAction"
      >
        ✋ {{ talkAction === "cancel" ? t("talk.pending") : t("talk.request") }}
      </button>
    </div>
    <div class="row">
      <button
        class="mic"
        :class="{ on: voice.micEnabled, tx: voice.transmitting, warn: !!blocked, silenced }"
        data-testid="mobile-voice-mic"
        :data-can-talk="voice.canTalk"
        @click="onMicClick"
      >
        <span class="mic-icon">{{ micIcon }}</span>
        <span class="mic-label">{{ micLabel }}</span>
      </button>
      <button
        class="side"
        :class="{ muted: outputMuted }"
        :disabled="!connected"
        :title="t('status.outputVolume')"
        @click="toggleOutput"
      >
        {{ outputMuted ? "🔇" : "🔊" }}
      </button>
      <button class="side" :title="t('voice.settings')" @click="openSettings('mic')">⚙️</button>
    </div>
  </div>
</template>

<style scoped>
.voicebar {
  flex: none;
  border-top: 1px solid var(--border);
  background: var(--bg-elev);
}
.row {
  display: flex;
  align-items: stretch;
  gap: 6px;
  padding: 6px 8px;
  /* The side notch in landscape; the bar above the tab bar, so no bottom inset. */
  padding-left: calc(8px + env(safe-area-inset-left, 0px));
  padding-right: calc(8px + env(safe-area-inset-right, 0px));
}
.blocked {
  margin: 0;
  padding: 5px 10px;
  font-size: 11px;
  color: var(--warn);
  background: color-mix(in srgb, var(--warn) 14%, transparent);
}
.mic {
  flex: 1;
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-weight: 600;
  border-radius: 12px;
}
.mic-icon {
  font-size: 18px;
  line-height: 1;
}
.mic.on {
  border-color: var(--ok);
  color: var(--ok);
}
.mic.tx {
  background: color-mix(in srgb, var(--ok) 22%, var(--bg-elev-2));
  border-color: var(--ok);
  color: var(--text);
}
.mic.warn {
  border-color: var(--warn);
  color: var(--warn);
}
.mic.silenced {
  border-color: var(--danger);
  color: var(--text-dim);
}
.silenced-note {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-left: calc(10px + env(safe-area-inset-left, 0px));
  padding-right: calc(10px + env(safe-area-inset-right, 0px));
}
/* Hit with a fingertip, whatever the pointer media query says. */
.talk-request {
  flex: none;
  min-height: var(--touch-target);
  padding: 0 12px;
  font-size: 13px;
  border-radius: 10px;
}
.talk-request.active {
  border-color: var(--warn);
  color: var(--warn);
}
.side {
  flex: none;
  min-width: 48px;
  min-height: 48px;
  font-size: 18px;
  border-radius: 12px;
}
.side.muted {
  border-color: var(--danger);
  color: var(--danger);
}
</style>
