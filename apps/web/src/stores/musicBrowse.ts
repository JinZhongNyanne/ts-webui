/**
 * State behind the panel's browse tabs — discover, library, history and the
 * playlist a user drilled into.
 *
 * Kept apart from `stores/music.ts`, which is about the player itself: this one
 * only reads catalogue data and hands whatever the user picked back to the
 * player store's action helpers, so failures surface the same way they do for
 * the transport controls.
 */
import { computed, reactive, ref } from "vue";
import { defineStore } from "pinia";
import type { MusicSong } from "@jinz/protocol";
import { musicApi } from "../music/api";
import {
  isPlayableSong,
  parseFavorites,
  parseHistory,
  parsePlaylistDetail,
  parsePlaylists,
  parseSongs,
  playlistsFrom,
  type MusicHistoryEntry,
  type MusicPlaylist,
  type MusicPlaylistDetail,
} from "../music/browse-types";
import {
  emptySection,
  fillSection,
  isStale,
  isUnsupported,
  orphanLoads,
  type Section,
} from "../music/section";
import {
  discoverSources,
  loadSource,
  pickSource,
  saveSource,
  type SourceSection,
} from "../music/discover-sources";
import { useMusicStore } from "./music";

/** Platforms whose providers offer a personal-radio stream. */
const FM_PLATFORMS = ["netease", "qq", "kugou", "jellyfin"];

/**
 * The cache key for 我的收藏. `/favorites` is not per-source — it answers for
 * every platform in one list — so it is loaded once and then filtered.
 */
const FAVORITES_SOURCE = "all";

/** How many history rows the library tab shows under 最近播放. */
export const RECENT_LIMIT = 10;

export const useMusicBrowseStore = defineStore("musicBrowse", () => {
  const music = useMusicStore();

  const recommended = reactive(emptySection<MusicPlaylist>()) as Section<MusicPlaylist>;
  const daily = reactive(emptySection<MusicSong>()) as Section<MusicSong>;
  const popular = reactive(emptySection<MusicSong>()) as Section<MusicSong>;
  const userPlaylists = reactive(emptySection<MusicPlaylist>()) as Section<MusicPlaylist>;
  const favorites = reactive(emptySection<MusicPlaylist>()) as Section<MusicPlaylist>;

  const history = ref<MusicHistoryEntry[]>([]);
  const historyLoading = ref(false);
  const historyError = ref<string | null>(null);
  const historyLoaded = ref(false);

  /** The playlist the user opened, or null while the tab shows its own list. */
  const openPlaylist = ref<MusicPlaylist | null>(null);
  /** Whether that playlist came from the recommendations, which play in order. */
  const openIsRecommended = ref(false);
  const playlistDetail = ref<MusicPlaylistDetail | null>(null);
  const playlistSongs = ref<MusicSong[]>([]);
  const playlistLoading = ref(false);
  const playlistError = ref<string | null>(null);

  /** The browse tabs follow the same source picker the search tab uses. */
  const platform = computed(() => {
    const p = music.platform;
    // "all" is a search-only choice; browsing always needs one real provider.
    if (!p || p === "all") return music.defaultProvider || "netease";
    return p;
  });

  /** Before /providers answers we know nothing, so assume the source is there. */
  const enabled = (p: string): boolean =>
    music.providers.length === 0 || music.providers.includes(p);

  const fmPlatforms = computed(() => FM_PLATFORMS.filter(enabled));

  /** The source tabs above 推荐歌单 and 每日推荐; each section picks its own. */
  const discoverTabs = computed(() => discoverSources(music.providers));
  /**
   * 我的歌单 and 我的收藏 offer the same tabs: the bot keeps an account per
   * platform, so its library is as many libraries as it has logins, which is
   * what the bot's own 音乐库 page shows.
   */
  const libraryTabs = discoverTabs;
  const savedSource = reactive<Record<SourceSection, string | null>>({
    recommend: loadSource("recommend"),
    daily: loadSource("daily"),
    playlists: loadSource("playlists"),
    favorites: loadSource("favorites"),
  });
  const recommendPlatform = computed(() =>
    pickSource(savedSource.recommend, discoverTabs.value, platform.value),
  );
  const dailyPlatform = computed(() =>
    pickSource(savedSource.daily, discoverTabs.value, platform.value),
  );
  const playlistsPlatform = computed(() =>
    pickSource(savedSource.playlists, libraryTabs.value, platform.value),
  );
  const favoritesPlatform = computed(() =>
    pickSource(savedSource.favorites, libraryTabs.value, platform.value),
  );
  /** 我的收藏 for the platform its tab shows; the list itself holds them all. */
  const starred = computed(() => playlistsFrom(favorites.items, favoritesPlatform.value));

  function setSource(section: SourceSection, p: string): void {
    savedSource[section] = p;
    saveSource(section, p);
  }
  const bilibiliEnabled = computed(() => enabled("bilibili"));

  const describe = (err: unknown) => music.describeMusicError(err);
  const recent = computed(() => history.value.slice(0, RECENT_LIMIT));

  /** Loads the discover tab, skipping lists already read for their source. */
  async function loadDiscover(force = false): Promise<void> {
    const rp = recommendPlatform.value;
    const dp = dailyPlatform.value;
    await Promise.all([
      rp && isStale(recommended, rp, force)
        ? fillSection(
            recommended,
            rp,
            () => musicApi.recommendPlaylists(rp).then((r) => parsePlaylists(r, rp)),
            describe,
          )
        : Promise.resolve(),
      dp && isStale(daily, dp, force)
        ? fillSection(
            daily,
            dp,
            () => musicApi.recommendSongs(dp).then((r) => parseSongs(r, dp)),
            describe,
          )
        : Promise.resolve(),
      // Bilibili's list has no source tab: it is always Bilibili.
      bilibiliEnabled.value && isStale(popular, "bilibili", force)
        ? fillSection(
            popular,
            "bilibili",
            () => musicApi.bilibiliPopular().then((r) => parseSongs(r, "bilibili")),
            describe,
          )
        : Promise.resolve(),
    ]);
  }

  /**
   * Loads the library tab: the bot account's playlists, its stars and recents.
   *
   * 我的歌单 follows its own source tab, falling back to the browse platform for
   * a bot that runs none of the switchable providers (a Jellyfin-only one, say),
   * so that library still loads.
   */
  async function loadLibrary(force = false): Promise<void> {
    const p = playlistsPlatform.value ?? platform.value;
    await Promise.all([
      isStale(userPlaylists, p, force)
        ? fillSection(
            userPlaylists,
            p,
            () => musicApi.userPlaylists(p).then((r) => parsePlaylists(r, p)),
            describe,
          )
        : Promise.resolve(),
      // Favourites are not per-source, so they load once and are filtered after.
      force || favorites.loadedFor === null
        ? fillSection(
            favorites,
            FAVORITES_SOURCE,
            () => musicApi.favorites().then(parseFavorites),
            describe,
          )
        : Promise.resolve(),
      loadHistory(force),
    ]);
  }

  async function loadHistory(force = false): Promise<void> {
    const botId = music.bot?.status.id;
    if (!botId) return;
    if (historyLoaded.value && !force) return;
    historyLoading.value = true;
    historyError.value = null;
    try {
      history.value = parseHistory(await musicApi.history(botId));
      historyLoaded.value = true;
    } catch (err) {
      history.value = [];
      historyError.value = isUnsupported(err) ? null : describe(err);
    } finally {
      historyLoading.value = false;
    }
  }

  /** Opens a playlist card: its songs, and its header when the provider has one. */
  async function open(playlist: MusicPlaylist, recommended = false): Promise<void> {
    openPlaylist.value = playlist;
    openIsRecommended.value = recommended;
    playlistDetail.value = null;
    playlistSongs.value = [];
    playlistError.value = null;
    playlistLoading.value = true;
    const [songs, detail] = await Promise.allSettled([
      musicApi.playlistSongs(playlist.id, playlist.platform),
      musicApi.playlistDetail(playlist.id, playlist.platform),
    ]);
    if (songs.status === "fulfilled") {
      playlistSongs.value = parseSongs(songs.value, playlist.platform);
    } else {
      playlistError.value = describe(songs.reason);
    }
    // The header is decoration; a provider without one must not blank the songs.
    if (detail.status === "fulfilled") playlistDetail.value = parsePlaylistDetail(detail.value);
    playlistLoading.value = false;
  }

  function close(): void {
    openPlaylist.value = null;
    playlistSongs.value = [];
    playlistDetail.value = null;
    playlistError.value = null;
  }

  const needBot = (): string | null => music.bot?.status.id ?? null;

  /**
   * Queues a song from any browse list.
   *
   * A history row has no duration and no url — it is a stored record, not a
   * provider result — so the bot cannot resolve a stream from it. Those are
   * re-queued by id, which makes the bot fetch the provider's own object first.
   */
  function addSong(song: MusicSong): Promise<unknown> {
    if (isPlayableSong(song)) return music.add(song);
    const id = needBot();
    if (!id) return Promise.resolve(undefined);
    return music.run(() => musicApi.addById(id, song.id, song.platform));
  }

  function playPlaylist(playlist: MusicPlaylist, recommended = false): Promise<unknown> {
    const id = needBot();
    if (!id) return Promise.resolve(undefined);
    return music.run(() => musicApi.playPlaylist(id, playlist.id, playlist.platform, recommended));
  }

  function queuePlaylist(playlist: MusicPlaylist): Promise<unknown> {
    const id = needBot();
    if (!id) return Promise.resolve(undefined);
    return music.run(() => musicApi.queuePlaylist(id, playlist.id, playlist.platform));
  }

  function startFm(fmPlatform: string): Promise<unknown> {
    const id = needBot();
    if (!id) return Promise.resolve(undefined);
    return music.run(() => musicApi.startFm(id, fmPlatform));
  }

  /** Drops every cached list; used when the source or the selected bot changes. */
  function reset(): void {
    // Also orphans any load still in flight for the old bot.
    for (const s of [recommended, daily, popular, userPlaylists, favorites]) orphanLoads(s);
    history.value = [];
    historyLoaded.value = false;
    historyError.value = null;
    close();
  }

  return {
    recommended,
    daily,
    popular,
    userPlaylists,
    favorites,
    starred,
    history,
    recent,
    historyLoading,
    historyError,
    openPlaylist,
    openIsRecommended,
    playlistDetail,
    playlistSongs,
    playlistLoading,
    playlistError,
    platform,
    fmPlatforms,
    discoverTabs,
    libraryTabs,
    recommendPlatform,
    dailyPlatform,
    playlistsPlatform,
    favoritesPlatform,
    setSource,
    bilibiliEnabled,
    loadDiscover,
    loadLibrary,
    loadHistory,
    open,
    close,
    addSong,
    playPlaylist,
    queuePlaylist,
    startFm,
    reset,
  };
});
