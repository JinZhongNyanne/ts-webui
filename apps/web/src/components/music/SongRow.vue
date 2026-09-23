<script setup lang="ts">
/**
 * One song in any browse list: search results, a playlist, the daily picks or
 * the play history. The buttons it shows are the ones the bot would accept.
 */
import { computed } from "vue";
import type { MusicSong } from "@jinz/protocol";
import { useMusicStore } from "../../stores/music";
import { useI18n } from "../../i18n";
import { formatDuration, songCover } from "../../music/cover";
import { isPlayableSong } from "../../music/browse-types";
import { shownRequester } from "../../music/requester";

const props = defineProps<{
  song: MusicSong;
  /** 1-based position, shown instead of the thumbnail when given. */
  index?: number;
  /** A history row also says who asked for it. */
  showRequester?: boolean;
}>();

const emit = defineEmits<{ add: [MusicSong]; playNext: [MusicSong]; playNow: [MusicSong] }>();

const music = useMusicStore();
const { t } = useI18n();

const cover = computed(() => songCover(props.song));
const requester = computed(() =>
  props.showRequester ? shownRequester(props.song.requestedBy) : null,
);

/**
 * A history row carries no duration and no url, so the bot cannot play it
 * straight away — it has to look the song up again, which only the queue
 * route does. Offering "play now" there would just fail.
 */
const resolvable = computed(() => isPlayableSong(props.song));
</script>

<template>
  <div class="item">
    <span v-if="index !== undefined" class="idx">{{ index }}</span>
    <img v-else-if="cover" :src="cover" class="thumb" alt="" />
    <div v-else class="thumb placeholder">♪</div>
    <div class="info" @dblclick="music.allows('add') && emit('add', song)">
      <div class="name" :title="song.name">{{ song.name }}</div>
      <div class="sub">
        {{ song.artist }}<span v-if="song.album"> · {{ song.album }}</span
        ><span v-if="requester"> · {{ requester }}</span>
      </div>
    </div>
    <span v-if="song.duration" class="dur">{{ formatDuration(song.duration) }}</span>
    <button
      v-if="music.allows('add')"
      class="mini"
      :title="resolvable ? t('music.addToQueue') : t('music.requeueById')"
      @click="emit('add', song)"
    >
      ＋
    </button>
    <button
      v-if="resolvable && music.allows('playNext')"
      class="mini"
      :title="t('music.playNext')"
      @click="emit('playNext', song)"
    >
      ⤴
    </button>
    <button
      v-if="resolvable && music.allows('playNow')"
      class="mini"
      :title="t('music.playNow')"
      @click="emit('playNow', song)"
    >
      ▶
    </button>
  </div>
</template>

<style scoped>
.item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  border-radius: 8px;
}
.item:hover {
  background: var(--bg-elev-2);
}
.idx {
  width: 18px;
  text-align: right;
  color: var(--text-dim);
  font-size: 11px;
}
.thumb {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  object-fit: cover;
  flex: none;
  background: var(--bg-elev-2);
}
.thumb.placeholder {
  display: grid;
  place-items: center;
  color: var(--text-dim);
}
.info {
  flex: 1;
  min-width: 0;
  cursor: default;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub {
  color: var(--text-dim);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dur {
  font-size: 11px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.mini {
  padding: 2px 7px;
  font-size: 12px;
}
</style>
