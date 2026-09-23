<script setup lang="ts">
/**
 * 发现 — what the bot's own web UI puts on its home page: a personal-radio
 * card per platform that offers one, the editor's-pick playlists, the daily
 * picks and Bilibili's popular videos. The playlists and the daily picks each
 * carry their own 网易云 / QQ音乐 / 酷狗 switch, as they do on the bot's page.
 */
import { computed, onMounted, watch } from "vue";
import { useMusicStore } from "../../stores/music";
import { useMusicBrowseStore } from "../../stores/musicBrowse";
import { useI18n } from "../../i18n";
import SectionBlock from "./SectionBlock.vue";
import PlaylistCard from "./PlaylistCard.vue";
import PlaylistView from "./PlaylistView.vue";
import SongRow from "./SongRow.vue";
import SourceTabs from "./SourceTabs.vue";

const music = useMusicStore();
const browse = useMusicBrowseStore();
const { t } = useI18n();

/**
 * True once every section answered and none of them had anything to show.
 * With source tabs on screen each section already says so itself.
 */
const allEmpty = computed(
  () =>
    browse.discoverTabs.length < 2 &&
    !browse.recommended.loading &&
    !browse.daily.loading &&
    !browse.popular.loading &&
    browse.recommended.items.length === 0 &&
    browse.daily.items.length === 0 &&
    browse.popular.items.length === 0 &&
    !browse.recommended.error &&
    !browse.daily.error &&
    !browse.popular.error,
);

onMounted(() => void browse.loadDiscover());
// The tabs settle once /providers answers (or a saved tab turns out disabled).
watch(
  () => [browse.recommendPlatform, browse.dailyPlatform],
  () => void browse.loadDiscover(),
);
</script>

<template>
  <PlaylistView v-if="browse.openPlaylist" />
  <div v-else class="discover">
    <section v-if="browse.fmPlatforms.length && music.allows('fm')" class="block">
      <h4>{{ t("music.personalFm") }}</h4>
      <div class="fm-row">
        <button
          v-for="p in browse.fmPlatforms"
          :key="p"
          class="fm"
          :disabled="music.busy"
          :title="t('music.fmStart', { platform: p })"
          @click="browse.startFm(p)"
        >
          📻 {{ p }}
        </button>
      </div>
    </section>

    <SectionBlock
      :title="t('music.recommended')"
      :section="browse.recommended"
      :source-count="browse.discoverTabs.length"
    >
      <template #tabs>
        <SourceTabs
          :sources="browse.discoverTabs"
          :model-value="browse.recommendPlatform"
          @update:model-value="browse.setSource('recommend', $event)"
        />
      </template>
      <div class="grid">
        <PlaylistCard
          v-for="pl in browse.recommended.items"
          :key="`${pl.platform}:${pl.id}`"
          :playlist="pl"
          @open="browse.open($event, true)"
          @play="browse.playPlaylist($event, true)"
          @queue="browse.queuePlaylist($event)"
        />
      </div>
    </SectionBlock>

    <SectionBlock
      :title="t('music.dailyRecommend')"
      :section="browse.daily"
      :source-count="browse.discoverTabs.length"
    >
      <template #tabs>
        <SourceTabs
          :sources="browse.discoverTabs"
          :model-value="browse.dailyPlatform"
          @update:model-value="browse.setSource('daily', $event)"
        />
      </template>
      <SongRow
        v-for="(s, i) in browse.daily.items"
        :key="`${s.platform}:${s.id}:${i}`"
        :song="s"
        @add="browse.addSong($event)"
        @play-next="music.playNext($event)"
        @play-now="music.playNow($event)"
      />
    </SectionBlock>

    <SectionBlock
      v-if="browse.bilibiliEnabled"
      :title="t('music.bilibiliPopular')"
      :section="browse.popular"
    >
      <SongRow
        v-for="(s, i) in browse.popular.items"
        :key="`bili:${s.id}:${i}`"
        :song="s"
        @add="browse.addSong($event)"
        @play-next="music.playNext($event)"
        @play-now="music.playNow($event)"
      />
    </SectionBlock>

    <p v-if="allEmpty" class="hint">{{ t("music.discoverEmpty") }}</p>
  </div>
</template>

<style scoped>
.discover {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
h4 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.fm-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.fm {
  font-size: 12px;
  padding: 4px 10px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 10px;
}
.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-dim);
}
</style>
