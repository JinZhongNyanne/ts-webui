<script setup lang="ts">
/**
 * Create or edit a channel (`channelcreate` / `channeledit`), in tabs. The
 * form logic lives in useChannelForm.ts and ts/channel-form.ts; each tab is
 * its own component bound to the same form. The server has the last word,
 * and its refusal lands under the field it is about or above the buttons.
 */
import { computed } from "vue";
import AppDialog from "../ui/AppDialog.vue";
import { useI18n } from "../../i18n";
import type { ChannelFormDialog } from "./channel-dialogs";
import { CHANNEL_TABS, useChannelForm } from "./useChannelForm";
import ChannelBasicsTab from "./ChannelBasicsTab.vue";
import ChannelDescriptionTab from "./ChannelDescriptionTab.vue";
import ChannelAudioTab from "./ChannelAudioTab.vue";
import ChannelLimitsTab from "./ChannelLimitsTab.vue";
import ChannelAdvancedTab from "./ChannelAdvancedTab.vue";

const props = defineProps<{ dialog: ChannelFormDialog }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();

const state = useChannelForm(props.dialog, () => emit("close"));
const { form, tab } = state;

const title = computed(() => {
  if (state.editing) return t("chm.titleEdit");
  return state.parent ? t("chm.titleCreateSub") : t("chm.titleCreate");
});
const subtitle = computed(() => {
  if (state.editing) return state.channel.value?.name;
  return state.parent ? t("chm.under", { name: state.parent.name }) : undefined;
});
const busy = computed(() => form.submitting.value);
</script>

<template>
  <AppDialog
    as="form"
    width="560px"
    :title="title"
    :subtitle="subtitle"
    :dismissible="!busy"
    @submit="state.submit"
    @close="emit('close')"
  >
    <div class="tabs" role="tablist" data-testid="channel-dialog">
      <button
        v-for="x in CHANNEL_TABS"
        :key="x.id"
        type="button"
        role="tab"
        :data-tab="x.id"
        :aria-selected="tab === x.id"
        :class="{ active: tab === x.id, invalid: state.tabHasError(x.id) }"
        @click="tab = x.id"
      >
        {{ t(x.label) }}
      </button>
    </div>
    <div class="panel" role="tabpanel">
      <ChannelBasicsTab v-if="tab === 'basics'" :state="state" />
      <ChannelDescriptionTab v-else-if="tab === 'description'" :state="state" />
      <ChannelAudioTab v-else-if="tab === 'audio'" :state="state" />
      <ChannelLimitsTab v-else-if="tab === 'limits'" :state="state" />
      <ChannelAdvancedTab v-else :state="state" />
    </div>
    <p v-if="form.formError.value" class="note error" data-testid="channel-form-error">
      {{ form.formError.value }}
    </p>
    <template #footer>
      <button type="button" @click="emit('close')">{{ t("dialog.cancel") }}</button>
      <button type="submit" class="primary" :disabled="busy">
        {{ state.editing ? t("chm.save") : t("chm.createSubmit") }}
      </button>
    </template>
  </AppDialog>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  flex: none;
}
.tabs > button {
  flex: 1;
  padding: 4px 8px;
  font-size: 12px;
  white-space: nowrap;
}
.tabs > button.active {
  border-color: var(--accent);
  color: var(--accent);
}
.tabs > button.invalid {
  border-color: var(--danger);
  color: var(--danger);
}
.panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 260px;
}
.note.error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}
</style>
