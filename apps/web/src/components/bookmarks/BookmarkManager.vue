<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "../../i18n";
import { useBookmarksStore } from "../../stores/bookmarks";
import { useIdentitiesStore } from "../../stores/identities";
import { formFromRecent, type BookmarkForm } from "../../bookmarks/form";
import type { Bookmark, RecentConnection } from "../../bookmarks/book";
import ModalFrame from "../identity/ModalFrame.vue";
import { confirmDialog } from "../ui/confirm";
import BookmarkEditor from "./BookmarkEditor.vue";

/** Bookmarks by folder plus the recent list; "use" hands an entry back to the connect dialog. */
const props = defineProps<{ draft?: BookmarkForm }>();
const emit = defineEmits<{ close: []; use: [form: BookmarkForm, lostPasswords: boolean] }>();
const store = useBookmarksStore();
const identities = useIdentitiesStore();
const { t } = useI18n();

const editing = ref<BookmarkForm | null>(props.draft ?? null);

async function edit(b: Bookmark): Promise<void> {
  editing.value = (await store.unlock(b)).form;
}

async function use(b: Bookmark): Promise<void> {
  const { form, lostPasswords } = await store.unlock(b);
  emit("use", form, lostPasswords);
}

async function remove(b: Bookmark): Promise<void> {
  const ok = await confirmDialog({
    title: t("bookmark.deleteConfirm", { name: b.label }),
    confirmLabel: t("dialog.delete"),
    danger: true,
  });
  if (ok) store.remove(b.id);
}

function identityName(id: string | null): string {
  return identities.byId(id)?.name ?? t("bookmark.identityActive");
}

function when(r: RecentConnection): string {
  return new Date(r.at).toLocaleString();
}

function blank(): BookmarkForm {
  return {
    label: "",
    group: "",
    host: "",
    port: 9987,
    nickname: "",
    identityId: null,
    defaultChannel: "",
    musicBot: "",
    serverPassword: "",
    channelPassword: "",
  };
}
</script>

<template>
  <ModalFrame :title="t('bookmark.managerTitle')" wide @close="emit('close')">
    <BookmarkEditor
      v-if="editing"
      :initial="editing"
      @saved="editing = null"
      @cancel="editing = null"
    />
    <template v-else>
      <section v-for="g in store.groups" :key="g.name" class="group">
        <h4>{{ g.name || t("bookmark.ungrouped") }}</h4>
        <ul>
          <li v-for="b in g.items" :key="b.id">
            <div class="info">
              <strong>{{ b.label }}</strong>
              <span class="dim">
                {{ b.host }}:{{ b.port }}
                <template v-if="b.nickname"> · {{ b.nickname }}</template>
                · {{ identityName(b.identityId) }}
                <template v-if="b.serverPassword || b.channelPassword"> · 🔒</template>
              </span>
            </div>
            <button type="button" @click="use(b)">{{ t("bookmark.use") }}</button>
            <button type="button" @click="edit(b)">{{ t("bookmark.edit") }}</button>
            <button type="button" class="danger" @click="remove(b)">
              {{ t("bookmark.delete") }}
            </button>
          </li>
        </ul>
      </section>
      <p v-if="store.bookmarks.length === 0" class="dim">{{ t("bookmark.none") }}</p>
      <button type="button" @click="editing = blank()">{{ t("bookmark.new") }}</button>

      <section class="group">
        <h4>
          {{ t("bookmark.recent") }}
          <button
            v-if="store.recent.length"
            type="button"
            class="link"
            @click="store.clearRecent()"
          >
            {{ t("bookmark.clearRecent") }}
          </button>
        </h4>
        <ul>
          <li v-for="r in store.recent" :key="`${r.host}:${r.port}:${r.identityId}`">
            <div class="info">
              <strong>{{ r.host }}:{{ r.port }}</strong>
              <span class="dim">
                {{ r.nickname }} · {{ identityName(r.identityId) }} · {{ when(r) }}
              </span>
            </div>
            <button type="button" @click="emit('use', formFromRecent(r), false)">
              {{ t("bookmark.use") }}
            </button>
            <button type="button" @click="editing = formFromRecent(r)">
              {{ t("bookmark.saveAs") }}
            </button>
          </li>
        </ul>
        <p v-if="store.recent.length === 0" class="dim">{{ t("bookmark.noRecent") }}</p>
      </section>
    </template>
  </ModalFrame>
</template>

<style scoped>
.group h4 {
  margin: 0 0 6px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 10px;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
li {
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 10px;
}
.info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.info > * {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dim {
  color: var(--text-dim);
  font-size: 12px;
}
.link {
  background: transparent;
  border: none;
  color: var(--text-dim);
  font-size: 12px;
  text-decoration: underline;
  padding: 0;
}
</style>
