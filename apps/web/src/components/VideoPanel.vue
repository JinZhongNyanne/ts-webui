<script setup lang="ts">
import { computed, ref } from "vue";
import { useRtcStore, type PeerStatus, type TrackView } from "../stores/rtc";
import { useTsStore } from "../stores/ts";
import VideoTile from "./VideoTile.vue";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n";

const rtc = useRtcStore();
const ts = useTsStore();
const { t } = useI18n();
const showOptions = ref(false);
const focusEl = ref<HTMLElement | null>(null);
const focusTile = ref<InstanceType<typeof VideoTile> | null>(null);

const focused = computed(() => rtc.videoTracks.find((t) => t.sid === rtc.focusedSid) ?? null);
const others = computed(() => rtc.videoTracks.filter((t) => t.sid !== focused.value?.sid));
const remoteSharers = computed(() => rtc.publishers.filter((p) => p.clientId !== ts.selfId));
const backendLabel = computed(() =>
  rtc.backend === "mesh" ? t("video.backendMesh") : rtc.backend === "livekit" ? "LiveKit" : "",
);
const pipSupported = "pictureInPictureEnabled" in document && document.pictureInPictureEnabled;

function label(track: TrackView): string {
  const who = track.isLocal ? t("info.me") : track.participantName;
  if (track.source === "screen") return t("video.whoScreen", { who });
  if (track.source === "camera") return who;
  return t("video.whoVideo", { who });
}

function peerState(p: PeerStatus): string {
  const states: Record<string, MessageKey> = {
    new: "video.peerNew",
    connecting: "status.connecting",
    connected: "status.connected",
    disconnected: "video.peerDisconnected",
    failed: "video.peerFailed",
    closed: "video.peerClosed",
  };
  const paths: Record<string, MessageKey> = {
    host: "video.pathLan",
    srflx: "video.pathDirect",
    prflx: "video.pathDirect",
    relay: "video.pathRelay",
  };
  const stateKey = states[p.state];
  const base = stateKey ? t(stateKey) : p.state;
  const pathKey = paths[p.path];
  return p.state === "connected" && pathKey ? `${base} · ${t(pathKey)}` : base;
}

function fullscreen(): void {
  const el = focusEl.value;
  if (!el) return;
  if (document.fullscreenElement) void document.exitFullscreen();
  else void el.requestFullscreen().catch(() => undefined);
}

async function pip(): Promise<void> {
  const v = focusTile.value?.el as HTMLVideoElement | undefined;
  if (!v || !("requestPictureInPicture" in v)) return;
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await v.requestPictureInPicture();
  } catch {
    /* user agent refused */
  }
}

async function applyOptions(): Promise<void> {
  // Restart the share so the new quality takes effect.
  if (rtc.screenOn) await rtc.shareScreen();
}
</script>

<template>
  <section class="video" :class="{ active: rtc.state === 'connected' }">
    <header class="bar">
      <span class="title">
        {{ t("video.title") }} · {{ ts.selfChannel?.name ?? "" }}
        <small v-if="rtc.state === 'connected'">
          {{ t("video.inRoom", { count: rtc.participantCount })
          }}<template v-if="backendLabel"> · {{ backendLabel }}</template>
        </small>
      </span>
      <div class="actions">
        <template v-if="rtc.state === 'connected'">
          <button :class="{ on: rtc.cameraOn }" @click="rtc.toggleCamera()">
            {{ rtc.cameraOn ? `📷 ${t("tree.cameraOff")}` : `📷 ${t("video.camera")}` }}
          </button>
          <span class="split">
            <button :class="{ on: rtc.screenOn }" @click="rtc.toggleScreen()">
              {{
                rtc.screenOn
                  ? `🖥️ ${t("status.stopShareLabel")}`
                  : `🖥️ ${t("status.shareScreenLabel")}`
              }}
            </button>
            <button
              class="gear"
              :class="{ on: showOptions }"
              :title="t('video.shareSettings')"
              @click="showOptions = !showOptions"
            >
              ⚙️
            </button>
          </span>
          <button class="danger" @click="rtc.leave()">{{ t("video.leave") }}</button>
        </template>
        <template v-else>
          <button
            :disabled="rtc.state === 'connecting' || !ts.selfChannel || !rtc.available"
            @click="rtc.join()"
          >
            {{ rtc.state === "connecting" ? t("status.connecting") : `🎥 ${t("video.join")}` }}
          </button>
          <button
            :disabled="rtc.state === 'connecting' || !ts.selfChannel || !rtc.available"
            :title="t('video.joinAndShare')"
            @click="rtc.shareScreen()"
          >
            🖥️ {{ t("status.shareScreenLabel") }}
          </button>
        </template>
      </div>
    </header>

    <div v-if="showOptions" class="options">
      <label>
        <span>{{ t("video.fps") }}</span>
        <select v-model.number="rtc.screenOptions.fps" @change="applyOptions">
          <option :value="5">{{ t("video.fps5") }}</option>
          <option :value="15">{{ t("video.fps15") }}</option>
          <option :value="30">{{ t("video.fps30") }}</option>
          <option :value="60">{{ t("video.fps60") }}</option>
        </select>
      </label>
      <label>
        <span>{{ t("video.resolution") }}</span>
        <select v-model.number="rtc.screenOptions.maxHeight" @change="applyOptions">
          <option :value="720">{{ t("video.max720") }}</option>
          <option :value="1080">{{ t("video.max1080") }}</option>
          <option :value="1440">{{ t("video.max1440") }}</option>
          <option :value="0">{{ t("video.native") }}</option>
        </select>
      </label>
      <label>
        <span>{{ t("video.optimize") }}</span>
        <select v-model="rtc.screenOptions.contentHint" @change="applyOptions">
          <option value="detail">{{ t("video.optimizeDetail") }}</option>
          <option value="motion">{{ t("video.optimizeMotion") }}</option>
        </select>
      </label>
      <label class="chk">
        <input v-model="rtc.screenOptions.audio" type="checkbox" @change="applyOptions" />
        <span>{{ t("video.shareAudio") }}</span>
      </label>
      <p class="hint">{{ t("video.optionsHint") }}</p>
    </div>

    <p v-if="rtc.error" class="error">{{ rtc.error }}</p>

    <div v-if="rtc.state !== 'connected'" class="stage idle">
      <p v-if="!rtc.available" class="empty">{{ t("video.unavailable") }}</p>
      <template v-else-if="remoteSharers.length">
        <p class="empty">
          <template v-for="p in remoteSharers" :key="p.clientId">
            <b>{{ p.nickname }}</b>
            {{ p.screen ? t("video.isSharingScreen") : t("video.isSharingCamera") }}
            <button class="link" @click="rtc.watch(p.clientId)">{{ t("video.watch") }}</button>
          </template>
        </p>
      </template>
      <p v-else class="empty">{{ t("video.idleHint") }}</p>
    </div>

    <div v-else class="stage">
      <p v-if="rtc.videoTracks.length === 0" class="empty">
        {{ t("video.nobodySharing") }}
        <template v-if="rtc.members.length <= 1">{{ t("video.aloneInRoom") }}</template>
      </p>
      <template v-else>
        <div v-if="focused" ref="focusEl" class="focus" @dblclick="rtc.focusedSid = null">
          <VideoTile ref="focusTile" :view="focused" />
          <span class="name">{{ label(focused) }}</span>
          <div class="tools">
            <button :title="t('video.fullscreen')" @click.stop="fullscreen">⛶</button>
            <button v-if="pipSupported" :title="t('video.pip')" @click.stop="pip">⧉</button>
            <button :title="t('video.unfocus')" @click.stop="rtc.focusedSid = null">▣</button>
          </div>
        </div>
        <div class="grid" :class="{ strip: !!focused }">
          <div
            v-for="track in others"
            :key="track.sid"
            class="cell"
            :title="t('video.dblClickFocus', { name: label(track) })"
            @dblclick="rtc.focusedSid = track.sid"
          >
            <VideoTile :view="track" />
            <span class="name">{{ label(track) }}</span>
          </div>
        </div>
      </template>
      <!-- remote audio (screen-share audio); local audio is muted to avoid echo -->
      <VideoTile v-for="a in rtc.audioTracks" :key="a.sid" :view="a" :muted="a.isLocal" />

      <ul v-if="rtc.backend === 'mesh' && rtc.peers.length" class="peers">
        <li v-for="p in rtc.peers" :key="p.clientId" :class="p.state">
          <span class="dot"></span>{{ p.nickname }}: {{ peerState(p) }}
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.video {
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
  height: 100%;
  min-height: 0;
}
.video.active {
  flex: 1;
}
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  flex-wrap: wrap;
}
.title {
  font-weight: 600;
}
.title small {
  margin-left: 8px;
  color: var(--text-dim);
  font-weight: 400;
}
.actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.split {
  display: inline-flex;
}
.split button:first-child {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}
.split .gear {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  border-left: none;
  padding: 6px 8px;
}
button.on {
  border-color: var(--ok);
  color: var(--ok);
}
.danger {
  color: var(--danger);
}
.options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 14px;
  margin: 0 12px 8px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  font-size: 12px;
}
.options label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-dim);
}
.options label.chk {
  grid-column: 1 / -1;
  justify-content: flex-start;
}
.options select {
  width: 170px;
}
.options .hint {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.5;
}
.error {
  margin: 0 12px 8px;
  color: var(--danger);
  font-size: 12px;
}
.stage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 12px 10px;
}
.empty {
  color: var(--text-dim);
  font-size: 12px;
  margin: 4px 0 8px;
  line-height: 1.7;
}
.link {
  border: none;
  background: none;
  color: var(--accent);
  padding: 0 4px;
}
.focus {
  flex: 1;
  min-height: 0;
  position: relative;
  background: #000;
  border-radius: 10px;
}
.focus:fullscreen {
  border-radius: 0;
}
.tools {
  position: absolute;
  right: 8px;
  top: 8px;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 120ms;
}
.focus:hover .tools {
  opacity: 1;
}
.tools button {
  padding: 2px 8px;
  background: rgba(0, 0, 0, 0.55);
  border-color: transparent;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
  flex: 1;
  min-height: 0;
  align-content: start;
  overflow: auto;
}
.grid.strip {
  flex: none;
  grid-auto-flow: column;
  grid-template-columns: none;
  grid-auto-columns: 180px;
  overflow-x: auto;
}
.grid.strip:empty {
  display: none;
}
.cell {
  position: relative;
  aspect-ratio: 16 / 9;
  cursor: zoom-in;
}
.grid.strip .cell {
  height: 100px;
}
.name {
  position: absolute;
  left: 8px;
  bottom: 8px;
  font-size: 11px;
  background: rgba(0, 0, 0, 0.55);
  padding: 2px 6px;
  border-radius: 6px;
}
.peers {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  font-size: 11px;
  color: var(--text-dim);
}
.peers .dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-right: 5px;
  background: var(--text-dim);
}
.peers .connected .dot {
  background: var(--ok);
}
.peers .connecting .dot,
.peers .new .dot {
  background: var(--warn);
}
.peers .failed .dot,
.peers .disconnected .dot {
  background: var(--danger);
}
</style>
