<script setup lang="ts">
import { useChatSettingsStore } from "../../stores/chatSettings";
import { useChatHistoryStore } from "../../stores/chatHistory";
import { MAX_RETENTION_DAYS } from "../../chat/settings";
import { AUTO_PREVIEW_MAX_BYTES } from "../../chat/files/auto-preview";
import { formatBytes } from "@jinz/protocol";
import { useI18n } from "../../i18n";
import { confirmDialog } from "../ui/confirm";

/** Settings pane: local chat history, sticker previews and the image host allowlist. */
const chat = useChatSettingsStore();
const chatHistory = useChatHistoryStore();
const { t } = useI18n();

function onRetention(ev: Event): void {
  chat.setRetentionDays(Number((ev.target as HTMLInputElement).value));
}

async function clearAll(): Promise<void> {
  const ok = await confirmDialog({
    title: t("chatSettings.clearAllConfirm"),
    confirmLabel: t("dialog.clear"),
    danger: true,
  });
  if (!ok) return;
  void chatHistory.clearAll();
}
</script>

<template>
  <div class="pane">
    <label class="row">
      <span>{{ t("chatSettings.history") }}</span>
      <input
        type="checkbox"
        :checked="chat.settings.historyEnabled"
        @change="chat.setHistoryEnabled(($event.target as HTMLInputElement).checked)"
      />
    </label>
    <label class="row">
      <span>{{ t("chatSettings.retention") }}</span>
      <input
        class="days"
        type="number"
        min="0"
        :max="MAX_RETENTION_DAYS"
        :value="chat.settings.retentionDays"
        :disabled="!chat.settings.historyEnabled"
        @change="onRetention"
      />
    </label>
    <p class="hint">{{ t("chatSettings.retentionHint") }}</p>
    <button class="danger" @click="clearAll">{{ t("chatSettings.clearAll") }}</button>

    <h4>{{ t("chatSettings.sharedImages") }}</h4>
    <label class="row">
      <span>{{ t("chatSettings.autoImages") }}</span>
      <input
        type="checkbox"
        data-testid="chat-auto-images"
        :checked="chat.settings.autoImages"
        @change="chat.setAutoImages(($event.target as HTMLInputElement).checked)"
      />
    </label>
    <p class="hint">
      {{ t("chatSettings.autoImagesHint", { max: formatBytes(AUTO_PREVIEW_MAX_BYTES) }) }}
    </p>

    <h4>{{ t("chatSettings.images") }}</h4>
    <p class="hint">{{ t("chatSettings.imagesHint") }}</p>
    <ul v-if="chat.settings.imageHosts.length" class="hosts">
      <li v-for="host in chat.settings.imageHosts" :key="host">
        <span>{{ host }}</span>
        <button :title="t('chatSettings.forgetHost')" @click="chat.forgetImageHost(host)">×</button>
      </li>
    </ul>
    <p v-else class="hint">{{ t("chatSettings.noHosts") }}</p>
  </div>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
h4 {
  margin: 4px 0 0;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--text-dim);
}
.row input[type="checkbox"] {
  width: auto;
}
.days {
  width: 80px;
}
.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-dim);
}
.danger {
  align-self: flex-start;
  color: var(--danger);
}
.hosts {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 160px;
  overflow: auto;
  font-size: 12px;
}
.hosts li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.hosts button {
  padding: 0 6px;
}
</style>
