<script setup lang="ts">
/**
 * Send an offline message (`messageadd`) to a UID, so it reaches someone who
 * is not online. Needs b_client_offline_textmessage_send; the recipient is
 * picked by RecipientPicker or comes from the menu / a reply.
 */
import {
  OFFLINE_MESSAGE_MAX,
  OFFLINE_MESSAGE_MAX_BYTES,
  OFFLINE_SUBJECT_MAX,
} from "@jinz/protocol";
import AppDialog from "../ui/AppDialog.vue";
import FormField from "../ui/FormField.vue";
import { rules, useForm } from "../../composables/useForm";
import { useI18n } from "../../i18n";
import { sendOfflineMessage } from "../../ts/admin-actions";
import RecipientPicker from "./RecipientPicker.vue";
import type { Recipient } from "./admin-dialogs";

const props = defineProps<{ uid?: string; nickname?: string; subject?: string }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
/** What the hub's schema accepts; a real UID is 28 base64 characters. */
const UID_CHARS = /^[A-Za-z0-9+/=]{1,64}$/;

const form = useForm({
  initial: () => ({
    uid: props.uid ?? "",
    nickname: props.nickname ?? "",
    subject: props.subject ?? "",
    message: "",
  }),
  rules: {
    uid: [
      rules.required(t("admin.compose.needRecipient")),
      (v) => (UID_CHARS.test(v.trim()) ? null : t("admin.compose.badUid")),
    ],
    subject: [(v) => rules.required()(v.trim()), rules.maxLength(OFFLINE_SUBJECT_MAX)],
    message: [
      rules.maxLength(OFFLINE_MESSAGE_MAX),
      // Mostly-CJK text reaches the server's packet limit before the character one.
      (v) =>
        new TextEncoder().encode(v).length > OFFLINE_MESSAGE_MAX_BYTES
          ? t("admin.compose.tooLong")
          : null,
    ],
  },
  onSubmit: async ({ uid, subject, message }) => {
    try {
      await sendOfflineMessage(uid, subject, message);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  },
});

function pick(r: Recipient): void {
  form.values.uid = r.uid;
  form.values.nickname = r.nickname;
}

async function submit(): Promise<void> {
  if (await form.submit()) emit("close");
}
</script>

<template>
  <AppDialog
    as="form"
    width="520px"
    :title="t('admin.compose.title')"
    :dismissible="!form.submitting.value"
    @submit="submit"
    @close="emit('close')"
  >
    <FormField
      v-slot="f"
      :label="t('admin.compose.to')"
      :hint="form.values.nickname || undefined"
      :error="form.errors.uid"
      required
    >
      <input
        :id="f.id"
        v-model="form.values.uid"
        data-testid="compose-uid"
        :placeholder="t('admin.compose.uidPlaceholder')"
        autocomplete="off"
        :aria-describedby="f.describedby"
        :aria-invalid="f.invalid"
        @input="form.values.nickname = ''"
        @blur="form.touch('uid')"
      />
    </FormField>
    <RecipientPicker v-if="!props.uid" @pick="pick" />
    <FormField v-slot="f" :label="t('admin.compose.subject')" :error="form.errors.subject" required>
      <input
        :id="f.id"
        v-model="form.values.subject"
        data-testid="compose-subject"
        :maxlength="OFFLINE_SUBJECT_MAX"
        :autofocus="!!props.uid"
        autocomplete="off"
        :aria-describedby="f.describedby"
        :aria-invalid="f.invalid"
        @blur="form.touch('subject')"
      />
    </FormField>
    <FormField v-slot="f" :label="t('admin.compose.message')" :error="form.errors.message">
      <textarea
        :id="f.id"
        v-model="form.values.message"
        data-testid="compose-message"
        rows="5"
        :maxlength="OFFLINE_MESSAGE_MAX"
        :aria-describedby="f.describedby"
        :aria-invalid="f.invalid"
      ></textarea>
    </FormField>
    <p v-if="form.formError.value" class="err" role="alert">{{ form.formError.value }}</p>
    <template #footer>
      <button type="button" @click="emit('close')">{{ t("dialog.cancel") }}</button>
      <button type="submit" class="primary" :disabled="form.submitting.value">
        {{ t("admin.compose.send") }}
      </button>
    </template>
  </AppDialog>
</template>

<style scoped src="./admin.css"></style>
