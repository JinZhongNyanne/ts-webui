<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "../../i18n";
import { useIdentitiesStore } from "../../stores/identities";
import { useBookmarksStore } from "../../stores/bookmarks";
import {
  exportFileName,
  exportIni,
  exportTs3String,
  type StoredIdentity,
} from "../../identity/book";
import { identityErrorText } from "../../identity/errors";
import ModalFrame from "./ModalFrame.vue";
import RaiseLevel from "./RaiseLevel.vue";
import IdentityImport from "./IdentityImport.vue";
import { confirmDialog } from "../ui/confirm";

/** List, create, edit, export, delete and raise identities. */
const emit = defineEmits<{ close: [] }>();
const store = useIdentitiesStore();
const bookmarks = useBookmarksStore();
const { t } = useI18n();

const openId = ref<string | null>(store.active?.id ?? null);
const newName = ref("");
const exported = ref<{ id: string; text: string } | null>(null);
const notice = ref("");

function toggle(id: string): void {
  openId.value = openId.value === id ? null : id;
  exported.value = null;
}

function create(): void {
  const item = store.create(newName.value);
  newName.value = "";
  openId.value = item.id;
}

async function remove(item: StoredIdentity): Promise<void> {
  const ok = await confirmDialog({
    title: t("identity.deleteConfirm", { name: item.name }),
    confirmLabel: t("dialog.delete"),
    danger: true,
  });
  if (!ok) return;
  store.remove(item.id);
  bookmarks.dropIdentity(item.id);
}

function download(item: StoredIdentity): void {
  const url = URL.createObjectURL(new Blob([exportIni(item)], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = exportFileName(item);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Shows the string (so it can be copied by hand too) and tries the clipboard. */
async function showString(item: StoredIdentity): Promise<void> {
  let text: string;
  try {
    text = exportTs3String(item);
  } catch (err) {
    notice.value = identityErrorText(err);
    return;
  }
  exported.value = { id: item.id, text };
  try {
    await navigator.clipboard.writeText(text);
    notice.value = t("identity.copied");
  } catch {
    notice.value = "";
  }
}

function onImported(id: string): void {
  openId.value = id;
}

function value(ev: Event): string {
  return (ev.target as HTMLInputElement).value;
}
</script>

<template>
  <ModalFrame :title="t('identity.managerTitle')" wide @close="emit('close')">
    <p class="warn">{{ t("identity.secretWarning") }}</p>
    <ul class="list">
      <li v-for="item in store.items" :key="item.id" :class="{ open: openId === item.id }">
        <div class="summary">
          <input
            type="radio"
            name="active-identity"
            :checked="store.active?.id === item.id"
            :title="t('identity.useThis')"
            @change="store.select(item.id)"
          />
          <button type="button" class="name" @click="toggle(item.id)">
            <strong>{{ item.name }}</strong>
            <span v-if="item.nickname" class="dim"> · {{ item.nickname }}</span>
          </button>
          <span class="level" :title="t('identity.levelTitle')">
            {{ t("identity.levelShort", { level: item.level }) }}
          </span>
        </div>
        <code class="uid" :title="t('identity.uid')">{{ item.uid }}</code>
        <div v-if="openId === item.id" class="details">
          <div class="fields">
            <label>
              <span>{{ t("identity.name") }}</span>
              <input
                :value="item.name"
                maxlength="60"
                @change="store.update(item.id, { name: value($event) })"
              />
            </label>
            <label>
              <span>{{ t("identity.nickname") }}</span>
              <input
                :value="item.nickname"
                maxlength="30"
                :placeholder="t('identity.nicknamePlaceholder')"
                @change="store.update(item.id, { nickname: value($event) })"
              />
            </label>
          </div>
          <div class="actions">
            <button type="button" @click="download(item)">{{ t("identity.exportIni") }}</button>
            <button type="button" @click="showString(item)">
              {{ t("identity.exportString") }}
            </button>
            <button type="button" class="danger" @click="remove(item)">
              {{ t("identity.delete") }}
            </button>
          </div>
          <textarea
            v-if="exported?.id === item.id"
            class="exported"
            readonly
            rows="3"
            :value="exported.text"
            @focus="($event.target as HTMLTextAreaElement).select()"
          ></textarea>
          <RaiseLevel :identity="item" />
        </div>
      </li>
      <li v-if="store.items.length === 0" class="empty">{{ t("identity.none") }}</li>
    </ul>
    <p v-if="notice" class="notice">{{ notice }}</p>

    <form class="create" @submit.prevent="create">
      <input v-model="newName" maxlength="60" :placeholder="t('identity.newNamePlaceholder')" />
      <button type="submit">{{ t("identity.create") }}</button>
    </form>

    <IdentityImport @imported="onImported" />
  </ModalFrame>
</template>

<style scoped>
.warn {
  margin: 0;
  font-size: 12px;
  color: var(--text-dim);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.list > li {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.list > li.open {
  border-color: var(--accent);
}
.summary {
  display: flex;
  align-items: center;
  gap: 8px;
}
.name {
  flex: 1;
  text-align: left;
  background: transparent;
  border: none;
  padding: 0;
  color: inherit;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dim,
.level {
  color: var(--text-dim);
  font-size: 12px;
}
.uid {
  font-size: 11px;
  color: var(--text-dim);
  word-break: break-all;
  user-select: all;
}
.details {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 6px;
}
.fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.fields label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-dim);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.exported {
  width: 100%;
  font-family: monospace;
  font-size: 11px;
}
.empty {
  color: var(--text-dim);
  font-size: 12px;
}
.notice {
  margin: 0;
  font-size: 12px;
  color: var(--accent);
}
.create {
  display: flex;
  gap: 8px;
}
.create input {
  flex: 1;
}
@media (max-width: 560px) {
  .fields {
    grid-template-columns: 1fr;
  }
}
</style>
