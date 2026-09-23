<script setup lang="ts">
/**
 * Our offline messages: the list (`messagelist`), one opened (`messageget`,
 * then `messageupdateflag flag=1`, since reading alone does not mark it),
 * delete (`messagedel`), reply and new message (ComposeMessageDialog).
 * Senders come as UIDs; their names are looked up once, together (`clientgetnamefromuid`).
 */
import { computed, onMounted, shallowRef } from "vue";
import AppDialog from "../ui/AppDialog.vue";
import { confirmDialog } from "../ui/confirm";
import { openClientDialog } from "../client/client-dialogs";
import { useI18n } from "../../i18n";
import { useInboxStore } from "../../stores/inbox";
import { useTsStore } from "../../stores/ts";
import { formatDateTime } from "../../ts/assets";
import {
  deleteOfflineMessage,
  markOfflineMessageRead,
  readOfflineMessage,
} from "../../ts/admin-actions";
import type { OfflineMessage, OfflineMessageHead } from "../../ts/admin-rows";
import { useAdminGates } from "./useAdminGates";
import { useBusy } from "./useBusy";

const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const inbox = useInboxStore();
const ts = useTsStore();
const gates = useAdminGates();
const { busy, error, run, act } = useBusy();

const open = shallowRef<OfflineMessage | null>(null);
const loaded = shallowRef(false);

const title = computed(() =>
  inbox.unread ? t("admin.inbox.titleUnread", { n: inbox.unread }) : t("admin.inbox.title"),
);

function senderName(uid: string): string {
  const online = [...ts.clients.values()].find((c) => c.uid === uid);
  return online?.nickname || inbox.names[uid] || uid;
}

async function load(): Promise<void> {
  await run(() => inbox.refresh());
  loaded.value = true;
  void inbox.resolveNames(inbox.messages.map((m) => m.fromUid));
}

async function show(head: OfflineMessageHead): Promise<void> {
  if (busy.value) return;
  const msg = await run(() => readOfflineMessage(head.id));
  if (!msg) return;
  open.value = msg;
  if (!head.read && (await act(() => markOfflineMessageRead(head.id)))) inbox.markRead(head.id);
}

async function remove(id: string): Promise<void> {
  const yes = await confirmDialog({
    title: t("admin.inbox.deleteTitle"),
    confirmLabel: t("admin.delete"),
    danger: true,
  });
  if (!yes) return;
  if (await act(() => deleteOfflineMessage(id))) {
    inbox.remove(id);
    if (open.value?.id === id) open.value = null;
  }
}

function reply(msg: OfflineMessage): void {
  const subject = /^re:/i.test(msg.subject) ? msg.subject : `Re: ${msg.subject}`;
  openClientDialog({
    kind: "composeMessage",
    uid: msg.fromUid,
    nickname: senderName(msg.fromUid),
    subject: subject.slice(0, 200),
    back: "inbox",
  });
}

function compose(): void {
  openClientDialog({ kind: "composeMessage", back: "inbox" });
}

const when = (ms: number) => formatDateTime(ms / 1000);

onMounted(load);
</script>

<template>
  <AppDialog width="600px" :title="title" @close="emit('close')">
    <div class="toolbar" data-testid="inbox-dialog">
      <button v-if="open" type="button" @click="open = null">← {{ t("admin.back") }}</button>
      <span class="grow"></span>
      <button v-if="gates.sendOffline()" type="button" @click="compose">
        ✉️ {{ t("admin.inbox.compose") }}
      </button>
      <button v-if="!open" type="button" :disabled="busy" @click="load">
        {{ t("admin.refresh") }}
      </button>
    </div>
    <p v-if="error" class="err" role="alert">{{ error }}</p>

    <article v-if="open" class="message" data-testid="inbox-message">
      <h4 class="subject">{{ open.subject }}</h4>
      <p class="meta">
        {{ t("admin.inbox.from", { name: senderName(open.fromUid) }) }} · {{ when(open.at) }}
      </p>
      <p class="body">{{ open.body }}</p>
      <div class="toolbar">
        <button v-if="gates.sendOffline()" type="button" @click="reply(open)">
          {{ t("admin.inbox.reply") }}
        </button>
        <button type="button" class="danger-text" :disabled="busy" @click="remove(open.id)">
          {{ t("admin.delete") }}
        </button>
      </div>
    </article>

    <template v-else>
      <p v-if="loaded && !inbox.messages.length && !error" class="empty">
        {{ t("admin.inbox.none") }}
      </p>
      <ul class="rows">
        <li
          v-for="m in inbox.messages"
          :key="m.id"
          class="row clickable"
          :class="{ unread: !m.read }"
          data-testid="inbox-row"
          tabindex="0"
          @click="show(m)"
          @keydown.enter="show(m)"
        >
          <div class="main">
            <span class="title">
              <span v-if="!m.read" class="dot" :title="t('admin.inbox.unread')">●</span>
              {{ m.subject }}
            </span>
            <span class="meta">{{ senderName(m.fromUid) }} · {{ when(m.at) }}</span>
          </div>
          <div class="actions">
            <button
              type="button"
              class="danger-text"
              :disabled="busy"
              :aria-label="t('admin.delete')"
              @click.stop="remove(m.id)"
            >
              ×
            </button>
          </div>
        </li>
      </ul>
    </template>
    <template #footer>
      <button type="button" @click="emit('close')">{{ t("dialog.close") }}</button>
    </template>
  </AppDialog>
</template>

<style scoped src="./admin.css"></style>
<style scoped>
.row:not(.unread) .title {
  font-weight: 400;
}
.dot {
  color: var(--accent);
  font-size: 10px;
  vertical-align: middle;
}
.message {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.subject {
  margin: 0;
  overflow-wrap: anywhere;
}
.meta {
  color: var(--text-dim);
  font-size: 12px;
  margin: 0;
  overflow-wrap: anywhere;
}
.body {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
}
</style>
