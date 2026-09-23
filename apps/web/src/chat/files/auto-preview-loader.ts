/**
 * Small pictures shared in chat loading by themselves, so they read as
 * stickers instead of file cards.
 *
 * What is fetched and when:
 *  - only `ts3file://` cards, and only the ones auto-preview.ts allows (the
 *    setting is on, a raster type, a known size at or under the limit);
 *  - only while the card is actually on screen: an IntersectionObserver whose
 *    root is the conversation's scroller, so a panel nobody has open (it has
 *    no size) and history being scrolled past never fetch anything;
 *  - one at a time for the whole page, so auto-loads never hold more than one
 *    of the session's download slots and what the user clicks always has one;
 *  - never more than the rate in auto-preview.ts; past it the card is left as
 *    it was, with its Preview button;
 *  - never a password prompt: a channel whose password this page does not
 *    know stays click-to-load.
 *
 * A card that has been decided about carries `data-ft-auto`, so nothing is
 * reconsidered and a failure is never retried: "1" while it loads and once it
 * is a sticker, "off" when this card is click-to-load after all.
 */
import { ftNameOf } from "@jinz/protocol";
import { watch, type Ref } from "vue";
import { useChatSettingsStore } from "../../stores/chatSettings";
import { useTsStore } from "../../stores/ts";
import { readCard, type CardFile } from "./card";
import { passwordPlan } from "./card-password";
import { autoPreviewable, createAutoPreviewRate } from "./auto-preview";
import { cachedPreview, fetchPreview } from "./previews";
import { showSticker } from "./sticker";

/** One line for the whole page: every conversation's auto-loads share it. */
const rate = createAutoPreviewRate();
const visible = new Set<HTMLElement>();
let running = false;

/** The password for this file's channel, or null when asking would take a prompt. */
function quietPassword(file: CardFile): string | undefined | null {
  const ts = useTsStore();
  const plan = passwordPlan(ts.channels.get(file.cid), ts.channelPasswordFor(file.cid));
  return plan.kind === "use" ? plan.password : null;
}

/** The next card on screen that may still become a sticker. */
function pick(enabled: boolean): { card: HTMLElement; file: CardFile } | null {
  for (const card of visible) {
    if (!card.isConnected) {
      visible.delete(card);
      continue;
    }
    // Decided about already, or the user is loading it by hand right now.
    if (card.dataset.ftAuto || card.dataset.ftBusy) continue;
    const file = readCard(card.dataset);
    if (!file) continue;
    const name = ftNameOf(file.path);
    if (autoPreviewable({ enabled, name, size: file.size })) return { card, file };
  }
  return null;
}

async function load(card: HTMLElement, file: CardFile): Promise<void> {
  const name = ftNameOf(file.path);
  const cached = cachedPreview(file);
  // Already here (another card of the same picture, or our own upload): free.
  if (cached) {
    card.dataset.ftAuto = "1";
    if (!(await showSticker(card, name, cached))) card.dataset.ftAuto = "off";
    return;
  }
  const cpw = quietPassword(file);
  if (cpw === null || !rate.take(Date.now())) {
    card.dataset.ftAuto = "off";
    return;
  }
  card.dataset.ftAuto = "1";
  try {
    const url = await fetchPreview(file, cpw);
    // Gone from the log, or previewed by hand, while the bytes were on their way.
    if (!card.isConnected || card.querySelector(".bb-file-preview")) return;
    if (!(await showSticker(card, name, url))) card.dataset.ftAuto = "off";
  } catch {
    // The card keeps its buttons, so the user can still try it by hand.
    card.dataset.ftAuto = "off";
  }
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // Nobody is looking at a tab in the background; the cards wait.
    while (!document.hidden) {
      const next = pick(useChatSettingsStore().settings.autoImages);
      if (!next) break;
      await load(next.card, next.file);
    }
  } finally {
    running = false;
  }
}

/**
 * Loads the stickers of the cards inside `scroller` while they are on screen.
 * Meant for a chat panel's `onMounted`/`onUnmounted`; returns the teardown.
 */
export function watchStickers(scroller: Ref<HTMLElement | null>): () => void {
  let io: IntersectionObserver | null = null;
  let mo: MutationObserver | null = null;
  const seen = new WeakSet<Element>();

  function scan(root: HTMLElement): void {
    for (const card of root.querySelectorAll<HTMLElement>(".bb-file[data-ft-cid]")) {
      if (seen.has(card) || card.dataset.ftAuto) continue;
      seen.add(card);
      io?.observe(card);
    }
  }

  const stop = watch(
    scroller,
    (root, _old, onCleanup) => {
      if (!root) return;
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            const card = e.target as HTMLElement;
            if (e.isIntersecting) visible.add(card);
            else visible.delete(card);
          }
          void pump();
        },
        { root },
      );
      // `v-html` replaces whole messages, so new cards arrive without Vue's help.
      mo = new MutationObserver(() => scan(root));
      mo.observe(root, { childList: true, subtree: true });
      scan(root);
      onCleanup(() => {
        io?.disconnect();
        mo?.disconnect();
        io = null;
        mo = null;
      });
    },
    { immediate: true },
  );

  // Turning the setting on should show what is already on screen.
  const stopSetting = watch(
    () => useChatSettingsStore().settings.autoImages,
    () => void pump(),
  );

  // Coming back to the tab picks up where `document.hidden` stopped pump.
  const onShown = (): void => void pump();
  document.addEventListener("visibilitychange", onShown);

  return () => {
    stop();
    stopSetting();
    document.removeEventListener("visibilitychange", onShown);
    io?.disconnect();
    mo?.disconnect();
  };
}
