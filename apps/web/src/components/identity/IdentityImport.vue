<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "../../i18n";
import { useIdentitiesStore } from "../../stores/identities";
import { identityErrorText } from "../../identity/errors";

/** Paste a string / `.ini` text, or pick an `.ini` file; validated before anything is saved. */
const emit = defineEmits<{ imported: [id: string] }>();
const store = useIdentitiesStore();
const { t } = useI18n();

/** Identity exports are a few hundred bytes; anything huge is not one. */
const MAX_FILE_BYTES = 64 * 1024;

const text = ref("");
const error = ref("");
const result = ref("");

function run(input: string): void {
  error.value = "";
  result.value = "";
  try {
    const r = store.importText(input);
    result.value = t("identity.importResult", { added: r.added, merged: r.merged });
    text.value = "";
    if (r.lastId) emit("imported", r.lastId);
  } catch (err) {
    error.value = identityErrorText(err);
  }
}

async function onFile(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    error.value = t("identity.errFileTooBig");
    return;
  }
  run(await file.text());
}
</script>

<template>
  <details class="import">
    <summary>{{ t("identity.import") }}</summary>
    <p class="hint">{{ t("identity.importHint") }}</p>
    <textarea
      v-model="text"
      rows="4"
      spellcheck="false"
      :placeholder="t('identity.importPlaceholder')"
      data-testid="identity-import-text"
    ></textarea>
    <div class="actions">
      <label class="file">
        <input type="file" accept=".ini,.txt,text/plain" @change="onFile" />
        <span>{{ t("identity.importFile") }}</span>
      </label>
      <button type="button" :disabled="!text.trim()" @click="run(text)">
        {{ t("identity.importSubmit") }}
      </button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="result" class="ok">{{ result }}</p>
  </details>
</template>

<style scoped>
.import {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
summary {
  cursor: pointer;
  color: var(--text-dim);
  font-size: 13px;
}
textarea {
  width: 100%;
  margin-top: 8px;
  font-family: monospace;
  font-size: 11px;
}
.actions {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
}
.file {
  position: relative;
  cursor: pointer;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  color: var(--text-dim);
}
.file input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.hint {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--text-dim);
}
.error {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--danger);
}
.ok {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--accent);
}
</style>
