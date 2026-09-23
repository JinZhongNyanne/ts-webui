<script setup lang="ts">
/**
 * Kick someone from their channel (they land in the default channel) or from
 * the server, with an optional reason they get to see. Offered where
 * i_client_kick_from_channel_power / i_client_kick_from_server_power is not
 * known to be 0; the server compares it with the target's needed power, and a
 * refusal is shown here with the permission it named.
 */
import { ref } from "vue";
import { KICK_REASON_MAX } from "@jinz/protocol";
import AppDialog from "../ui/AppDialog.vue";
import FormField from "../ui/FormField.vue";
import { useTsStore } from "../../stores/ts";
import { useTargetClient } from "../../composables/useTargetClient";
import { useI18n } from "../../i18n";
import { kickClient, type KickScope } from "../../ts/moderation-actions";

const props = defineProps<{ clientId: number; scope: KickScope }>();
const emit = defineEmits<{ close: [] }>();
const ts = useTsStore();
const { t } = useI18n();

// Closes if they leave: their id may go to the next person to join.
const client = useTargetClient(ts.clients, props.clientId, () => emit("close"));
const reason = ref("");
const busy = ref(false);
const error = ref<string | null>(null);

async function kick(): Promise<void> {
  if (busy.value) return;
  if (!client.value) {
    error.value = t("tsErr.invalidClient");
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await kickClient(props.clientId, props.scope, reason.value);
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
    width="400px"
    danger
    :title="scope === 'channel' ? t('mod.kickChannelTitle') : t('mod.kickServerTitle')"
    :subtitle="client?.nickname"
    :dismissible="!busy"
    @submit="kick"
    @close="emit('close')"
  >
    <FormField
      data-testid="kick-dialog"
      v-slot="f"
      :label="t('mod.kickReason')"
      :hint="t('mod.kickReasonHint', { n: KICK_REASON_MAX })"
      :error="error"
    >
      <input
        :id="f.id"
        v-model="reason"
        :maxlength="KICK_REASON_MAX"
        autocomplete="off"
        autofocus
        :aria-describedby="f.describedby"
        :aria-invalid="f.invalid"
      />
    </FormField>
    <template #footer>
      <button type="button" @click="emit('close')">{{ t("dialog.cancel") }}</button>
      <button type="submit" class="danger" :disabled="busy">{{ t("mod.kick") }}</button>
    </template>
  </AppDialog>
</template>
