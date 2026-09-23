<script setup lang="ts">
/** The songs of a playlist the user opened from a card, with a way back. */
import { computed } from "vue";
import { useMusicStore } from "../../stores/music";
import { useMusicBrowseStore } from "../../stores/musicBrowse";
import { useI18n } from "../../i18n";
import { coverUrl } from "../../music/cover";
import SongRow from "./SongRow.vue";

const music = useMusicStore();
const browse = useMusicBrowseStore();
const { t } = useI18n();

const playlist = computed(() => browse.openPlaylist);
const cover = computed(() =>
  coverUrl(browse.playlistDetail?.coverUrl || browse.openPlaylist?.coverUrl),
);
const count = computed(
  () => browse.playlistDetail?.songCount || browse.openPlaylist?.songCount || 0,
);
</script>

<template>
  <div v-if="playlist" class="playlist">
    <button class="link back" @click="browse.close()">← {{ t("music.back") }}</button>

    <header class="head">
      <img v-if="cover" :src="cover" class="art" alt="" />
      <div v-else class="art placeholder">♪</div>
      <div class="meta">
        <div class="name" :title="playlist.name">
          {{ browse.playlistDetail?.name ?? playlist.name }}
        </div>
        <div v-if="count" class="count">{{ t("music.songCount", { count }) }}</div>
        <div class="actions">
          <button
            v-if="music.allows('playCollection')"
            :disabled="music.busy"
            @click="browse.playPlaylist(playlist, browse.openIsRecommended)"
          >
            {{ t("music.playAll") }}
          </button>
          <button
            v-if="music.allows('queueCollection')"
            :disabled="music.busy"
            @click="browse.queuePlaylist(playlist)"
          >
            {{ t("music.queueAll") }}
          </button>
        </div>
      </div>
    </header>

    <p v-if="browse.playlistLoading" class="hint">{{ t("music.loading") }}</p>
    <p v-else-if="browse.playlistError" class="hint error">{{ browse.playlistError }}</p>
    <p v-else-if="browse.playlistSongs.length === 0" class="hint">{{ t("music.playlistEmpty") }}</p>
    <SongRow
      v-for="(s, i) in browse.playlistSongs"
      :key="`${s.platform}:${s.id}:${i}`"
      :song="s"
      @add="browse.addSong($event)"
      @play-next="music.playNext($event)"
      @play-now="music.playNow($event)"
    />
  </div>
</template>

<style scoped>
.playlist {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.back {
  align-self: flex-start;
  border: none;
  background: none;
  color: var(--accent);
  padding: 0;
  font-size: 12px;
}
.head {
  display: flex;
  gap: 10px;
}
.art {
  width: 72px;
  height: 72px;
  border-radius: 8px;
  object-fit: cover;
  flex: none;
  background: var(--bg-elev-2);
}
.art.placeholder {
  display: grid;
  place-items: center;
  font-size: 26px;
  color: var(--text-dim);
}
.meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.count {
  color: var(--text-dim);
  font-size: 11px;
}
.actions {
  display: flex;
  gap: 6px;
  margin-top: auto;
}
.actions button {
  font-size: 12px;
  padding: 3px 9px;
}
.hint {
  margin: 4px 0;
  font-size: 12px;
  color: var(--text-dim);
}
.hint.error {
  color: var(--danger);
}
</style>
