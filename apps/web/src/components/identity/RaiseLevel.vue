<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { useI18n } from "../../i18n";
import { useIdentitiesStore } from "../../stores/identities";
import type { StoredIdentity } from "../../identity/book";
import { publicKeyBase64 } from "../../identity/keys";
import { MAX_TARGET_LEVEL, expectedTries } from "../../identity/levelSearch";
import { LevelSearchCancelled, raiseLevel, type LevelJob } from "../../identity/raiseLevel";

/**
 * Raises one identity's security level in a web worker. Each level doubles the
 * expected work, so the user sees tries vs. the expected count and can stop.
 */
const props = defineProps<{ identity: StoredIdentity }>();
const store = useIdentitiesStore();
const { t } = useI18n();

const target = ref(Math.min(props.identity.level + 1, MAX_TARGET_LEVEL));
const job = ref<LevelJob | null>(null);
const tried = ref(0);
const error = ref("");
const done = ref(false);

const expected = computed(() => expectedTries(target.value));
const percent = computed(() =>
  Math.min(99, Math.round((tried.value / Math.max(1, expected.value)) * 100)),
);
const fmt = (n: number): string => Math.round(n).toLocaleString();

async function start(): Promise<void> {
  if (job.value) return;
  error.value = "";
  done.value = false;
  tried.value = 0;
  const key = store.keyOf(props.identity);
  const running = raiseLevel(publicKeyBase64(key.d), key.offset + 1n, target.value, (n) => {
    tried.value = n;
  });
  job.value = running;
  try {
    const offset = await running.result;
    store.setKey(props.identity.id, { d: key.d, offset });
    done.value = true;
  } catch (err) {
    if (!(err instanceof LevelSearchCancelled)) {
      error.value = err instanceof Error ? err.message : String(err);
    }
  } finally {
    job.value = null;
  }
}

function cancel(): void {
  job.value?.cancel();
}

onBeforeUnmount(cancel);
</script>

<template>
  <div class="raise">
    <div class="row">
      <label>
        {{ t("identity.raiseTarget") }}
        <input
          v-model.number="target"
          type="number"
          :min="identity.level + 1"
          :max="MAX_TARGET_LEVEL"
          :disabled="!!job"
        />
      </label>
      <button v-if="!job" type="button" :disabled="target <= identity.level" @click="start">
        {{ t("identity.raiseStart") }}
      </button>
      <button v-else type="button" class="danger" @click="cancel">
        {{ t("identity.raiseCancel") }}
      </button>
    </div>
    <p class="hint">{{ t("identity.raiseHint", { tries: fmt(expected) }) }}</p>
    <template v-if="job">
      <progress :value="percent" max="100"></progress>
      <p class="hint">
        {{ t("identity.raiseProgress", { tried: fmt(tried), expected: fmt(expected) }) }}
      </p>
    </template>
    <p v-if="done" class="ok">{{ t("identity.raiseDone", { level: identity.level }) }}</p>
    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<style scoped>
.raise {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.row {
  display: flex;
  align-items: end;
  gap: 8px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-dim);
}
input {
  width: 90px;
}
progress {
  width: 100%;
}
.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-dim);
}
.ok {
  margin: 0;
  font-size: 12px;
  color: var(--accent);
}
.error {
  margin: 0;
  font-size: 12px;
  color: var(--danger);
}
</style>
