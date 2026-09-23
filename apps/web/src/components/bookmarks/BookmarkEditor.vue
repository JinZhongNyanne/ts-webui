<script setup lang="ts">
import { reactive, ref } from "vue";
import { useI18n } from "../../i18n";
import { useBookmarksStore } from "../../stores/bookmarks";
import { useIdentitiesStore } from "../../stores/identities";
import type { BookmarkForm } from "../../bookmarks/form";

/** Create or edit one bookmark. Passwords are encrypted by the store on save. */
const props = defineProps<{ initial: BookmarkForm }>();
const emit = defineEmits<{ saved: [id: string]; cancel: [] }>();
const bookmarks = useBookmarksStore();
const identities = useIdentitiesStore();
const { t } = useI18n();

const form = reactive<BookmarkForm>({ ...props.initial });
const busy = ref(false);
const error = ref("");

async function submit(): Promise<void> {
  busy.value = true;
  error.value = "";
  try {
    const id = await bookmarks.save({ ...form, host: form.host.trim() });
    emit("saved", id);
  } catch (err) {
    // Almost always IndexedDB being unavailable (private mode) while a password is set.
    error.value = t("bookmark.errSave", {
      reason: err instanceof Error ? err.message : String(err),
    });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form class="editor" data-testid="bookmark-editor" @submit.prevent="submit">
    <div class="grid">
      <label>
        <span>{{ t("bookmark.label") }}</span>
        <input v-model="form.label" maxlength="80" :placeholder="form.host" />
      </label>
      <label>
        <span>{{ t("bookmark.group") }}</span>
        <input
          v-model="form.group"
          maxlength="60"
          list="m1-bookmark-folders"
          :placeholder="t('bookmark.groupPlaceholder')"
        />
        <datalist id="m1-bookmark-folders">
          <option v-for="f in bookmarks.folders" :key="f" :value="f"></option>
        </datalist>
      </label>
      <label class="span">
        <span>{{ t("connect.host") }}</span>
        <div class="row">
          <input v-model="form.host" required placeholder="ts.example.com" />
          <input v-model.number="form.port" class="port" type="number" min="1" max="65535" />
        </div>
      </label>
      <label>
        <span>{{ t("connect.nickname") }}</span>
        <input v-model="form.nickname" maxlength="30" :placeholder="t('bookmark.nicknameHint')" />
      </label>
      <label>
        <span>{{ t("identity.label") }}</span>
        <select v-model="form.identityId">
          <option :value="null">{{ t("bookmark.identityActive") }}</option>
          <option v-for="i in identities.items" :key="i.id" :value="i.id">{{ i.name }}</option>
        </select>
      </label>
      <label>
        <span>{{ t("connect.defaultChannel") }}</span>
        <input v-model="form.defaultChannel" :placeholder="t('connect.channelPlaceholder')" />
      </label>
      <label>
        <span>{{ t("bookmark.channelPassword") }}</span>
        <input v-model="form.channelPassword" type="password" autocomplete="off" />
      </label>
      <label>
        <span>{{ t("connect.serverPassword") }}</span>
        <input v-model="form.serverPassword" type="password" autocomplete="off" />
      </label>
      <label>
        <span>{{ t("connect.musicBot") }}</span>
        <input v-model="form.musicBot" autocomplete="off" />
      </label>
    </div>
    <p class="hint">{{ t("bookmark.passwordHint") }}</p>
    <p v-if="error" class="error">{{ error }}</p>
    <div class="actions">
      <button type="button" @click="emit('cancel')">{{ t("bookmark.cancel") }}</button>
      <button type="submit" class="primary" :disabled="busy || !form.host.trim()">
        {{ t("bookmark.save") }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.span {
  grid-column: 1 / -1;
}
label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-dim);
  min-width: 0;
}
.row {
  display: flex;
  gap: 8px;
}
.row input:first-child {
  flex: 1;
  min-width: 0;
}
.port {
  width: 96px;
}
.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-dim);
}
.error {
  margin: 0;
  font-size: 12px;
  color: var(--danger);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}
@media (max-width: 560px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
