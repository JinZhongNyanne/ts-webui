<script setup lang="ts">
/**
 * Chat on a phone.
 *
 * The dock gives every conversation its own panel; here there is one panel and
 * a scrollable row of chips above it. The list of chips comes from
 * `conversations.ts`, which derives it from the store the way the dock's panel
 * list does on the desktop.
 */
import { computed } from "vue";
import { useTsStore } from "../stores/ts";
import { useI18n } from "../i18n";
import { conversationName } from "../ts/conversationName";
import { openConversations } from "./conversations";
import ChatPanel from "../components/ChatPanel.vue";

const ts = useTsStore();
const { t } = useI18n();

const entries = computed(() =>
  openConversations({
    messages: ts.messages,
    unread: ts.unread,
    activeKey: ts.activeConversation,
    selfChannelId: ts.selfChannel?.id,
  }),
);

function label(key: string): string {
  return conversationName(key, {
    channelName: (id) => ts.channels.get(id)?.name,
    clientName: (id) => ts.clients.get(id)?.nickname,
  });
}
</script>

<template>
  <div class="chatview">
    <nav class="chips" :aria-label="t('mobile.conversations')">
      <button
        v-for="entry in entries"
        :key="entry.key"
        type="button"
        class="chip"
        :class="{ active: entry.key === ts.activeConversation }"
        @click="ts.openConversation(entry.key)"
      >
        <span class="chip-label">{{ label(entry.key) }}</span>
        <span v-if="entry.unread" class="chip-unread">{{ entry.unread }}</span>
      </button>
    </nav>
    <div class="panel">
      <ChatPanel :conversation="ts.activeConversation" />
    </div>
  </div>
</template>

<style scoped>
.chatview {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.chips {
  flex: none;
  display: flex;
  gap: 6px;
  padding: 6px 8px;
  padding-left: calc(8px + env(safe-area-inset-left, 0px));
  padding-right: calc(8px + env(safe-area-inset-right, 0px));
  overflow-x: auto;
  overscroll-behavior-x: contain;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
}
.chips::-webkit-scrollbar {
  display: none;
}
.chip {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  /* Full size: this strip only ever renders on a phone, and switching to the
     wrong conversation is a worse cost than the rows of chat it takes. */
  min-height: var(--touch-target);
  max-width: 45vw;
  padding: 4px 12px;
  border-radius: 22px;
  background: var(--bg);
  color: var(--text-dim);
  font-size: 13px;
}
.chip.active {
  border-color: var(--accent);
  color: var(--text);
  background: var(--bg-elev-2);
}
.chip-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip-unread {
  flex: none;
  min-width: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--danger);
  color: #fff;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}
.panel {
  flex: 1;
  min-height: 0;
  display: flex;
}
.panel > * {
  flex: 1;
  min-width: 0;
  min-height: 0;
}
</style>
