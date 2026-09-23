<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "../../i18n";
import { useBookmarksStore } from "../../stores/bookmarks";
import {
  formFromProfile,
  formFromRecent,
  type BookmarkForm,
  type ProfileFields,
} from "../../bookmarks/form";
import BookmarkManager from "./BookmarkManager.vue";

/**
 * Bookmark row of the connect dialog (free-server mode only): a quick picker
 * over recent connections and bookmark folders, "save these settings", and
 * the manager.
 */
const props = defineProps<{ current: ProfileFields; identityId: string | null }>();
const emit = defineEmits<{ apply: [form: BookmarkForm, lostPasswords: boolean] }>();
const store = useBookmarksStore();
const { t } = useI18n();

const managing = ref(false);
const draft = ref<BookmarkForm | undefined>(undefined);
const picked = ref("");

async function onPick(ev: Event): Promise<void> {
  const value = (ev.target as HTMLSelectElement).value;
  // Stays shown as a reminder of where the fields came from.
  picked.value = value;
  const [kind, key] = [value.slice(0, 2), value.slice(2)];
  if (kind === "r:") {
    const r = store.recent[Number(key)];
    if (r) emit("apply", formFromRecent(r), false);
  } else if (kind === "b:") {
    const b = store.bookmarks.find((x) => x.id === key);
    if (!b) return;
    const { form, lostPasswords } = await store.unlock(b);
    emit("apply", form, lostPasswords);
  }
}

function openManager(withDraft?: BookmarkForm): void {
  draft.value = withDraft;
  managing.value = true;
}

function onUse(form: BookmarkForm, lost: boolean): void {
  managing.value = false;
  emit("apply", form, lost);
}
</script>

<template>
  <div class="bookmarks">
    <select
      :value="picked"
      data-testid="bookmark-select"
      :disabled="!store.bookmarks.length && !store.recent.length"
      @change="onPick"
    >
      <option value="" disabled>
        {{
          store.bookmarks.length || store.recent.length
            ? t("bookmark.pick")
            : t("bookmark.pickEmpty")
        }}
      </option>
      <optgroup v-if="store.recent.length" :label="t('bookmark.recent')">
        <option v-for="(r, i) in store.recent" :key="`r${i}`" :value="`r:${i}`">
          {{ r.host }}:{{ r.port }}{{ r.nickname ? ` · ${r.nickname}` : "" }}
        </option>
      </optgroup>
      <optgroup
        v-for="g in store.groups"
        :key="`g${g.name}`"
        :label="g.name || t('bookmark.bookmarks')"
      >
        <option v-for="b in g.items" :key="b.id" :value="`b:${b.id}`">{{ b.label }}</option>
      </optgroup>
    </select>
    <button
      type="button"
      class="ghost"
      :title="t('bookmark.saveCurrentTitle')"
      :disabled="!props.current.host.trim()"
      data-testid="bookmark-save-current"
      @click="openManager(formFromProfile(props.current, props.identityId))"
    >
      ☆
    </button>
    <button type="button" class="ghost" data-testid="bookmark-manage" @click="openManager()">
      {{ t("bookmark.manage") }}
    </button>
    <BookmarkManager v-if="managing" :draft="draft" @close="managing = false" @use="onUse" />
  </div>
</template>

<style scoped>
.bookmarks {
  display: flex;
  gap: 8px;
  align-items: center;
}
select {
  flex: 1;
  min-width: 0;
}
.ghost {
  background: transparent;
  color: var(--text-dim);
  white-space: nowrap;
}
</style>
