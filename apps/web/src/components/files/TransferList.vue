<script setup lang="ts">
/**
 * The file transfer queue (stores/transfers.ts) at the bottom of the file
 * browser window: one row per upload or download started there, with its
 * progress, state and a cancel button. Chat's uploads show in the composer
 * and an avatar or icon in its own dialog, so neither shows up here.
 */
import { computed } from "vue";
import { formatBytes } from "@jinz/protocol";
import { useTransfersStore } from "../../stores/transfers";
import { isFinished, type Transfer } from "../../files/transfer-queue";
import { useI18n } from "../../i18n";

const store = useTransfersStore();
const { t } = useI18n();

const rows = computed(() => store.listed);
const anyFinished = computed(() => rows.value.some(isFinished));

/** A transfer the hub had no free slot for waits its turn (stores/transfers.ts). */
function stateText(item: Transfer): string {
  if (item.error) return item.error;
  if (item.state === "queued" && item.waitUntil !== undefined) return t("transfers.state.waiting");
  return t(`transfers.state.${item.state}`);
}

function percent(item: Transfer): number {
  if (item.state === "done") return 100;
  return item.size > 0 ? Math.floor((item.loaded / item.size) * 100) : 0;
}

function sizeText(item: Transfer): string {
  if (item.kind === "upload" && item.state === "running") {
    return `${formatBytes(item.loaded)} / ${formatBytes(item.size)}`;
  }
  return item.size > 0 ? formatBytes(item.size) : "";
}
</script>

<template>
  <section class="transfers" data-testid="transfer-list">
    <header>
      <h3>{{ t("transfers.title") }}</h3>
      <button
        v-if="anyFinished"
        type="button"
        class="clear"
        data-testid="transfer-clear"
        @click="store.clearFinished()"
      >
        {{ t("transfers.clear") }}
      </button>
    </header>
    <p v-if="rows.length === 0" class="empty">{{ t("transfers.empty") }}</p>
    <ul v-else>
      <li
        v-for="item in rows"
        :key="item.id"
        :class="['item', item.state]"
        :data-state="item.state"
        data-testid="transfer-item"
      >
        <span class="kind" :title="t(`transfers.${item.kind}`)" aria-hidden="true">
          {{ item.kind === "upload" ? "↑" : "↓" }}
        </span>
        <div class="main">
          <div class="line">
            <span class="name" :title="item.path">{{ item.name }}</span>
            <span class="size">{{ sizeText(item) }}</span>
          </div>
          <progress
            v-if="item.kind === 'upload' && item.state === 'running'"
            max="100"
            :value="percent(item)"
          />
          <span class="state" data-testid="transfer-state">{{ stateText(item) }}</span>
        </div>
        <button
          v-if="!isFinished(item)"
          type="button"
          class="icon"
          :title="t('transfers.cancel')"
          :aria-label="t('transfers.cancel')"
          data-testid="transfer-cancel"
          @click="store.cancel(item.id)"
        >
          ✕
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.transfers {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
h3 {
  margin: 0;
  font-size: 13px;
}
.empty {
  color: var(--text-dim);
  font-size: 12px;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elev);
  font-size: 12px;
}
.item.failed {
  border-color: var(--danger);
}
.kind {
  flex: none;
  width: 1.2em;
  text-align: center;
  color: var(--text-dim);
}
.main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.line {
  display: flex;
  gap: 6px;
  justify-content: space-between;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.size,
.state {
  flex: none;
  color: var(--text-dim);
}
.item.failed .state {
  color: var(--danger);
}
progress {
  width: 100%;
  height: 4px;
}
.icon {
  flex: none;
}
</style>
