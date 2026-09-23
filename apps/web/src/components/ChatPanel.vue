<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { useTsStore } from "../stores/ts";
import { useChatHistoryStore } from "../stores/chatHistory";
import { renderBBCode } from "../ts/assets";
import { matchesQuery } from "../chat/history";
import { onRichClick, onRichContextMenu, onRichLongPress } from "../chat/richClick";
import { useLongPress } from "../mobile/useLongPress";
import { locale, useI18n } from "../i18n";
import { confirmDialog } from "./ui/confirm";
import "../chat/bbcode.css";
import ClientAvatar from "./client/ClientAvatar.vue";
import ChatUploads from "./chat/ChatUploads.vue";
import { useChatFileInput } from "../chat/files/useChatFileInput";
import { watchStickers } from "../chat/files/auto-preview-loader";
import StickerPicker from "./chat/StickerPicker.vue";
import { usePopoverAnchor } from "../composables/usePopoverAnchor";

/**
 * One conversation per panel. Each conversation lives in its own dock panel so
 * the user can drag it into a separate group or float it (like TS3 chat tabs).
 *
 * Above this session's messages sits the conversation's stored history (see
 * `stores/chatHistory.ts`), dimmed and set off by a divider.
 *
 * Small pictures shared in chat load themselves as stickers while their card
 * is on screen (`chat/files/auto-preview-loader.ts`).
 */
const props = withDefaults(defineProps<{ conversation?: string }>(), { conversation: "server" });

const ts = useTsStore();
const chatHistory = useChatHistoryStore();
const { t } = useI18n();
const draft = ref("");
const scroller = ref<HTMLElement | null>(null);
const key = computed(() => props.conversation);
const searching = ref(false);
const query = ref("");
/** Only filter while the search box is open, so closing it brings everything back. */
const activeQuery = computed(() => (searching.value ? query.value : ""));

const title = computed(() => {
  const k = key.value;
  if (k === "server") return `${t("tree.server")} · ${ts.server?.name ?? ""}`;
  if (k.startsWith("channel:")) {
    const ch = ts.channels.get(k.slice("channel:".length));
    return `${t("chat.channel")} · ${ch?.name ?? "?"}`;
  }
  if (k.startsWith("client:")) {
    const c = ts.clients.get(Number(k.slice("client:".length)));
    return `${t("chat.private")} · ${c?.nickname ?? t("chat.offline")}`;
  }
  return k;
});

/** The partner of a private chat; its history is filed under their UID. */
const partnerUid = computed(() =>
  key.value.startsWith("client:")
    ? ts.clients.get(Number(key.value.slice("client:".length)))?.uid
    : undefined,
);

watch(
  () => [key.value, partnerUid.value] as const,
  ([k]) => void chatHistory.ensureLoaded(k),
  { immediate: true },
);

const past = computed(() =>
  chatHistory
    .historyFor(key.value)
    .filter((m) => matchesQuery(m, activeQuery.value))
    .map((m, i) => ({ id: m.id ?? -i, msg: m })),
);

const items = computed(() => {
  const k = key.value;
  const cleared = chatHistory.clearedThrough.get(k) ?? 0;
  const q = activeQuery.value;
  const msgs = ts.messages
    .filter((m) => m.conversation === k && m.id > cleared && matchesQuery(m, q))
    .map((m) => ({ kind: "msg" as const, at: m.at, id: m.id, msg: m }));
  // System events are shown in the server conversation only, and not in results.
  const evs =
    k === "server" && !q.trim()
      ? ts.events.map((e) => ({ kind: "event" as const, at: e.at, id: e.id, ev: e }))
      : [];
  return [...msgs, ...evs].sort((a, b) => a.at - b.at || a.id - b.id);
});

const noResults = computed(
  () => !!activeQuery.value.trim() && past.value.length === 0 && items.value.length === 0,
);

/**
 * A shown picture's menu: the right button on the desktop, a held finger on a
 * phone (touch devices never fire `contextmenu`), like the channel tree's rows.
 */
const longPress = useLongPress();

/** Files in chat: the 📎 button, dropping onto the panel, pasting into the input. */
const files = useChatFileInput(key);
const { picker: filePicker, dragging, enabled: filesEnabled } = files;

/** The sticker picker hangs off the composer; only one is open at a time. */
const stickersOpen = ref(false);
watch(key, () => (stickersOpen.value = false));
/**
 * The picker is taken out of the panel and pinned to the 😀 button, because a
 * chat panel is a dock window that clips whatever hangs outside it — in a short
 * window the picker lost its header and its search box. Only the placement is
 * shared with the status-bar popovers: the picker is not in their registry and
 * does not dismiss itself on an outside press, since it opens confirmations of
 * its own (deleting a pack) and a press in one of those must not take it away.
 */
const stickerBtn = ref<HTMLElement | null>(null);
const stickerPanel = ref<HTMLElement | null>(null);
const { style: stickerStyle } = usePopoverAnchor(stickerBtn, stickerPanel, stickersOpen);

function send(): void {
  ts.sendText(key.value, draft.value);
  draft.value = "";
}

function fmtTime(at: number): string {
  return new Date(at).toLocaleTimeString(locale.value, { hour: "2-digit", minute: "2-digit" });
}

/** Stored messages may be from another day, so they carry the date too. */
function fmtStamp(at: number): string {
  return new Date(at).toLocaleString(locale.value, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Mark read when this conversation's panel is focused. */
function onFocus(): void {
  ts.openConversation(key.value);
}

function toggleSearch(): void {
  searching.value = !searching.value;
  if (!searching.value) query.value = "";
}

async function clearHistory(): Promise<void> {
  const ok = await confirmDialog({
    title: t("chat.clearConfirm"),
    confirmLabel: t("dialog.clear"),
    danger: true,
  });
  if (!ok) return;
  void chatHistory.clearConversation(key.value);
}

watch(
  () => items.value.length + past.value.length,
  async () => {
    await nextTick();
    const el = scroller.value;
    if (el) el.scrollTop = el.scrollHeight;
  },
  { immediate: true },
);

onUnmounted(watchStickers(scroller));
</script>

<template>
  <section
    class="chat"
    :class="{ dropping: dragging }"
    @mousedown="onFocus"
    @dragenter="files.onDragEnter"
    @dragover="files.onDragOver"
    @dragleave="files.onDragLeave"
    @drop="files.onDrop"
  >
    <div v-if="dragging" class="drop-hint" aria-hidden="true">
      {{ t("chatFiles.dropHint") }}
    </div>
    <div class="title">
      <span class="title-text">{{ title }}</span>
      <button
        class="tool"
        :class="{ on: searching }"
        :title="t('chat.search')"
        :aria-pressed="searching"
        @click="toggleSearch"
      >
        🔍
      </button>
      <button class="tool" :title="t('chat.clearHistory')" @click="clearHistory">🗑</button>
    </div>
    <div v-if="searching" class="search">
      <input
        v-model="query"
        type="search"
        :placeholder="t('chat.searchPlaceholder')"
        :aria-label="t('chat.search')"
        @keydown.esc="toggleSearch"
      />
    </div>
    <div
      ref="scroller"
      class="log bb-rich"
      @click="onRichClick"
      @contextmenu="onRichContextMenu"
      v-on="longPress(onRichLongPress)"
    >
      <div v-for="it in past" :key="`h${it.id}`" class="msg history" :class="{ self: it.msg.self }">
        <span class="time">{{ fmtStamp(it.msg.at) }}</span>
        <span class="from">{{ it.msg.fromName }}</span>
        <span class="text" v-html="renderBBCode(it.msg.text)"></span>
      </div>
      <div v-if="past.length && !activeQuery.trim()" class="divider">
        <span>{{ t("chat.historyDivider") }}</span>
      </div>
      <div v-if="noResults" class="empty">{{ t("chat.noResults") }}</div>
      <template v-for="it in items" :key="`${it.kind}${it.id}`">
        <div v-if="it.kind === 'event'" class="event" :class="it.ev.kind">
          <span class="time">{{ fmtTime(it.at) }}</span>
          <span v-html="renderBBCode(it.ev.text)"></span>
        </div>
        <div v-else class="msg" :class="{ self: it.msg.self, pending: it.msg.pending }">
          <span class="time">{{ fmtTime(it.at) }}</span>
          <ClientAvatar class="from-avatar" :uid="it.msg.fromUid" :size="16" />
          <span class="from">{{ it.msg.fromName }}</span>
          <span class="text" v-html="renderBBCode(it.msg.text)"></span>
        </div>
      </template>
    </div>
    <ChatUploads :conversation="key" />
    <!-- Outside the form: `.composer input` is the message box, and only it. -->
    <input
      ref="filePicker"
      class="picker"
      type="file"
      multiple
      tabindex="-1"
      aria-hidden="true"
      @change="files.onPicked"
    />
    <!-- Teleported and placed by `usePopoverAnchor` (fixed, above the 😀 button,
         flipped below it when the composer is near the top of the screen), so no
         dock window can clip it and nothing here may position it. Outside the
         form too, since its inputs are not the composer's and Enter in one of
         them must not send the message. -->
    <teleport to="body">
      <div v-if="stickersOpen" ref="stickerPanel" class="sticker-pop" :style="stickerStyle">
        <StickerPicker :conversation="key" @close="stickersOpen = false" />
      </div>
    </teleport>
    <form class="composer" @submit.prevent="send">
      <button
        ref="stickerBtn"
        type="button"
        class="stickers-btn"
        :class="{ on: stickersOpen }"
        :title="t('stickers.open')"
        :aria-label="t('stickers.open')"
        :aria-expanded="stickersOpen"
        data-testid="sticker-button"
        @click="stickersOpen = !stickersOpen"
      >
        😀
      </button>
      <button
        type="button"
        class="attach"
        :title="
          filesEnabled
            ? t('chatFiles.attach')
            : ts.connState === 'connected'
              ? t('chatFiles.unavailable')
              : t('status.notConnected')
        "
        :aria-label="t('chatFiles.attach')"
        :disabled="!filesEnabled"
        @click="files.pick"
      >
        📎
      </button>
      <input
        v-model="draft"
        :placeholder="
          ts.connState === 'connected' ? t('chat.placeholder') : t('status.notConnected')
        "
        :disabled="ts.connState !== 'connected'"
        maxlength="8192"
        @focus="onFocus"
        @paste="files.onPaste"
      />
      <button type="submit" :disabled="!draft.trim() || ts.connState !== 'connected'">
        {{ t("chat.send") }}
      </button>
    </form>
  </section>
</template>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
}
.title {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px 4px 14px;
  color: var(--text-dim);
  font-size: 12px;
}
.title-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool {
  padding: 0 4px;
  border: none;
  background: transparent;
  font-size: 12px;
  opacity: 0.6;
}
.tool:hover,
.tool.on {
  opacity: 1;
}
.search {
  padding: 0 14px 6px;
}
.search input {
  width: 100%;
}
.log {
  flex: 1;
  overflow: auto;
  padding: 0 14px 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.msg,
.event {
  display: flex;
  gap: 8px;
  align-items: baseline;
  line-height: 1.5;
  word-break: break-word;
}
.time {
  color: var(--text-dim);
  font-size: 11px;
  flex: none;
  font-variant-numeric: tabular-nums;
}
.from {
  color: var(--accent-2);
  font-weight: 600;
  flex: none;
}
/* Rows align on the text baseline; the avatar sits on the line's middle instead. */
.from-avatar {
  align-self: center;
}
.msg.self .from {
  color: var(--accent);
}
/* Our own copy, waiting for the server to echo it back. */
.msg.pending {
  opacity: 0.5;
}
.msg.pending .from,
.msg.pending .text {
  color: var(--text-dim);
}
/* Stored history: readable, but visibly not from this session. */
.msg.history {
  opacity: 0.7;
}
.divider {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0;
  color: var(--text-dim);
  font-size: 11px;
}
.divider::before,
.divider::after {
  content: "";
  flex: 1;
  border-top: 1px dashed var(--border);
}
.empty {
  color: var(--text-dim);
  font-size: 12px;
  padding: 8px 0;
}
.text {
  flex: 1;
  min-width: 0;
}
.event {
  color: var(--text-dim);
  font-size: 12px;
}
.event.warn {
  color: var(--warn);
}
.event.error {
  color: var(--danger);
}
.composer {
  display: flex;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--border);
}
.composer input {
  flex: 1;
}
.composer .attach {
  flex: none;
  padding: 0 8px;
}
/* Its own class, not `.attach`: `.composer .attach` is the file button. */
.composer .stickers-btn {
  flex: none;
  padding: 0 8px;
}
.composer .stickers-btn.on {
  color: var(--accent);
}
.picker {
  display: none;
}
/* Files dragged over the chat: the whole panel is the drop target. */
.chat {
  position: relative;
}
.chat.dropping {
  outline: 2px dashed var(--accent);
  outline-offset: -4px;
}
.drop-hint {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--bg) 80%, transparent);
  color: var(--accent);
  font-weight: 600;
  pointer-events: none;
}

/* A fingertip needs the shared minimum, and these three set their own width,
   so the coarse-pointer rule in styles/base.css cannot reach them: measured at
   phone width they came out 23px, 20px and 33px wide. */
@media (pointer: coarse) {
  .tool,
  .composer .attach,
  .composer .stickers-btn {
    min-width: var(--touch-target);
  }
}
</style>
