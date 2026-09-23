/**
 * Fetches the offline message list once per connect and, when some are
 * unread, says so once in the server chat. Looks again when the user comes
 * back to the tab after a while (ts/inbox-recheck.ts), saying so only when
 * the unread count went up. Called once from App.vue's setup, so it runs for
 * the whole session.
 */
import { onScopeDispose, watch } from "vue";
import { useTsStore } from "../../stores/ts";
import { useInboxStore } from "../../stores/inbox";
import { useI18n } from "../../i18n";

export function useInboxOnConnect(): void {
  const ts = useTsStore();
  const inbox = useInboxStore();
  const { t } = useI18n();

  function announce(before: number): void {
    // The connection may have dropped while we asked.
    if (ts.connState === "connected" && inbox.unread > before) {
      ts.pushEvent(t("admin.inbox.unreadEvent", { n: inbox.unread }));
    }
  }

  async function onBack(): Promise<void> {
    if (ts.connState !== "connected" || !inbox.recheckDue()) return;
    const before = inbox.unread;
    try {
      await inbox.refresh();
    } catch {
      return; // A busy hub or a lost link; the next return to the tab tries again.
    }
    announce(before);
  }

  const onVisibility = (): void => {
    if (document.visibilityState === "hidden") inbox.noteAway();
    else void onBack();
  };
  const onBlur = (): void => inbox.noteAway();
  const onFocus = (): void => void onBack();
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);
  onScopeDispose(() => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("focus", onFocus);
  });

  watch(
    () => ts.connState,
    async (state, before) => {
      if (state !== "connected") {
        inbox.reset();
        return;
      }
      if (before === "connected") return;
      try {
        await inbox.refresh();
      } catch {
        // Nothing to announce; the inbox window shows the error when opened.
        return;
      }
      announce(0);
    },
    { immediate: true },
  );
}
