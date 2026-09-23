<script setup lang="ts">
/**
 * 音乐库 — the playlists and stars of the account the *bot* is signed in with.
 *
 * The hub holds one session with the bot, so this is shared by everyone in the
 * channel rather than being each visitor's own library; the empty state says so.
 *
 * The bot has one account per platform, so 我的歌单 and 我的收藏 each carry the
 * same 网易云 / QQ音乐 / 酷狗 switch the bot's own pages have, instead of showing
 * whichever platform the current song happened to come from. 最近播放 has no
 * switch: it is the player's own history, which mixes every source by nature.
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
 * True once every section answered and nothing at all came back. With source
 * tabs on screen each section says so itself, so the shared hint stays away.
 */
const nothingAtAll = computed(
  () =>
    browse.libraryTabs.length < 2 &&
    !browse.userPlaylists.loading &&
    !browse.favorites.loading &&
    !browse.historyLoading &&
    browse.userPlaylists.items.length === 0 &&
    browse.favorites.items.length === 0 &&
    browse.recent.length === 0,
);

onMounted(() => void browse.loadLibrary());
// 我的收藏 arrives for every platform at once, so only 我的歌单 reloads on a
// switch; the tabs also settle once /providers answers.
watch(
  () => browse.playlistsPlatform,
  () => void browse.loadLibrary(),
);
</script>

<template>
  <PlaylistView v-if="browse.openPlaylist" />
  <div v-else class="library">
    <SectionBlock
      :title="t('music.myFavorites')"
      :section="browse.favorites"
      :empty-text="t('music.sourceEmpty')"
      :visible-count="browse.starred.length"
      :source-count="browse.libraryTabs.length"
    >
      <template #tabs>
        <SourceTabs
          :sources="browse.libraryTabs"
          :model-value="browse.favoritesPlatform"
          @update:model-value="browse.setSource('favorites', $event)"
        />
      </template>
      <div class="grid">
        <PlaylistCard
          v-for="pl in browse.starred"
          :key="`fav:${pl.platform}:${pl.id}`"
          :playlist="pl"
          @open="browse.open($event)"
          @play="browse.playPlaylist($event)"
          @queue="browse.queuePlaylist($event)"
        />
      </div>
    </SectionBlock>

    <SectionBlock
      :title="t('music.myPlaylists')"
      :section="browse.userPlaylists"
      :empty-text="t('music.sourceEmpty')"
      :source-count="browse.libraryTabs.length"
    >
      <template #tabs>
        <SourceTabs
          :sources="browse.libraryTabs"
          :model-value="browse.playlistsPlatform"
          @update:model-value="browse.setSource('playlists', $event)"
        />
      </template>
      <div class="grid">
        <PlaylistCard
          v-for="pl in browse.userPlaylists.items"
          :key="`own:${pl.platform}:${pl.id}`"
          :playlist="pl"
          @open="browse.open($event)"
          @play="browse.playPlaylist($event)"
          @queue="browse.queuePlaylist($event)"
        />
      </div>
    </SectionBlock>

    <section class="block">
      <h4>{{ t("music.recentlyPlayed") }}</h4>
      <p v-if="browse.historyLoading" class="hint">{{ t("music.loading") }}</p>
      <p v-else-if="browse.historyError" class="hint error">{{ browse.historyError }}</p>
      <p v-else-if="browse.recent.length === 0" class="hint">{{ t("music.historyEmpty") }}</p>
      <SongRow
        v-for="(s, i) in browse.recent"
        :key="`recent:${s.platform}:${s.id}:${i}`"
        :song="s"
        show-requester
        @add="browse.addSong($event)"
        @play-next="music.playNext($event)"
        @play-now="music.playNow($event)"
      />
    </section>

    <p v-if="nothingAtAll" class="hint">{{ t("music.libraryEmpty") }}</p>
  </div>
</template>

<style scoped>
.library {
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
.hint.error {
  color: var(--danger);
}
</style>
