/**
 * The source tabs above 推荐歌单 / 每日推荐 and above 我的歌单 / 我的收藏, the way
 * the bot's own pages have them: each section picks its platform on its own,
 * and remembers it.
 *
 * Pure module apart from the two storage helpers, which swallow every failure
 * (private windows, blocked storage) and fall back to the default.
 */

/**
 * Platforms with editor's picks, daily songs and a signed-in account's own
 * playlists, in the order the bot lists them. The same three serve 发现 and
 * 音乐库, because they are exactly the providers the bot can log in to.
 */
export const DISCOVER_SOURCES = ["netease", "qq", "kugou"] as const;

/** Every heading that carries its own platform switch. */
export type SourceSection = "recommend" | "daily" | "playlists" | "favorites";

/** The switchable platforms this bot has enabled; all of them before /providers answers. */
export function discoverSources(enabled: readonly string[]): string[] {
  if (enabled.length === 0) return [...DISCOVER_SOURCES];
  return DISCOVER_SOURCES.filter((p) => enabled.includes(p));
}

/**
 * The tab to show: the saved choice while it is still offered, else the
 * browse platform when it is one of the tabs, else the first tab.
 */
export function pickSource(
  saved: string | null,
  available: readonly string[],
  preferred: string,
): string | null {
  if (saved && available.includes(saved)) return saved;
  if (available.includes(preferred)) return preferred;
  return available[0] ?? null;
}

/** Named after 发现, where the tabs started; kept so saved choices survive. */
const KEY = "jinz.music.discoverSources";

type Saved = Partial<Record<SourceSection, string>>;

function readAll(storage: Pick<Storage, "getItem">): Saved {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? "{}");
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Saved;
  } catch {
    return {};
  }
}

export function loadSource(
  section: SourceSection,
  storage: Pick<Storage, "getItem"> = localStorage,
): string | null {
  try {
    const v = readAll(storage)[section];
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}

export function saveSource(
  section: SourceSection,
  platform: string,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): void {
  try {
    storage.setItem(KEY, JSON.stringify({ ...readAll(storage), [section]: platform }));
  } catch {
    /* storage unavailable: the choice just lasts for this page */
  }
}

/** How a tab is labelled; the platform id itself for anything unknown. */
export const SOURCE_LABEL_KEYS = {
  netease: "music.sourceNetease",
  qq: "music.sourceQq",
  kugou: "music.sourceKugou",
} as const;
