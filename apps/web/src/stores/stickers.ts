/**
 * Stickers: the hub's shared set and this identity's personal one, plus the
 * picker's own bits (search, recently used) and sending one into a chat.
 *
 * Both sets are the hub's: fetched on connect, then kept current by
 * `stickers.updated` pushes — the shared one whenever anyone changes it, the
 * personal one whenever this identity does, on any of their devices. Nothing
 * about a sticker lives in the browser except which ones this user reached
 * for last, which is a per-device convenience and stays in localStorage.
 *
 * Sending is in stickers/send.ts: it puts the picture in the channel (once)
 * and sends the ordinary chat-file message, so native TeamSpeak clients see
 * it too.
 */
import { computed, ref, shallowRef, watch } from "vue";
import { defineStore } from "pinia";
import {
  normalizeStickerName,
  stickerNameFromFile,
  type ServerMessage,
  type Sticker,
  type StickerPack,
  type StickerScope,
  type StickerSet,
} from "@jinz/protocol";
import { hub } from "../ts/hub";
import { assetToken, hasAssetToken } from "../ts/asset-token";
import { t } from "../i18n";
import {
  SNIFF_BYTES,
  checkStickerFile,
  checkStickerPixels,
  groupStickers,
  matchesSticker,
  pruneRecent,
  pushRecent,
  recentStickers,
  type StickerGroup,
  type StickerUploadError,
} from "../stickers/rules";
import { createStickerSender, type StickerSendError } from "../stickers/send";
import { useTsStore } from "./ts";
import { useTransfersStore } from "./transfers";
import { useChatUploadsStore } from "./chatUploads";

const RECENT_KEY = "jinz.stickers.recent";

/** Why a send did not go out, as the user reads it. */
const SEND_ERRORS = {
  noChannel: "stickers.errNoChannel",
  movedAway: "stickers.errMovedAway",
  tooLong: "stickers.errTooLong",
  failed: "stickers.errSendFailed",
} as const satisfies Record<StickerSendError, string>;

const emptySet = (scope: StickerScope): StickerSet => ({ scope, packs: [], stickers: [] });

/** What each refusal from the hub means for the user. */
const UPLOAD_ERRORS: Readonly<Record<number, StickerUploadError>> = {
  400: "name",
  403: "failed",
  409: "full",
  413: "tooBig",
  415: "type",
};

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export const useStickersStore = defineStore("stickers", () => {
  const ts = useTsStore();
  const shared = shallowRef<StickerSet>(emptySet("shared"));
  const personal = shallowRef<StickerSet>(emptySet("personal"));
  const loaded = ref(false);
  const recent = shallowRef<string[]>(loadRecent());
  /** Why the last send did not go out; cleared when the next one starts. */
  const sendError = ref<StickerSendError | null>(null);
  const sending = ref(false);

  const setOf = (scope: StickerScope) => (scope === "shared" ? shared : personal);

  function apply(set: StickerSet): void {
    setOf(set.scope).value = set;
    if (set.scope === "personal") return;
    // A shared sticker that is gone should not linger in "recently used".
    setRecent(pruneRecent(recent.value, [...set.stickers, ...personal.value.stickers]));
  }

  function setRecent(next: readonly string[]): void {
    if (next.length === recent.value.length && next.every((id, i) => id === recent.value[i])) {
      return;
    }
    recent.value = [...next];
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent.value));
    } catch {
      // A full or blocked store only costs this convenience.
    }
  }

  const headers = () => ({ "x-session-id": ts.sessionId });

  async function refresh(): Promise<void> {
    try {
      const res = await fetch("/api/stickers", { headers: headers() });
      if (!res.ok) return;
      const body = (await res.json()) as { shared: StickerSet; personal: StickerSet };
      shared.value = body.shared;
      personal.value = body.personal;
      loaded.value = true;
    } catch {
      // Hub unreachable: the sets stay as they were until the next push or connect.
    }
  }

  hub.onMessage((msg: ServerMessage) => {
    if (msg.type === "stickers.updated") apply(msg.set);
  });
  watch(
    () => ts.connState,
    (state) => {
      if (state === "connected") void refresh();
      else if (state === "idle") {
        shared.value = emptySet("shared");
        personal.value = emptySet("personal");
        loaded.value = false;
      }
    },
    { immediate: true },
  );

  /** Every sticker of both scopes, for looking one up by id. */
  const all = computed(() => [...shared.value.stickers, ...personal.value.stickers]);

  const recentlyUsed = computed(() => recentStickers(recent.value, all.value));

  /** One scope's stickers under their packs, "ungrouped" last. */
  function groups(scope: StickerScope, query = ""): StickerGroup[] {
    const set = setOf(scope).value;
    const stickers = query.trim()
      ? set.stickers.filter((s) => matchesSticker(s, query))
      : set.stickers;
    return groupStickers(set.packs, stickers);
  }

  function packsOf(scope: StickerScope): readonly StickerPack[] {
    return setOf(scope).value.packs;
  }

  function countOf(scope: StickerScope): number {
    return setOf(scope).value.stickers.length;
  }

  /** The hub-served picture; null before an asset token arrives. */
  function fileUrl(sticker: Sticker): string | null {
    if (!hasAssetToken.value) return null;
    return `/api/sticker-file/${encodeURIComponent(sticker.hash)}?token=${assetToken()}`;
  }

  /* ----------------------------------------------------------- writing */

  /**
   * Adds `file` to `scope`, in `packId` or ungrouped. Returns why not when it
   * cannot; the picture is measured here because only the page can decode it.
   */
  async function upload(
    scope: StickerScope,
    file: File,
    rawName: string,
    packId: string | null,
  ): Promise<StickerUploadError | null> {
    const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
    const early = checkStickerFile(file.size, head, scope, countOf(scope));
    if (early) return early;
    const name = normalizeStickerName(rawName.trim() ? rawName : stickerNameFromFile(file.name));
    if (!name) return "name";

    const data = await file.arrayBuffer();
    const tooBig = await measure(new Blob([data], { type: file.type }));
    if (tooBig) return tooBig;

    const query = new URLSearchParams({ name });
    if (packId) query.set("pack", packId);
    try {
      const res = await fetch(`/api/stickers/${scope}?${query}`, {
        method: "POST",
        headers: { ...headers(), "content-type": "application/octet-stream" },
        body: data,
      });
      if (!res.ok) return UPLOAD_ERRORS[res.status] ?? "failed";
      // The push may not have arrived yet; the next one is authoritative anyway.
      void refresh();
      return null;
    } catch {
      return "failed";
    }
  }

  /** The pixel cap, or null when the browser cannot decode the picture for us. */
  async function measure(blob: Blob): Promise<StickerUploadError | null> {
    if (typeof createImageBitmap !== "function") return null;
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch {
      // The hub sniffed the same bytes and will judge them; do not block on this.
      return null;
    }
    const problem = checkStickerPixels(bitmap.width, bitmap.height);
    bitmap.close();
    return problem;
  }

  async function write(url: string, init: RequestInit): Promise<boolean> {
    try {
      const res = await fetch(url, { ...init, headers: { ...headers(), ...init.headers } });
      if (res.ok) void refresh();
      return res.ok;
    } catch {
      return false;
    }
  }

  const json = (body: unknown): RequestInit => ({
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  function editSticker(
    scope: StickerScope,
    id: string,
    patch: { name?: string; packId?: string | null },
  ): Promise<boolean> {
    return write(`/api/stickers/${scope}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      ...json(patch),
    });
  }

  function rename(scope: StickerScope, id: string, name: string): Promise<boolean> {
    const clean = normalizeStickerName(name);
    return clean ? editSticker(scope, id, { name: clean }) : Promise.resolve(false);
  }

  function moveTo(scope: StickerScope, id: string, packId: string | null): Promise<boolean> {
    return editSticker(scope, id, { packId });
  }

  function remove(scope: StickerScope, id: string): Promise<boolean> {
    return write(`/api/stickers/${scope}/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  function createPack(scope: StickerScope, name: string): Promise<boolean> {
    const clean = normalizeStickerName(name);
    if (!clean) return Promise.resolve(false);
    return write(`/api/sticker-packs/${scope}`, { method: "POST", ...json({ name: clean }) });
  }

  function renamePack(scope: StickerScope, id: string, name: string): Promise<boolean> {
    const clean = normalizeStickerName(name);
    if (!clean) return Promise.resolve(false);
    return write(`/api/sticker-packs/${scope}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      ...json({ name: clean }),
    });
  }

  /** Deletes a pack; `withStickers` deletes what is in it instead of ungrouping it. */
  function removePack(scope: StickerScope, id: string, withStickers: boolean): Promise<boolean> {
    const what = withStickers ? "delete" : "ungroup";
    return write(`/api/sticker-packs/${scope}/${encodeURIComponent(id)}?stickers=${what}`, {
      method: "DELETE",
    });
  }

  /* ----------------------------------------------------------- sending */

  const sender = createStickerSender({
    channelFor: (conversation) => useChatUploadsStore().channelFor(conversation),
    ensureFolder: (cid, dir) => useChatUploadsStore().ensureFolder(cid, dir),
    listEntries: (cid, dir) => useTransfersStore().listFiles(cid, dir),
    fetchImage: async (sticker) => {
      const url = fileUrl(sticker);
      if (!url) throw new Error("no asset token");
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.blob();
    },
    upload: (cid, dir, file, name) =>
      useTransfersStore().uploadFile(cid, dir, file, { name, origin: "chat" }),
    waitFor: (id) => useTransfersStore().waitFor(id),
    sendText: (conversation, text) => ts.sendText(conversation, text),
    server: () => useChatUploadsStore().server(),
    now: () => new Date(),
  });

  /** Sends `sticker` to `conversation`; false when it did not go out. */
  async function send(conversation: string, sticker: Sticker): Promise<boolean> {
    sendError.value = null;
    sending.value = true;
    try {
      const result = await sender.send(conversation, sticker);
      if (!result.ok) {
        sendError.value = result.error ?? "failed";
        return false;
      }
      setRecent(pushRecent(recent.value, sticker.id));
      return true;
    } finally {
      sending.value = false;
    }
  }

  /** The last send's problem, translated, or "" when there was none. */
  const sendMessage = computed(() => (sendError.value ? t(SEND_ERRORS[sendError.value]) : ""));

  return {
    shared,
    personal,
    loaded,
    all,
    recentlyUsed,
    sending,
    sendError,
    sendMessage,
    groups,
    packsOf,
    countOf,
    fileUrl,
    refresh,
    upload,
    rename,
    moveTo,
    remove,
    createPack,
    renamePack,
    removePack,
    send,
  };
});
