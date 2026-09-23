<script setup lang="ts">
/** 搜索 — a query against one source, or across all of them. */
import { useMusicStore } from "../../stores/music";
import { useI18n } from "../../i18n";
import SongRow from "./SongRow.vue";

const music = useMusicStore();
const { t } = useI18n();
</script>

<template>
  <div class="search-tab">
    <form class="search" @submit.prevent="music.search()">
      <select v-if="music.providers.length" v-model="music.platform">
        <option v-for="p in music.providers" :key="p" :value="p">{{ p }}</option>
        <option value="all">{{ t("music.allPlatforms") }}</option>
      </select>
      <input v-model="music.query" :placeholder="t('music.searchPlaceholder')" />
      <button type="submit" :disabled="music.searching">{{ t("music.searchGo") }}</button>
    </form>
    <p v-if="music.searching" class="empty">{{ t("music.searching") }}</p>
    <SongRow
      v-for="s in music.results"
      :key="`${s.platform}:${s.id}`"
      :song="s"
      @add="music.add($event)"
      @play-next="music.playNext($event)"
      @play-now="music.playNow($event)"
    />
  </div>
</template>

<style scoped>
.search-tab {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.search {
  display: flex;
  gap: 6px;
  padding-bottom: 6px;
}
.search input {
  flex: 1;
  min-width: 0;
}
.empty {
  color: var(--text-dim);
  font-size: 12px;
  margin: 8px 0;
}
</style>
