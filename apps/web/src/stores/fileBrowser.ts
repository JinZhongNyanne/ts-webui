/**
 * Where the file browser (M3) is looking, shared by the dock window and the
 * phone sheet so both show the same folder. Channel passwords are the ts
 * store's (ts/channel-passwords.ts), shared with chat's file cards.
 *
 *   const fb = useFileBrowserStore();
 *   fb.open("12");            // the channel menu's "Browse files…"
 *   watch(() => fb.openTick, reveal the window);
 *
 * `channelId` null means "the channel I am in".
 */
import { computed, shallowRef, watch } from "vue";
import { defineStore } from "pinia";
import { useTsStore } from "./ts";

export interface FileBrowserContext {
  selfChannelId(): string | null;
  /** Registers what to do when the TeamSpeak session ends. */
  onSessionGone(fn: () => void): void;
}

export function createFileBrowserStore(ctx: FileBrowserContext) {
  return () => {
    const chosen = shallowRef<string | null>(null);
    const path = shallowRef("/");
    /** Bumped by open(): the window (or phone sheet) comes forward. */
    const openTick = shallowRef(0);

    const channelId = computed(() => chosen.value ?? ctx.selfChannelId());

    /** Shows channel `cid` (or keeps the current one) at its root, and asks for the window. */
    function open(cid?: string): void {
      if (cid !== undefined && cid !== channelId.value) setChannel(cid);
      openTick.value++;
    }

    /** Shows channel `cid` at its root; null goes back to following my own channel. */
    function setChannel(cid: string | null): void {
      chosen.value = cid;
      path.value = "/";
    }

    function setPath(next: string): void {
      path.value = next;
    }

    ctx.onSessionGone(() => {
      chosen.value = null;
      path.value = "/";
    });

    return {
      channelId,
      path: computed(() => path.value),
      openTick: computed(() => openTick.value),
      open,
      setChannel,
      setPath,
    };
  };
}

export const useFileBrowserStore = defineStore("fileBrowser", () => {
  const ts = useTsStore();
  return createFileBrowserStore({
    selfChannelId: () => ts.selfChannel?.id ?? null,
    onSessionGone: (fn) =>
      watch(
        () => ts.connState,
        (state) => state !== "connected" && fn(),
      ),
  })();
});
