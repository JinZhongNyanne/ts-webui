<script setup lang="ts">
/**
 * Rename ourselves while connected. The server has the last word (a name in
 * use, a reserved one), and its answer lands under the field.
 */
import AppDialog from "../ui/AppDialog.vue";
import FormField from "../ui/FormField.vue";
import { rules, useForm } from "../../composables/useForm";
import { useTsStore } from "../../stores/ts";
import { useI18n } from "../../i18n";
import { changeNickname } from "../../ts/client-actions";
import { NICKNAME_MAX, NICKNAME_MIN } from "../../ts/client-features";

const emit = defineEmits<{ close: [] }>();
const ts = useTsStore();
const { t } = useI18n();

const form = useForm({
  initial: () => ({ nickname: ts.selfClient?.nickname ?? "" }),
  rules: {
    nickname: [
      rules.required(),
      // Trimmed first, as the hub's schema does: "  ab  " is two characters.
      (v) => rules.minLength(NICKNAME_MIN)(v.trim()),
      rules.maxLength(NICKNAME_MAX),
    ],
  },
  onSubmit: async ({ nickname }) => {
    if (nickname.trim() === ts.selfClient?.nickname) return;
    try {
      await changeNickname(nickname);
    } catch (err) {
      return { fields: { nickname: err instanceof Error ? err.message : String(err) } };
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
    :title="t('nick.title')"
    :dismissible="!form.submitting.value"
    @submit="submit"
    @close="emit('close')"
  >
    <FormField
      data-testid="nickname-dialog"
      v-slot="f"
      :label="t('connect.nickname')"
      :error="form.errors.nickname"
      required
    >
      <input
        :id="f.id"
        v-model="form.values.nickname"
        :maxlength="NICKNAME_MAX"
        autocomplete="off"
        autofocus
        :aria-describedby="f.describedby"
        :aria-invalid="f.invalid"
        @blur="form.touch('nickname')"
      />
    </FormField>
    <template #footer>
      <button type="button" @click="emit('close')">{{ t("dialog.cancel") }}</button>
      <button type="submit" class="primary" :disabled="form.submitting.value">
        {{ t("nick.save") }}
      </button>
    </template>
  </AppDialog>
</template>
