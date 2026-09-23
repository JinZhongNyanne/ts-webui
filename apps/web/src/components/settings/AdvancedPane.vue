<script setup lang="ts">
/** Settings pane for the rarely needed tools: the connection log. */
import { useTsStore } from "../../stores/ts";
import { useI18n } from "../../i18n";

const ts = useTsStore();
const { t } = useI18n();
</script>

<template>
  <div class="pane">
    <section>
      <label class="row">
        <span>{{ t("status.log") }}</span>
        <input v-model="ts.showLog" type="checkbox" data-testid="settings-show-log" />
      </label>
      <p class="hint">{{ t("settings.logHint") }}</p>
    </section>
  </div>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--text-dim);
}
.row input[type="checkbox"] {
  width: auto;
}
.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-dim);
}
</style>
