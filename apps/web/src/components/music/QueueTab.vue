<script setup lang="ts">
/** 队列 — what the bot will play next, in order. */
import { useMusicStore } from "../../stores/music";
import { useI18n } from "../../i18n";
import { formatDuration, songCover } from "../../music/cover";
import { shownRequester } from "../../music/requester";

const music = useMusicStore();
const { t } = useI18n();

/** Double-click follows the same rights as the button beside it. */
function playAt(index: number): void {
  if (music.canJump) void music.playAt(index);
}
</script>

<template>
  <div class="queue">
    <p v-if="music.queue.length === 0" class="empty">{{ t("music.queueEmpty") }}</p>
    <div
      v-for="(s, i) in music.queue"
      :key="`${s.platform}:${s.id}:${i}`"
      class="item"
      :class="{ current: i === music.currentIndex }"
    >
      <span class="idx">{{ i + 1 }}</span>
      <img v-if="songCover(s)" :src="songCover(s)" class="thumb" alt="" loading="lazy" />
      <div v-else class="thumb placeholder">♪</div>
      <div class="info" @dblclick="playAt(i)">
        <div class="name">{{ s.name }}</div>
        <div class="sub">
          {{ s.artist
          }}<span v-if="shownRequester(s.requestedBy)"> · {{ shownRequester(s.requestedBy) }}</span>
        </div>
      </div>
      <span class="dur">{{ formatDuration(s.duration) }}</span>
      <button
        v-if="music.canJump && i !== music.currentIndex"
        class="mini"
        :title="t('music.playThis')"
        :disabled="music.busy"
        @click="playAt(i)"
      >
        ▶
      </button>
      <button
        v-if="music.allows('removeClear')"
        class="mini"
        :title="t('music.removeFromQueue')"
        @click="music.remove(i)"
      >
        ✕
      </button>
    </div>
    <div v-if="music.queue.length && music.allows('removeClear')" class="list-actions">
      <button @click="music.control('clear')">{{ t("music.clearQueue") }}</button>
    </div>
  </div>
</template>

<style scoped>
.queue {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.empty {
  color: var(--text-dim);
  font-size: 12px;
  margin: 8px 0;
}
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
.item.current {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}
.item.current .name {
  color: var(--accent);
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
.list-actions {
  display: flex;
  justify-content: flex-end;
  padding: 6px;
}
</style>
