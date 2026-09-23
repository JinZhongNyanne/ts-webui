<script setup lang="ts">
/**
 * Edit a client's description: our own (b_client_modify_own_description) or
 * someone else's (b_client_modify_description). The menu only offers it where
 * the permission says yes, but the server decides, and a refusal is shown
 * here with the permission it wanted.
 */
import { ref } from "vue";
import AppDialog from "../ui/AppDialog.vue";
import FormField from "../ui/FormField.vue";
import { useTsStore } from "../../stores/ts";
import { useTargetClient } from "../../composables/useTargetClient";
import { useI18n } from "../../i18n";
import { setDescription } from "../../ts/client-actions";
import { DESCRIPTION_MAX } from "../../ts/client-features";

const props = defineProps<{ clientId: number }>();
const emit = defineEmits<{ close: [] }>();
const ts = useTsStore();
const { t } = useI18n();

// Closes if they leave: their id may go to the next person to join.
const client = useTargetClient(ts.clients, props.clientId, () => emit("close"));
const text = ref(client.value?.description ?? "");
const busy = ref(false);
const error = ref<string | null>(null);

async function save(): Promise<void> {
  if (busy.value) return;
  if (!client.value) {
    error.value = t("tsErr.invalidClient");
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await setDescription(props.clientId, text.value);
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
    width="420px"
    :title="t('desc.title')"
    :subtitle="client?.nickname"
    :dismissible="!busy"
    @submit="save"
    @close="emit('close')"
  >
    <FormField
      data-testid="description-dialog"
      v-slot="f"
      :label="t('info.clientDescription')"
      :hint="t('desc.hint', { n: DESCRIPTION_MAX - [...text].length })"
      :error="error"
    >
      <textarea
        :id="f.id"
        v-model="text"
        rows="4"
        :maxlength="DESCRIPTION_MAX"
        autofocus
        :aria-describedby="f.describedby"
        :aria-invalid="f.invalid"
      ></textarea>
    </FormField>
    <template #footer>
      <button type="button" @click="emit('close')">{{ t("dialog.cancel") }}</button>
      <button type="submit" class="primary" :disabled="busy">{{ t("desc.save") }}</button>
    </template>
  </AppDialog>
</template>

<style scoped>
textarea {
  width: 100%;
  resize: vertical;
  font: inherit;
}
</style>
