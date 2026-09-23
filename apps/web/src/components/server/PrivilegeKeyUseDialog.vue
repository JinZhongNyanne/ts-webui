<script setup lang="ts">
/**
 * Redeem a privilege key (`privilegekeyuse`): the group it names is granted
 * the moment the server accepts it, which the tree and the perms store then
 * show on their own. Offered on b_virtualserver_token_use, which a stock
 * Guest group has (server-gates.ts); a key the server does not know (3840)
 * is said so under the field.
 */
import AppDialog from "../ui/AppDialog.vue";
import FormField from "../ui/FormField.vue";
import { useForm } from "../../composables/useForm";
import { useI18n } from "../../i18n";
import { useTsStore } from "../../stores/ts";
import { errorText } from "../admin/useBusy";
import { redeemPrivilegeKey } from "./server-actions";
import { cleanPrivilegeKey } from "./server-rows";

const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const ts = useTsStore();

const form = useForm({
  initial: { key: "" },
  rules: { key: [(v) => (cleanPrivilegeKey(v) ? null : t("server.pk.notAKey"))] },
  onSubmit: async ({ key }) => {
    try {
      await redeemPrivilegeKey(cleanPrivilegeKey(key)!);
    } catch (err) {
      return { fields: { key: errorText(err) } };
    }
  },
});

async function submit(): Promise<void> {
  if (!(await form.submit())) return;
  ts.pushEvent(t("server.pk.redeemed"), "info");
  emit("close");
}
</script>

<template>
  <AppDialog
    as="form"
    width="440px"
    :title="t('server.pk.useTitle')"
    :dismissible="!form.submitting.value"
    @submit="submit"
    @close="emit('close')"
  >
    <FormField
      v-slot="f"
      data-testid="pk-use-dialog"
      :label="t('server.pk.key')"
      :hint="t('server.pk.useHint')"
      :error="form.errors.key"
      required
    >
      <input
        :id="f.id"
        v-model="form.values.key"
        data-testid="pk-use-input"
        autocomplete="off"
        spellcheck="false"
        autofocus
        :aria-describedby="f.describedby"
        :aria-invalid="f.invalid"
        @blur="form.touch('key')"
      />
    </FormField>
    <template #footer>
      <button type="button" @click="emit('close')">{{ t("dialog.cancel") }}</button>
      <button
        type="submit"
        class="primary"
        data-testid="pk-use-submit"
        :disabled="form.submitting.value"
      >
        {{ t("server.pk.redeem") }}
      </button>
    </template>
  </AppDialog>
</template>

<style scoped>
input {
  width: 100%;
  font-family: ui-monospace, "Consolas", monospace;
}
</style>
