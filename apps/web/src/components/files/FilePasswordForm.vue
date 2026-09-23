<script setup lang="ts">
/**
 * In place of the listing when the server wants the channel's password
 * (781). What is typed is kept for this session (file browser store), so the
 * next folder, download or upload in that channel does not ask again.
 */
import { ref } from "vue";
import { useI18n } from "../../i18n";

defineProps<{ channelName: string; wrong: boolean }>();
const emit = defineEmits<{ submit: [password: string] }>();
const { t } = useI18n();
const password = ref("");

function submit(): void {
  emit("submit", password.value);
  password.value = "";
}
</script>

<template>
  <form class="pw" data-testid="fb-password" @submit.prevent="submit">
    <p class="title">🔒 {{ t("fb.passwordTitle", { name: channelName }) }}</p>
    <p class="hint" :class="{ wrong }">
      {{ wrong ? t("fb.passwordWrong") : t("fb.passwordHint") }}
    </p>
    <div class="row">
      <input
        v-model="password"
        type="password"
        autocomplete="off"
        :aria-label="t('fb.password')"
        :placeholder="t('fb.password')"
        autofocus
      />
      <button type="submit" class="primary">{{ t("fb.passwordSubmit") }}</button>
    </div>
  </form>
</template>

<style scoped>
.pw {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 340px;
  margin: 24px auto;
  padding: 0 12px;
}
.title {
  margin: 0;
  font-weight: 600;
}
.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-dim);
}
.hint.wrong {
  color: var(--danger);
}
.row {
  display: flex;
  gap: 6px;
}
.row input {
  flex: 1;
  min-width: 0;
}
</style>
