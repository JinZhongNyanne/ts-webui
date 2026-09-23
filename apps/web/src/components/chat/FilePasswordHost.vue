<script setup lang="ts">
/** The channel password prompt for files shared in chat (chat/files/password-prompt.ts). */
import { ref, watch } from "vue";
import { useI18n } from "../../i18n";
import { answerPassword, passwordRequest } from "../../chat/files/password-prompt";
import TextPromptDialog from "../TextPromptDialog.vue";

const { t } = useI18n();
const value = ref("");

// Each request starts empty: the last one may have been for another channel.
watch(passwordRequest, () => (value.value = ""));

function submit(): void {
  if (value.value) answerPassword(value.value);
}
</script>

<template>
  <TextPromptDialog
    v-if="passwordRequest"
    v-model="value"
    type="password"
    :title="t('chatFiles.passwordTitle', { channel: passwordRequest.channel })"
    :subtitle="t('chatFiles.passwordSubtitle')"
    :submit-label="t('chatFiles.passwordSubmit')"
    :cancel-label="t('dialog.cancel')"
    :maxlength="128"
    @submit="submit"
    @cancel="answerPassword(null)"
  />
</template>
