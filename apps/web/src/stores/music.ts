import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import type { MusicBotSummary, MusicSong } from "@jinz/protocol";
import { hub } from "../ts/hub";
import { musicApi, MusicApiError } from "../music/api";
import { allowsAction, parseBotSession } from "../music/permissions";
import { currentQueueIndex, planQueueJump, type JumpRights } from "../music/queue-jump";
import type { BotSession, MusicAction } from "../music/permissions";
import { useTsStore } from "./ts";
import { t, translateCode } from "../i18n";

export const useMusicStore = defineStore("music", () => {
  const ts = useTsStore();
  const bots = ref<MusicBotSummary[]>([]);
  const available = ref(false);
  const unavailableReason = ref<string | null>(null);
  const selectedBotId = ref<string | null>(localStorage.getItem("jinz.music.bot"));
  const providers = ref<string[]>([]);
  const defaultProvider = ref("");
  const platform = ref<string>(localStorage.getItem("jinz.music.platform") ?? "");
  const query = ref("");
  const results = ref<MusicSong[]>([]);
  const searching = ref(false);
  const error = ref<string | null>(null);
  const busy = ref(false);
  const localElapsed = ref(0);
  /** What the bot says this session may do; null until asked, or if asking failed. */
  const session = ref<BotSession | null>(null);

  const bot = computed(
    () => bots.value.find((b) => b.status.id === selectedBotId.value) ?? bots.value[0] ?? null,
  );
  const status = computed(() => bot.value?.status ?? null);
  const queue = computed(() => bot.value?.queue ?? []);
  /** Personal FM or a recommendation, which the hub keeps in sequential mode. */
  const radio = computed(() => bot.value?.radio ?? null);
  /** The queue row that is playing; null when unknown or ambiguous. */
  const currentIndex = computed(() => currentQueueIndex(queue.value, status.value?.currentSong));

  /** The TS client that is the bot, matched by nickname (needs config access) or by name. */
  const botClient = computed(() => {
    const b = bot.value;
    if (!b) return null;
    const names = new Set([b.nickname, b.status.name].filter(Boolean));
    for (const c of ts.clients.values()) if (names.has(c.nickname)) return c;
    return null;
  });

  hub.onMessage((msg) => {
    if (msg.type === "music.state") {
      bots.value = msg.bots;
      available.value = true;
      unavailableReason.value = null;
      if (!selectedBotId.value && msg.bots[0]) selectedBotId.value = msg.bots[0].status.id;
    } else if (msg.type === "music.unavailable") {
      available.value = false;
      unavailableReason.value = translateCode(msg.reason);
    }
  });

  watch(selectedBotId, (id) => {
    if (id) localStorage.setItem("jinz.music.bot", id);
  });
  watch(platform, (p) => localStorage.setItem("jinz.music.platform", p));

  // Smooth progress between state pushes.
  let ticker: number | null = null;
  watch(
    () => [status.value?.elapsed, status.value?.playing, status.value?.currentSong?.id] as const,
    ([elapsed, playing]) => {
      localElapsed.value = elapsed ?? 0;
      if (ticker) window.clearInterval(ticker);
      ticker = null;
      if (playing) {
        let last = performance.now();
        ticker = window.setInterval(() => {
          const now = performance.now();
          localElapsed.value += (now - last) / 1000;
          last = now;
        }, 500);
      }
    },
    { immediate: true },
  );

  /**
   * The bot answers 403 for anything the caller's role may not do — guests
   * typically may queue but not stop or skip. Its bare "forbidden" means
   * nothing to a user, so say what actually happened.
   */
  function describeMusicError(err: unknown): string {
    if (err instanceof MusicApiError) {
      if (err.status === 403) return t("music.forbidden");
      if (err.status === 503) return t("music.unavailable");
      if (err.status === 409) return translateCode(err.message);
      return err.message;
    }
    return err instanceof Error ? err.message : String(err);
  }

  /**
   * Runs one bot action: clears the last error, marks the panel busy, and
   * re-reads the queue afterwards. Shared with the browse store so every
   * control in the panel reports failures the same way.
   */
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    error.value = null;
    busy.value = true;
    try {
      const out = await fn();
      // The bot applies the change before answering, so read it straight back.
      void refreshQueue();
      return out;
    } catch (err) {
      error.value = describeMusicError(err);
      return undefined;
    } finally {
      busy.value = false;
    }
  }

  /** Older bot builds have no /providers route; fall back to the bot's default platform silently. */
  async function loadProviders(): Promise<void> {
    try {
      const p = await musicApi.providers();
      providers.value = p.enabled;
      defaultProvider.value = p.default;
      if (!platform.value || !p.enabled.includes(platform.value)) platform.value = p.default;
    } catch {
      providers.value = [];
      platform.value = "";
    }
  }

  /**
   * Reads what the bot lets this session do. A bot without that route answers
   * 404, and a hub whose allow-list predates it answers 403; either way we
   * simply cannot know, so stay silent and let `allows()` permit everything.
   * Anything else is a real failure and belongs in the visible error.
   */
  async function loadSession(): Promise<void> {
    try {
      session.value = parseBotSession(await musicApi.me());
    } catch (err) {
      session.value = null;
      if (err instanceof MusicApiError && (err.status === 403 || err.status === 404)) return;
      error.value = describeMusicError(err);
    }
  }

  // Ask as soon as the bot shows up, again when another bot is selected or the
  // bridge reconnects, and forget the answer while there is no bot at all.
  watch(
    () => [available.value, selectedBotId.value] as const,
    ([ok]) => {
      if (ok) void loadSession();
      else session.value = null;
    },
    { immediate: true },
  );

  /** May this session use that control? Unknown rights mean "yes" — see permissions.ts. */
  const allows = (action: MusicAction): boolean => allowsAction(session.value, action);

  async function search(): Promise<void> {
    const q = query.value.trim();
    if (!q) return;
    searching.value = true;
    try {
      const r = await run(() =>
        platform.value === "all"
          ? musicApi.searchAll(q)
          : musicApi.search(q, platform.value || undefined),
      );
      results.value = r?.songs ?? [];
    } finally {
      searching.value = false;
    }
  }

  /**
   * Pull the bot's queue and status after we changed something.
   *
   * The bot pushes `stateChange` over its websocket, but only when the player
   * state actually changes: replaying the song that is already playing, or
   * queueing while idle, can leave the pushed state identical while the queue
   * itself has grown. Refreshing after every successful action keeps the list
   * honest no matter what the bot chose to broadcast.
   */
  async function refreshQueue(): Promise<void> {
    const id = bot.value?.status.id;
    if (!id) return;
    try {
      const r = await musicApi.queue(id);
      const status = (r as { status?: MusicBotSummary["status"] }).status;
      bots.value = bots.value.map((b) =>
        b.status.id === id ? { ...b, queue: r.queue ?? [], status: status ?? b.status } : b,
      );
    } catch {
      /* the next push or action will correct it */
    }
  }

  const needBot = (): string | null => {
    const id = bot.value?.status.id ?? null;
    if (!id) error.value = t("music.noBots");
    return id;
  };

  const add = (song: MusicSong) => {
    const id = needBot();
    return id ? run(() => musicApi.addSong(id, song)) : Promise.resolve(undefined);
  };
  const playNow = (song: MusicSong) => {
    const id = needBot();
    return id ? run(() => musicApi.playSong(id, song)) : Promise.resolve(undefined);
  };
  const playNext = (song: MusicSong) => {
    const id = needBot();
    return id ? run(() => musicApi.playNext(id, song)) : Promise.resolve(undefined);
  };
  const control = (
    action: "pause" | "resume" | "next" | "prev" | "stop" | "clear",
  ): Promise<unknown> => {
    const id = needBot();
    return id ? run(() => musicApi[action](id)) : Promise.resolve(undefined);
  };
  const seek = (position: number) => {
    const id = needBot();
    return id
      ? run(() => musicApi.seek(id, Math.max(0, Math.floor(position))))
      : Promise.resolve(undefined);
  };
  const setVolume = (volume: number) => {
    const id = needBot();
    return id ? run(() => musicApi.volume(id, Math.round(volume))) : Promise.resolve(undefined);
  };
  const setMode = (mode: string) => {
    const id = needBot();
    return id ? run(() => musicApi.mode(id, mode)) : Promise.resolve(undefined);
  };
  const jumpRights = (): JumpRights => ({
    playAt: allows("playAt"),
    skip: allows("skip"),
    playNow: allows("playNow"),
    removeClear: allows("removeClear"),
  });
  /** Whether a queue row can be started at all; see queue-jump.ts. */
  const canJump = computed(() => {
    const r = jumpRights();
    return r.playAt || r.playNow || r.skip;
  });
  /**
   * Starts the queue row at `index`. `play-at` needs a capability guests never
   * have, so a guest session plays a copy of the row and drops the original.
   */
  const playAt = (index: number) => {
    const id = needBot();
    const plan = planQueueJump(queue.value, status.value?.currentSong, index, jumpRights());
    if (!id || !plan || plan.kind === "none") return Promise.resolve(undefined);
    if (plan.kind === "playAt") return run(() => musicApi.playAt(id, plan.index));
    if (plan.kind === "next") return run(() => musicApi.next(id));
    return run(async () => {
      const out = await musicApi.playSong(id, plan.song);
      if (plan.removeAt !== null) await musicApi.remove(id, plan.removeAt);
      return out;
    });
  };
  const remove = (index: number) => {
    const id = needBot();
    return id ? run(() => musicApi.remove(id, index)) : Promise.resolve(undefined);
  };

  return {
    bots,
    available,
    unavailableReason,
    selectedBotId,
    providers,
    defaultProvider,
    platform,
    query,
    results,
    searching,
    error,
    busy,
    localElapsed,
    session,
    allows,
    run,
    describeMusicError,
    bot,
    status,
    queue,
    radio,
    currentIndex,
    canJump,
    botClient,
    loadProviders,
    search,
    add,
    playNow,
    playNext,
    control,
    seek,
    setVolume,
    setMode,
    playAt,
    refreshQueue,
    remove,
  };
});
