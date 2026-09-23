<script setup lang="ts">
/**
 * 播放历史 — everything the bot recorded, newest first.
 *
 * These rows come from the bot's database, not from a provider: they keep no
 * duration and no stream url, so re-queueing one asks the bot to look the song
 * up again (see `addSong` in the browse store). They do keep the cover, so
 * each row shows it like the queue does.
 */
import { onMounted } from "vue";
import { useMusicStore } from "../../stores/music";
import { useMusicBrowseStore } from "../../stores/musicBrowse";
import { useI18n } from "../../i18n";
import SongRow from "./SongRow.vue";

const music = useMusicStore();
const browse = useMusicBrowseStore();
const { t } = useI18n();

onMounted(() => void browse.loadHistory());
</script>

<template>
  <div class="history">
    <div class="head">
      <button class="link" :disabled="browse.historyLoading" @click="browse.loadHistory(true)">
        ⟳
      </button>
    </div>
    <p v-if="browse.historyLoading" class="hint">{{ t("music.loading") }}</p>
    <p v-else-if="browse.historyError" class="hint error">{{ browse.historyError }}</p>
    <p v-else-if="browse.history.length === 0" class="hint">{{ t("music.historyEmpty") }}</p>
    <SongRow
      v-for="(s, i) in browse.history"
      :key="`${s.platform}:${s.id}:${i}`"
      :song="s"
      show-requester
      @add="browse.addSong($event)"
      @play-next="music.playNext($event)"
      @play-now="music.playNow($event)"
    />
  </div>
</template>

<style scoped>
.history {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.head {
  display: flex;
  justify-content: flex-end;
}
.link {
  border: none;
  background: none;
  color: var(--accent);
  padding: 0 4px;
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
