import { computed, watch } from "vue";
import { locale, t } from "../i18n";
import { useTsStore } from "../stores/ts";
import { useMusicStore } from "../stores/music";
import { useRtcStore } from "../stores/rtc";
import { useFileBrowserStore } from "../stores/fileBrowser";
import { conversationName } from "../ts/conversationName";
import { CHAT_PREFIX, WINDOW_META, windowPanelId, type WindowId } from "./windowMeta";
import type { Desktop } from "./useDesktop";

/**
 * The windows the client opens by itself: a conversation you are sent a message
 * in, the video when someone shares, the music panel when a bot answers.
 *
 * A window opened in the background opens minimised — it appears in the taskbar
 * without a window jumping onto the desktop mid-sentence.
 */
export function useAutoWindows(desktop: Desktop): {
  chatTitle(conv: string): string;
  titleOf(id: WindowId): string;
  openWindow(id: WindowId): void;
  openConversation(conv: string, activate: boolean): void;
  refreshChatTitles(): void;
} {
  const ts = useTsStore();
  const music = useMusicStore();
  const rtc = useRtcStore();
  const fileBrowser = useFileBrowserStore();

  function chatTitle(conv: string): string {
    const name = conversationName(conv, {
      channelName: (id) => ts.channels.get(id)?.name,
      clientName: (id) => ts.clients.get(id)?.nickname,
    });
    const unread = ts.unread.get(conv) ?? 0;
    return unread ? `${name} (${unread})` : name;
  }

  function titleOf(id: WindowId): string {
    return id === "chat" ? chatTitle("server") : t(WINDOW_META[id].key);
  }

  /** Opens (or raises) a conversation's window. */
  function openConversation(conv: string, activate: boolean): void {
    const panelId = CHAT_PREFIX + conv;
    const live = desktop.api.value;
    if (!live) return;
    if (live.getPanel(panelId)) {
      if (activate) desktop.reveal(panelId);
      return;
    }
    desktop.openWindow(
      panelId,
      { component: "chat", title: chatTitle(conv), params: { conversation: conv } },
      { background: !activate },
    );
  }

  /** Opens (or raises) one of the desktop's windows. */
  function openWindow(id: WindowId): void {
    const panelId = windowPanelId(id);
    if (id === "chat") {
      openConversation("server", true);
      return;
    }
    desktop.openWindow(panelId, { component: id, title: titleOf(id) });
  }

  function refreshChatTitles(): void {
    const live = desktop.api.value;
    if (!live) return;
    for (const p of live.panels) {
      if (!p.id.startsWith(CHAT_PREFIX)) continue;
      const title = chatTitle(p.id.slice(CHAT_PREFIX.length));
      if (p.title !== title) p.setTitle(title);
    }
  }

  /** Static windows are titled once at creation, so retitle on a language change. */
  watch(locale, () => {
    const live = desktop.api.value;
    if (!live) return;
    for (const id of ["tree", "video", "info", "music", "apps", "sounds", "files"] as const) {
      live.getPanel(windowPanelId(id))?.setTitle(t(WINDOW_META[id].key));
    }
    refreshChatTitles();
  });

  watch(
    () => ts.activeConversation,
    (conv) => {
      openConversation(conv, true);
      refreshChatTitles();
    },
  );
  watch(
    () => ts.messages.length,
    () => {
      const last = ts.messages.at(-1);
      if (last && !last.self) openConversation(last.conversation, false);
      refreshChatTitles();
    },
  );
  watch(
    () => [...ts.unread.entries()].map(([k, v]) => `${k}=${v}`).join(","),
    () => refreshChatTitles(),
  );
  // Like TS3, open the chat of the channel you are in, in the background.
  watch(
    () => ts.selfChannel?.id,
    (id) => {
      if (id && ts.connState === "connected") openConversation(`channel:${id}`, false);
    },
  );

  // Someone started sharing, or the user asked to watch.
  watch(
    () => rtc.revealTick,
    () => {
      if (ts.features.video) openWindow("video");
    },
  );

  const wantMusic = computed(
    () => ts.features.music && (music.available || !!ts.profile.musicBot.trim()),
  );
  // The bot usually only answers after the desktop was built.
  watch(
    () => music.available,
    (on) => {
      if (on && wantMusic.value) openWindow("music");
    },
  );

  // "Browse files…" in a channel menu; the phone shell opens its sheet on the
  // same signal.
  watch(
    () => fileBrowser.openTick,
    () => openWindow("files"),
  );

  return { chatTitle, titleOf, openWindow, openConversation, refreshChatTitles };
}
