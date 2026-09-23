<script setup lang="ts">
/**
 * 歌词 — the song that is playing, with its lyrics scrolling along, the way
 * NetEase Cloud Music's player page does it: the cover blurred behind, the
 * line being sung centred and lit, a translation under each line when the
 * provider has one. Clicking a line jumps there (when the bot lets this session
 * seek); scrolling by hand pauses the follow for a moment. A song whose own
 * platform has no lyrics borrows them from another one (lyrics-fallback.ts).
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useMusicStore } from "../../stores/music";
import { useI18n } from "../../i18n";
import { musicApi } from "../../music/api";
import { songCover } from "../../music/cover";
import { activeLineIndex, type LyricLine } from "../../music/lyrics";
import { findLyrics, type LyricsSource } from "../../music/lyrics-fallback";
import { SOURCE_LABEL_KEYS } from "../../music/discover-sources";

defineEmits<{ close: [] }>();

/** How long a manual scroll keeps the view from snapping back to the sung line. */
const MANUAL_SCROLL_HOLD_MS = 3000;

const music = useMusicStore();
const { t } = useI18n();

const song = computed(() => music.status?.currentSong ?? null);
const cover = computed(() => songCover(song.value));
const songKey = computed(() => (song.value ? `${song.value.platform}:${song.value.id}` : ""));

const lines = ref<LyricLine[]>([]);
const loading = ref(false);
const failed = ref(false);
/** The platform the lyrics were borrowed from; null when they are the song's own. */
const borrowedFrom = ref<string | null>(null);
const borrowedLabel = computed(() => {
  const p = borrowedFrom.value;
  if (!p) return "";
  const key = SOURCE_LABEL_KEYS[p as keyof typeof SOURCE_LABEL_KEYS];
  return t("music.lyricsFrom", { platform: key ? t(key) : p });
});

const lyricsSource: LyricsSource = {
  lyrics: (id, platform) => musicApi.lyrics(id, platform),
  search: (query, platform, limit) => musicApi.search(query, platform, limit),
};
const active = computed(() => activeLineIndex(lines.value, music.localElapsed));

const scroller = ref<HTMLElement | null>(null);
const lineEls = new Map<number, HTMLElement>();
let heldUntil = 0;

async function load(key: string): Promise<void> {
  lines.value = [];
  failed.value = false;
  borrowedFrom.value = null;
  lineEls.clear();
  const s = song.value;
  if (!s || !key) return;
  loading.value = true;
  try {
    const found = await findLyrics(s, music.providers, lyricsSource);
    if (songKey.value === key) {
      lines.value = found.lines;
      borrowedFrom.value = found.from;
    }
  } catch {
    if (songKey.value === key) failed.value = true;
  } finally {
    if (songKey.value === key) loading.value = false;
  }
  await nextTick();
  follow(false);
}

/** Centres the sung line, unless the user is reading elsewhere. */
function follow(smooth = true): void {
  const box = scroller.value;
  const el = lineEls.get(active.value);
  if (!box || !el || Date.now() < heldUntil) return;
  box.scrollTo({
    top: el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2,
    behavior: smooth ? "smooth" : "auto",
  });
}

/** The scrollbar is hidden, so a wheel or a touch is the only way a user scrolls. */
function onUserScroll(): void {
  heldUntil = Date.now() + MANUAL_SCROLL_HOLD_MS;
}

function setLineEl(i: number, el: unknown): void {
  if (el instanceof HTMLElement) lineEls.set(i, el);
  else lineEls.delete(i);
}

function seekTo(line: LyricLine): void {
  if (!music.allows("transport")) return;
  heldUntil = 0;
  void music.seek(line.time);
}

watch(songKey, (key) => void load(key), { immediate: true });
watch(active, () => void nextTick(() => follow()));

let holdTimer: number | null = window.setInterval(() => {
  // Once the hold runs out, go back to the sung line without waiting for the next one.
  if (heldUntil && Date.now() >= heldUntil) {
    heldUntil = 0;
    follow();
  }
}, 500);
onBeforeUnmount(() => {
  if (holdTimer) window.clearInterval(holdTimer);
  holdTimer = null;
});
</script>

<template>
  <div class="lyrics-view">
    <div class="backdrop" :style="cover ? { backgroundImage: `url(${cover})` } : undefined"></div>
    <div class="shade"></div>

    <header class="top">
      <button class="back" :title="t('music.back')" @click="$emit('close')">⌄</button>
      <img v-if="cover" :src="cover" class="mini-cover" alt="" />
      <div class="meta">
        <div class="name" :title="song?.name">{{ song?.name ?? t("music.nothingPlaying") }}</div>
        <div class="artist">{{ song?.artist ?? "" }}</div>
        <div v-if="borrowedLabel && lines.length" class="borrowed">{{ borrowedLabel }}</div>
      </div>
    </header>

    <p v-if="!song" class="state">{{ t("music.nothingPlaying") }}</p>
    <p v-else-if="loading" class="state">{{ t("music.lyricsLoading") }}</p>
    <p v-else-if="failed" class="state">{{ t("music.lyricsFailed") }}</p>
    <p v-else-if="lines.length === 0" class="state">{{ t("music.lyricsNone") }}</p>
    <div
      v-else
      ref="scroller"
      class="scroller"
      @wheel.passive="onUserScroll"
      @touchmove.passive="onUserScroll"
    >
      <div
        v-for="(line, i) in lines"
        :key="i"
        :ref="(el) => setLineEl(i, el)"
        class="line"
        :class="{ active: i === active, past: i < active, seekable: music.allows('transport') }"
        @click="seekTo(line)"
      >
        <div class="text">{{ line.text }}</div>
        <div v-if="line.translation" class="translation">{{ line.translation }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lyrics-view {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
  color: #fff;
}
.backdrop {
  position: absolute;
  inset: -40px;
  background-size: cover;
  background-position: center;
  filter: blur(40px) saturate(1.3);
  transform: scale(1.1);
  opacity: 0.85;
}
.shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0.7));
}
.top,
.state,
.scroller {
  position: relative;
}
.top {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
}
.back {
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  font-size: 16px;
  line-height: 1;
}
.back:hover {
  background: rgba(255, 255, 255, 0.22);
}
.mini-cover {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  object-fit: cover;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
}
.meta {
  min-width: 0;
}
.name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.artist {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.borrowed {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}
.state {
  margin: auto;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
}
.scroller {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
  padding: 0 16px;
  text-align: center;
  mask-image: linear-gradient(180deg, transparent 0, #000 18%, #000 82%, transparent 100%);
}
.scroller::-webkit-scrollbar {
  display: none;
}
/* Half a view of room above and below, so the first and last line can sit centred. */
.scroller::before,
.scroller::after {
  content: "";
  display: block;
  height: 45%;
}
.line {
  padding: 8px 4px;
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.45);
  transition:
    color 300ms ease,
    transform 300ms ease;
  transform-origin: center;
}
.line.seekable {
  cursor: pointer;
}
.line.seekable:hover {
  background: rgba(255, 255, 255, 0.06);
}
.line.active {
  color: #fff;
  transform: scale(1.06);
}
.text {
  font-size: 15px;
  font-weight: 500;
  line-height: 1.5;
}
.line.active .text {
  font-weight: 700;
  text-shadow: 0 0 18px rgba(255, 255, 255, 0.35);
}
.translation {
  margin-top: 2px;
  font-size: 12px;
  opacity: 0.85;
}
</style>
