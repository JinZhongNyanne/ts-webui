<script setup lang="ts">
/**
 * Files on their way into this conversation, above the composer: name,
 * progress and cancel; a failure stays with its reason until dismissed. Once
 * uploaded, the file becomes a chat message and leaves this list.
 */
import { computed } from "vue";
import { formatBytes } from "@jinz/protocol";
import { useI18n } from "../../i18n";
import { useTsStore } from "../../stores/ts";
import { useTransfersStore } from "../../stores/transfers";
import { useChatUploadsStore } from "../../stores/chatUploads";
import type { ChatUpload } from "../../chat/files/uploader";

const props = defineProps<{ conversation: string }>();

const { t } = useI18n();
const ts = useTsStore();
const transfers = useTransfersStore();
const uploads = useChatUploadsStore();

const rows = computed(() =>
  uploads.items
    .filter((u) => u.conversation === props.conversation)
    .map((u) => ({ upload: u, ...progressOf(u) })),
);

/** Private and server chat files go to our own channel; say which, once. */
const elsewhere = computed(() => {
  if (props.conversation.startsWith("channel:") || rows.value.length === 0) return "";
  const cid = rows.value[0]!.upload.cid;
  return cid ? (ts.channels.get(cid)?.name ?? "") : "";
});

function progressOf(u: ChatUpload): { percent: number; detail: string } {
  const item = u.transferId ? transfers.items.find((x) => x.id === u.transferId) : undefined;
  if (!item || item.size === 0) return { percent: 0, detail: t("chatFiles.preparing") };
  const percent = Math.min(100, Math.round((item.loaded / item.size) * 100));
  return { percent, detail: `${formatBytes(item.loaded)} / ${formatBytes(item.size)}` };
}
</script>

<template>
  <div v-if="rows.length" class="uploads">
    <div v-if="elsewhere" class="note">
      {{ t("chatFiles.uploadingTo", { channel: elsewhere }) }}
    </div>
    <div
      v-for="row in rows"
      :key="row.upload.id"
      class="row"
      :class="row.upload.state"
      data-testid="chat-upload"
    >
      <span class="name" :title="row.upload.name">📎 {{ row.upload.name }}</span>
      <template v-if="row.upload.state === 'failed'">
        <span class="error" role="alert">
          {{ t("chatFiles.failed", { error: row.upload.error ?? "" }) }}
        </span>
        <button
          type="button"
          class="icon"
          :title="t('chatFiles.dismiss')"
          :aria-label="t('chatFiles.dismiss')"
          @click="uploads.dismiss(row.upload.id)"
        >
          ✕
        </button>
      </template>
      <template v-else>
        <progress max="100" :value="row.percent" :aria-label="row.upload.name"></progress>
        <span class="detail">{{ row.detail }}</span>
        <button
          type="button"
          class="icon"
          :title="t('chatFiles.cancel')"
          :aria-label="t('chatFiles.cancel')"
          @click="uploads.cancel(row.upload.id)"
        >
          ✕
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.uploads {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 14px 0;
  font-size: 12px;
}
.note {
  color: var(--text-dim);
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.name {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
progress {
  flex: 1;
  min-width: 40px;
  height: 6px;
}
.detail {
  flex: none;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.error {
  flex: 1;
  min-width: 0;
  color: var(--danger);
}
.icon {
  flex: none;
  padding: 0 6px;
  border: none;
  background: transparent;
  opacity: 0.7;
}
.icon:hover {
  opacity: 1;
}
</style>
