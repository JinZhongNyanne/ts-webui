<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "../../i18n";
import { useTsStore } from "../../stores/ts";
import { useIdentitiesStore } from "../../stores/identities";
import { useHubAccessStore } from "../../stores/hubAccess";
import { formFromProfile, type BookmarkForm } from "../../bookmarks/form";
import { channelPath } from "../../ts/reconnect";
import ModalFrame from "../identity/ModalFrame.vue";
import BookmarkEditor from "./BookmarkEditor.vue";

/**
 * "Bookmark this server" while connected. Prefilled with the connection in
 * use and the channel we are in now. Hidden with a fixed server: there is
 * nothing to choose between.
 */
const ts = useTsStore();
const identities = useIdentitiesStore();
const access = useHubAccessStore();
const { t } = useI18n();

const draft = ref<BookmarkForm | null>(null);
const saved = ref(false);

function open(): void {
  saved.value = false;
  // A full path, like the reconnect replay uses, so same-named sub-channels are not confused.
  const here = ts.selfChannel ? channelPath(ts.channels, ts.selfChannel.id) : "";
  const form = formFromProfile(ts.profile, identities.active?.id ?? null, here);
  draft.value = { ...form, label: ts.server?.name || form.label };
}

function onSaved(): void {
  draft.value = null;
  saved.value = true;
}
</script>

<template>
  <template v-if="!access.fixedServer">
    <button
      type="button"
      :class="{ active: saved }"
      :title="t('bookmark.addTitle')"
      data-testid="bookmark-add"
      @click="open"
    >
      {{ saved ? "★" : "☆" }}
    </button>
    <ModalFrame v-if="draft" :title="t('bookmark.addTitle')" @close="draft = null">
      <BookmarkEditor :initial="draft" @saved="onSaved" @cancel="draft = null" />
    </ModalFrame>
  </template>
</template>
