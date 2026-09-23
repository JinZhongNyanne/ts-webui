<script setup lang="ts">
import { computed, ref } from "vue";
import { useHubAccessStore, type LoginError } from "../stores/hubAccess";
import { useI18n } from "../i18n";
import LanguageSelect from "./LanguageSelect.vue";

const access = useHubAccessStore();
const { t } = useI18n();
const password = ref("");
const busy = ref(false);
const error = ref<LoginError | null>(null);

const errorText = computed(() => {
  switch (error.value) {
    case "wrong":
      return t("hubLogin.wrong");
    case "rateLimited":
      return t("hubLogin.rateLimited");
    case "failed":
      return t("hubLogin.failed");
    default:
      return null;
  }
});

async function submit(): Promise<void> {
  if (busy.value || !password.value) return;
  busy.value = true;
  error.value = null;
  try {
    error.value = await access.login(password.value);
  } finally {
    busy.value = false;
    // Never keep the password around longer than the request needs it.
    password.value = "";
  }
}
</script>

<template>
  <div class="overlay">
    <div v-if="access.state === 'checking'" class="dialog glass status">
      {{ t("hubLogin.checking") }}
    </div>
    <div v-else-if="access.state === 'unreachable'" class="dialog glass">
      <p class="error">{{ t("hubLogin.unreachable") }}</p>
      <div class="actions">
        <button type="button" class="primary" @click="access.check()">
          {{ t("hubLogin.retry") }}
        </button>
      </div>
    </div>
    <form v-else class="dialog glass" @submit.prevent="submit">
      <div class="head">
        <h2>{{ t("hubLogin.title") }}</h2>
        <LanguageSelect />
      </div>
      <label>
        <span>{{ t("hubLogin.password") }}</span>
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
          maxlength="200"
          required
          autofocus
        />
      </label>
      <p v-if="errorText" class="error">{{ errorText }}</p>
      <div class="actions">
        <button type="submit" class="primary" :disabled="busy || !password">
          {{ busy ? t("hubLogin.checking") : t("hubLogin.submit") }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.overlay {
  position: absolute;
  inset: 0;
  overflow: auto;
  display: grid;
  place-items: center;
  background: radial-gradient(ellipse at top, rgba(255, 255, 255, 0.045), transparent 70%);
}
.dialog {
  width: min(360px, 92vw);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}
.status {
  color: var(--text-dim);
  text-align: center;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
h2 {
  margin: 0;
  font-size: 18px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--text-dim);
  font-size: 12px;
}
label input {
  width: 100%;
}
.actions {
  display: flex;
  justify-content: flex-end;
}
.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
  padding: 8px 18px;
}
.error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}

@media (max-width: 768px) {
  .overlay {
    place-items: start center;
    padding: 16px 12px calc(24px + env(safe-area-inset-bottom, 0px));
  }
  .dialog {
    width: 100%;
    padding: 18px 16px;
  }
  .actions button {
    width: 100%;
    min-height: 44px;
  }
}
</style>
