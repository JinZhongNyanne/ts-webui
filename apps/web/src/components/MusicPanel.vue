<script setup lang="ts">
/**
 * The song-request panel: what is playing, the transport controls the bot lets
 * this session use, and the five browse tabs it serves (queue, discover,
 * library, search, history). Each tab is its own component under ./music.
 */
import { computed, onMounted, ref, watch } from "vue";
import { useMusicStore } from "../stores/music";
import { useMusicBrowseStore } from "../stores/musicBrowse";
import { useTsStore } from "../stores/ts";
import { useHubAccessStore } from "../stores/hubAccess";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n";
import { describeMusicBot } from "../music/target";
import { formatDuration, songCover } from "../music/cover";
import { shownRequester } from "../music/requester";
import QueueTab from "./music/QueueTab.vue";
import SearchTab from "./music/SearchTab.vue";
import DiscoverTab from "./music/DiscoverTab.vue";
import LibraryTab from "./music/LibraryTab.vue";
import HistoryTab from "./music/HistoryTab.vue";
import LyricsView from "./music/LyricsView.vue";

const music = useMusicStore();
const browse = useMusicBrowseStore();
const ts = useTsStore();
const access = useHubAccessStore();
const { t } = useI18n();

type Tab = "queue" | "discover" | "library" | "search" | "history";
const tab = ref<Tab>("queue");
const showLyrics = ref(false);
const volumeDraft = ref<number | null>(null);

const song = computed(() => music.status?.currentSong ?? null);
const cover = computed(() => songCover(song.value));
const requester = computed(() => shownRequester(song.value?.requestedBy));
const duration = computed(() => music.status?.effectiveDuration ?? song.value?.duration ?? 0);
const progress = computed(() =>
  duration.value > 0 ? Math.min(100, (music.localElapsed / duration.value) * 100) : 0,
);
const modeLabel: Record<string, MessageKey> = {
  seq: "music.modeSeq",
  loop: "music.modeLoop",
  random: "music.modeRandom",
  rloop: "music.modeListLoop",
};
const modes = ["seq", "loop", "random", "rloop"];

/** What the hub dialed, so an "unavailable" notice says where it looked. */
const triedAddress = computed(() => describeMusicBot(ts.profile.musicBot, ts.profile.host));

const botHere = computed(() => {
  const c = music.botClient;
  return !!c && !!ts.selfChannel && c.channelId === ts.selfChannel.id;
});

/** The bot refuses seeking without transport rights, so the bar just stops reacting. */
function onSeek(ev: Event): void {
  if (!music.allows("transport")) return;
  const el = ev.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  const x = (ev as MouseEvent).clientX - rect.left;
  const ratio = Math.max(0, Math.min(1, x / rect.width));
  void music.seek(ratio * duration.value);
}

function nextMode(): void {
  const cur = music.status?.playMode ?? "seq";
  const idx = modes.indexOf(cur);
  void music.setMode(modes[(idx + 1) % modes.length]!);
}

function commitVolume(): void {
  if (volumeDraft.value !== null) void music.setVolume(volumeDraft.value);
  volumeDraft.value = null;
}

function goToBot(): void {
  const c = music.botClient;
  if (c) ts.moveTo(c.channelId);
}

onMounted(() => {
  if (music.available) void music.loadProviders();
});
watch(
  () => music.available,
  (ok) => {
    if (ok && music.providers.length === 0) void music.loadProviders();
  },
);
// Another bot has its own history and its own platform logins.
watch(
  () => music.selectedBotId,
  () => browse.reset(),
);
// A drilled-into playlist belongs to the tab it was opened from.
watch(tab, () => browse.close());
</script>

<template>
  <section class="music">
    <header class="head">
      <h3>{{ t("music.title") }}</h3>
      <select v-if="music.bots.length > 1" v-model="music.selectedBotId" class="bot-select">
        <option v-for="b in music.bots" :key="b.status.id" :value="b.status.id">
          {{ b.status.name }}
        </option>
      </select>
      <span v-else-if="music.bot" class="bot-name">{{ music.bot.status.name }}</span>
    </header>

    <template v-if="!music.available">
      <p class="notice">{{ music.unavailableReason ?? t("music.unavailable") }}</p>
      <!-- A fixed server's bot address lives on the hub; the page does not know it. -->
      <p v-if="!access.fixedServer" class="notice tried">
        {{ t("music.triedAddress", { url: triedAddress }) }}
      </p>
    </template>
    <p v-else-if="!music.bot" class="notice">{{ t("music.noBots") }}</p>

    <template v-else>
      <p v-if="!music.bot.status.connected" class="notice warn">{{ t("music.botOffline") }}</p>
      <p v-else-if="music.botClient && !botHere" class="notice">
        {{ t("music.botElsewhere") }}
        <button class="link" @click="goToBot">{{ t("music.goToBot") }}</button>
      </p>

      <div class="now">
        <button
          class="cover-btn"
          :title="t('music.showLyrics')"
          :disabled="!song"
          @click="showLyrics = true"
        >
          <img v-if="cover" :src="cover" class="cover" alt="" />
          <div v-else class="cover placeholder">♪</div>
          <span v-if="song" class="lyrics-hint">{{ t("music.lyricsShort") }}</span>
        </button>
        <div class="meta">
          <div class="title" :title="song?.name">{{ song?.name ?? t("music.nothingPlaying") }}</div>
          <div class="artist">
            {{ song?.artist ?? ""
            }}<span v-if="requester"> · {{ t("music.requestedBy", { name: requester }) }}</span>
          </div>
          <div v-if="music.radio" class="radio" :title="t('music.modeLocked')">
            {{ t(music.radio === "fm" ? "music.radioFm" : "music.radioRecommend") }}
          </div>
          <div class="bar" :class="{ readonly: !music.allows('transport') }" @click="onSeek">
            <div class="fill" :style="{ width: `${progress}%` }"></div>
          </div>
          <div class="times">
            <span>{{ formatDuration(music.localElapsed) }}</span>
            <span>{{ formatDuration(duration) }}</span>
          </div>
        </div>
      </div>

      <div class="controls">
        <button
          v-if="music.allows('prev')"
          :title="t('music.previous')"
          :disabled="music.busy"
          @click="music.control('prev')"
        >
          ⏮
        </button>
        <button
          class="big"
          :disabled="music.busy || !music.allows('transport')"
          :title="music.status?.playing ? t('music.pause') : t('music.play')"
          @click="music.control(music.status?.playing ? 'pause' : 'resume')"
        >
          {{ music.status?.playing ? "⏸" : "▶" }}
        </button>
        <button
          v-if="music.allows('skip')"
          :title="t('music.next')"
          :disabled="music.busy"
          @click="music.control('next')"
        >
          ⏭
        </button>
        <button
          v-if="music.allows('playMode')"
          :title="
            music.radio
              ? t('music.modeLocked')
              : t('music.playMode', { mode: t(modeLabel[music.status?.playMode ?? 'seq']!) })
          "
          :disabled="!!music.radio"
          @click="nextMode"
        >
          {{ { seq: "➡", loop: "🔂", random: "🔀", rloop: "🔁" }[music.status?.playMode ?? "seq"] }}
        </button>
        <label
          class="vol"
          :title="t('music.volume', { value: volumeDraft ?? music.status?.volume ?? 0 })"
        >
          🔊
          <input
            type="range"
            min="0"
            max="100"
            :value="volumeDraft ?? music.status?.volume ?? 50"
            :disabled="!music.allows('transport')"
            @input="volumeDraft = Number(($event.target as HTMLInputElement).value)"
            @change="commitVolume"
          />
        </label>
      </div>

      <nav class="tabs">
        <button :class="{ active: tab === 'queue' }" @click="tab = 'queue'">
          {{ t("music.queue", { count: music.queue.length }) }}
        </button>
        <button :class="{ active: tab === 'discover' }" @click="tab = 'discover'">
          {{ t("music.discover") }}
        </button>
        <button :class="{ active: tab === 'library' }" @click="tab = 'library'">
          {{ t("music.library") }}
        </button>
        <button :class="{ active: tab === 'search' }" @click="tab = 'search'">
          {{ t("music.search") }}
        </button>
        <button :class="{ active: tab === 'history' }" @click="tab = 'history'">
          {{ t("music.history") }}
        </button>
      </nav>

      <div class="list">
        <QueueTab v-if="tab === 'queue'" />
        <DiscoverTab v-else-if="tab === 'discover'" />
        <LibraryTab v-else-if="tab === 'library'" />
        <SearchTab v-else-if="tab === 'search'" />
        <HistoryTab v-else />
      </div>

      <p v-if="music.error" class="notice error">{{ music.error }}</p>

      <LyricsView v-if="showLyrics" @close="showLyrics = false" />
    </template>
  </section>
</template>

<style scoped>
.radio {
  align-self: flex-start;
  margin-top: 2px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 10px;
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
}
.music {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 10px 12px;
  gap: 10px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
h3 {
  margin: 0;
  font-size: 15px;
}
.bot-name {
  color: var(--text-dim);
  font-size: 12px;
}
.bot-select {
  max-width: 160px;
}
.notice {
  margin: 0;
  font-size: 12px;
  color: var(--text-dim);
}
.notice.tried {
  font-size: 11px;
  opacity: 0.8;
  word-break: break-all;
}
.notice.warn {
  color: var(--warn);
}
.notice.error {
  color: var(--danger);
}
.link {
  border: none;
  background: none;
  color: var(--accent);
  padding: 0;
}
.now {
  display: flex;
  gap: 12px;
}
.cover-btn {
  position: relative;
  flex: none;
  padding: 0;
  border: none;
  border-radius: 10px;
  background: none;
  cursor: pointer;
}
.cover-btn:disabled {
  cursor: default;
}
.lyrics-hint {
  position: absolute;
  right: 4px;
  bottom: 4px;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 10px;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  opacity: 0;
  transition: opacity 150ms ease;
}
.cover-btn:hover .lyrics-hint,
.cover-btn:focus-visible .lyrics-hint {
  opacity: 1;
}
.cover {
  display: block;
  width: 84px;
  height: 84px;
  border-radius: 10px;
  object-fit: cover;
  flex: none;
  background: var(--bg-elev-2);
}
.cover.placeholder {
  display: grid;
  place-items: center;
  font-size: 30px;
  color: var(--text-dim);
}
.meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.artist {
  color: var(--text-dim);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bar {
  margin-top: auto;
  height: 6px;
  border-radius: 3px;
  background: var(--bg-elev-2);
  cursor: pointer;
  overflow: hidden;
}
.bar.readonly {
  cursor: default;
}
.fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
  transition: width 400ms linear;
}
.times {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.controls {
  display: flex;
  align-items: center;
  gap: 6px;
}
.controls .big {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--accent);
  border-color: var(--accent);
  color: white;
  font-size: 16px;
}
.vol {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}
.vol input {
  width: 90px;
  padding: 0;
  border: none;
  background: transparent;
}
/* Five tabs in a narrow dock panel: let them wrap rather than overflow. */
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  border-bottom: 1px solid var(--border);
}
.tabs button {
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: none;
  color: var(--text-dim);
  padding: 4px 6px;
  font-size: 12px;
}
.tabs button.active {
  color: var(--text);
  border-bottom-color: var(--accent);
}
.list {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
</style>
