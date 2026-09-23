import type { MessageKey } from "../i18n";

/**
 * Which windows the desktop has, and how each one shows itself.
 *
 * One table for the desktop icons and the taskbar: they used to be a bar of
 * buttons with a private label table, and the icons would have had to repeat it.
 * Pure data plus feature gating, so it is testable and the mobile shell can
 * share the gating rather than keeping its own copy.
 */

/** A window the desktop has an icon for. `chat` stands for the server chat. */
export type WindowId = "tree" | "apps" | "sounds" | "files" | "video" | "chat" | "info" | "music";

/** The dock panel id behind the chat icon. */
export const SERVER_CHAT_PANEL = "chat:server";
/** Every conversation's panel id starts with this. */
export const CHAT_PREFIX = "chat:";
/** A panel the desktop has no icon for still needs something in the taskbar. */
const FALLBACK_ICON = "▫";

/** Optional windows the connected hub actually offers. */
export interface HubFeatures {
  readonly video: boolean;
  readonly music: boolean;
  /** File transfer: older hubs have none, and then there are no files to browse. */
  readonly files: boolean;
}

/** The icon and the title key of each window. */
export const WINDOW_META: Record<WindowId, { readonly icon: string; readonly key: MessageKey }> = {
  tree: { icon: "☰", key: "tree.title" },
  apps: { icon: "🧩", key: "apps.title" },
  sounds: { icon: "🔊", key: "sound.title" },
  files: { icon: "📁", key: "fb.title" },
  video: { icon: "🎥", key: "video.title" },
  chat: { icon: "💬", key: "chat.title" },
  info: { icon: "ℹ️", key: "info.title" },
  music: { icon: "🎵", key: "music.title" },
};

/**
 * Desktop icons in display order; optional windows only when the hub offers them.
 *
 * `../mobile/tabs.ts`'s `visibleTabs` derives its own (smaller, differently
 * ordered) tab list from this same function, so `tree`/`chat`/`video`/`music`
 * gate identically on both shells — see that file's doc comment.
 */
export function availableWindows(features: HubFeatures): readonly WindowId[] {
  return [
    "tree",
    "apps",
    "sounds",
    ...(features.files ? (["files"] as const) : []),
    ...(features.video ? (["video"] as const) : []),
    "chat",
    "info",
    ...(features.music ? (["music"] as const) : []),
  ];
}

/** The dock panel id an icon stands for. */
export function windowPanelId(id: WindowId): string {
  return id === "chat" ? SERVER_CHAT_PANEL : id;
}

/** The icon for a live panel, whose id may be any conversation. */
export function iconForPanel(panelId: string): string {
  if (panelId.startsWith(CHAT_PREFIX)) return WINDOW_META.chat.icon;
  return WINDOW_META[panelId as WindowId]?.icon ?? FALLBACK_ICON;
}
