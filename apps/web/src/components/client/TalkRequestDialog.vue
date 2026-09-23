<script setup lang="ts">
/**
 * Ask for talk power in a channel that needs more than we have. The reason is
 * optional; whoever can grant it sees the request (✋) and the reason in the
 * tree's tooltip.
 */
import { ref } from "vue";
import AppDialog from "../ui/AppDialog.vue";
import FormField from "../ui/FormField.vue";
import { useTsStore } from "../../stores/ts";
import { useI18n } from "../../i18n";
import { requestTalkPower } from "../../ts/client-actions";
import { TALK_REQUEST_MAX } from "../../ts/client-features";

const emit = defineEmits<{ close: [] }>();
const ts = useTsStore();
const { t } = useI18n();

const message = ref("");
const busy = ref(false);
const error = ref<string | null>(null);

async function send(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    await requestTalkPower(message.value);
    emit("close");
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppDialog
    as="form"
    :title="t('talk.requestTitle')"
    :subtitle="ts.selfChannel?.name"
    :dismissible="!busy"
    @submit="send"
    @close="emit('close')"
  >
    <FormField
      data-testid="talk-request-dialog"
      v-slot="f"
      :label="t('talk.reason')"
      :error="error"
    >
      <input
        :id="f.id"
        v-model="message"
        :maxlength="TALK_REQUEST_MAX"
        autocomplete="off"
        autofocus
        :aria-describedby="f.describedby"
        :aria-invalid="f.invalid"
      />
    </FormField>
    <template #footer>
      <button type="button" @click="emit('close')">{{ t("dialog.cancel") }}</button>
      <button type="submit" class="primary" :disabled="busy">{{ t("talk.send") }}</button>
    </template>
  </AppDialog>
</template>
