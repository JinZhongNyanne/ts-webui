<script setup lang="ts">
/**
 * File a complaint about a client (`complainadd`). Offered where our
 * i_client_complain_power is not known to be 0; the server compares it with
 * the target's needed power and its refusal lands under the field.
 */
import { COMPLAINT_MAX } from "@jinz/protocol";
import AppDialog from "../ui/AppDialog.vue";
import FormField from "../ui/FormField.vue";
import { rules, useForm } from "../../composables/useForm";
import { useI18n } from "../../i18n";
import { fileComplaint } from "../../ts/admin-actions";
import { TsCommandError } from "../../ts/commands";
import { errorText } from "./useBusy";

const TS_DUPLICATE_ENTRY = "1282";

const props = defineProps<{ dbId: string; nickname: string }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();

const form = useForm({
  initial: { message: "" },
  rules: {
    message: [(v) => rules.required()(v.trim()), rules.maxLength(COMPLAINT_MAX)],
  },
  onSubmit: async ({ message }) => {
    try {
      await fileComplaint(props.dbId, message);
    } catch (err) {
      // The server keeps one complaint per complainer and target (1282, duplicate entry).
      const duplicate = err instanceof TsCommandError && err.code === TS_DUPLICATE_ENTRY;
      const text = duplicate ? t("admin.complain.duplicate") : errorText(err);
      return { fields: { message: text } };
    }
  },
});

async function submit(): Promise<void> {
  if (await form.submit()) emit("close");
}
</script>

<template>
  <AppDialog
    as="form"
    width="420px"
    :title="t('admin.complain.title')"
    :subtitle="nickname"
    :dismissible="!form.submitting.value"
    @submit="submit"
    @close="emit('close')"
  >
    <FormField
      data-testid="complain-dialog"
      v-slot="f"
      :label="t('admin.complain.reason')"
      :hint="t('desc.hint', { n: COMPLAINT_MAX - [...form.values.message].length })"
      :error="form.errors.message"
      required
    >
      <textarea
        :id="f.id"
        v-model="form.values.message"
        rows="3"
        :maxlength="COMPLAINT_MAX"
        autofocus
        :aria-describedby="f.describedby"
        :aria-invalid="f.invalid"
        @blur="form.touch('message')"
      ></textarea>
    </FormField>
    <template #footer>
      <button type="button" @click="emit('close')">{{ t("dialog.cancel") }}</button>
      <button type="submit" class="primary" :disabled="form.submitting.value">
        {{ t("admin.complain.send") }}
      </button>
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
