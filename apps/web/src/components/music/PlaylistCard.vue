<script setup lang="ts">
/** A playlist tile: opens on click, with play/queue shortcuts on hover. */
import { computed } from "vue";
import { useMusicStore } from "../../stores/music";
import { useI18n } from "../../i18n";
import { coverUrl } from "../../music/cover";
import type { MusicPlaylist } from "../../music/browse-types";

const props = defineProps<{ playlist: MusicPlaylist }>();
const emit = defineEmits<{
  open: [MusicPlaylist];
  play: [MusicPlaylist];
  queue: [MusicPlaylist];
}>();

const music = useMusicStore();
const { t } = useI18n();
const cover = computed(() => coverUrl(props.playlist.coverUrl));
</script>

<template>
  <div class="card" @click="emit('open', playlist)">
    <div class="art">
      <img v-if="cover" :src="cover" alt="" />
      <div v-else class="placeholder">♪</div>
      <div class="actions" @click.stop>
        <button
          v-if="music.allows('playCollection')"
          class="mini"
          :title="t('music.playAll')"
          @click="emit('play', playlist)"
        >
          ▶
        </button>
        <button
          v-if="music.allows('queueCollection')"
          class="mini"
          :title="t('music.queueAll')"
          @click="emit('queue', playlist)"
        >
          ＋
        </button>
      </div>
    </div>
    <div class="name" :title="playlist.name">{{ playlist.name }}</div>
    <div v-if="playlist.songCount" class="count">
      {{ t("music.songCount", { count: playlist.songCount }) }}
    </div>
  </div>
</template>

<style scoped>
.card {
  cursor: pointer;
  min-width: 0;
}
.art {
  position: relative;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-elev-2);
}
.art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.placeholder {
  display: grid;
  place-items: center;
  height: 100%;
  font-size: 24px;
  color: var(--text-dim);
}
.actions {
  position: absolute;
  inset: auto 4px 4px auto;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 120ms ease;
}
.card:hover .actions,
.card:focus-within .actions {
  opacity: 1;
}
.mini {
  padding: 2px 7px;
  font-size: 12px;
}
.name {
  margin-top: 4px;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.count {
  color: var(--text-dim);
  font-size: 11px;
}
</style>
