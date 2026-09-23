<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "../../i18n";
import { useIdentitiesStore } from "../../stores/identities";
import type { StoredIdentity } from "../../identity/book";
import IdentityManager from "./IdentityManager.vue";

/**
 * Identity row of the connect dialog: which identity to connect with, its UID
 * and level at a glance, and the way into the manager. Picking one hands its
 * nickname preset to the dialog (the only per-user preset in fixed-server mode).
 */
const emit = defineEmits<{ picked: [identity: StoredIdentity] }>();
const store = useIdentitiesStore();
const { t } = useI18n();
const managing = ref(false);

function onSelect(ev: Event): void {
  const id = (ev.target as HTMLSelectElement).value;
  store.select(id);
  if (store.active) emit("picked", store.active);
}

function closeManager(): void {
  managing.value = false;
  if (store.active) emit("picked", store.active);
}
</script>

<template>
  <div class="identity">
    <span class="label">{{ t("identity.label") }}</span>
    <div class="row">
      <select
        v-if="store.items.length"
        :value="store.active?.id"
        data-testid="identity-select"
        @change="onSelect"
      >
        <option v-for="item in store.items" :key="item.id" :value="item.id">
          {{ item.name }}{{ item.nickname ? ` (${item.nickname})` : "" }}
        </option>
      </select>
      <span v-else class="none">{{ t("identity.willCreate") }}</span>
      <button type="button" class="ghost" data-testid="identity-manage" @click="managing = true">
        {{ t("identity.manage") }}
      </button>
    </div>
    <p v-if="store.active" class="facts">
      <code :title="t('identity.uid')">{{ store.active.uid }}</code>
      · {{ t("identity.levelShort", { level: store.active.level }) }}
    </p>
    <IdentityManager v-if="managing" @close="closeManager" />
  </div>
</template>

<style scoped>
.identity {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--text-dim);
  font-size: 12px;
}
.row {
  display: flex;
  gap: 8px;
  align-items: center;
}
select {
  flex: 1;
  min-width: 0;
}
.none {
  flex: 1;
}
.ghost {
  background: transparent;
  color: var(--text-dim);
  white-space: nowrap;
}
.facts {
  margin: 0;
  font-size: 11px;
  word-break: break-all;
}
</style>
