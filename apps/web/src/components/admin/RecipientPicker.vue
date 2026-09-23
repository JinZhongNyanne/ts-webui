<script setup lang="ts">
/**
 * Picks who an offline message goes to: a UID typed or pasted as is, someone
 * online (filtered as you type), or a search of the client database
 * (`clientdbfind`, where b_virtualserver_client_dbsearch allows it).
 */
import { computed, ref, shallowRef } from "vue";
import { useI18n } from "../../i18n";
import { useTsStore } from "../../stores/ts";
import { searchClientDb } from "../../ts/admin-actions";
import { looksLikeUid } from "../../ts/admin-rows";
import { useAdminGates } from "./useAdminGates";
import { useBusy } from "./useBusy";
import type { Recipient } from "./admin-dialogs";

const emit = defineEmits<{ pick: [Recipient] }>();
const { t } = useI18n();
const ts = useTsStore();
const gates = useAdminGates();
const { busy, error, run } = useBusy();

const query = ref("");
const found = shallowRef<readonly Recipient[]>([]);
const searched = ref(false);

const online = computed<Recipient[]>(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return [];
  return [...ts.clients.values()]
    .filter((c) => c.type === 0 && !c.isSelf && c.nickname.toLowerCase().includes(q))
    .slice(0, 8)
    .map((c) => ({ uid: c.uid, nickname: c.nickname }));
});

const results = computed(() => {
  const seen = new Set(online.value.map((r) => r.uid));
  return [...online.value, ...found.value.filter((r) => !seen.has(r.uid))];
});

const canSearchDb = computed(() => gates.clientDb() && gates.searchDb());

async function searchDb(): Promise<void> {
  const q = query.value.trim();
  if (!q || busy.value) return;
  if (looksLikeUid(q)) {
    emit("pick", { uid: q, nickname: "" });
    return;
  }
  // Enter lands here too; without the permission the online matches are all there is.
  if (!canSearchDb.value) return;
  const res = await run(() => searchClientDb(q));
  searched.value = true;
  found.value = (res?.entries ?? []).map((e) => ({ uid: e.uid, nickname: e.nickname }));
}

function pick(r: Recipient): void {
  emit("pick", r);
  query.value = "";
  found.value = [];
  searched.value = false;
}
</script>

<template>
  <div class="picker">
    <div class="toolbar">
      <input
        v-model="query"
        class="grow"
        data-testid="recipient-search"
        :placeholder="t('admin.compose.searchPlaceholder')"
        autocomplete="off"
        @keydown.enter.prevent="searchDb"
      />
      <button v-if="canSearchDb" type="button" :disabled="busy || !query.trim()" @click="searchDb">
        {{ t("admin.db.search") }}
      </button>
    </div>
    <p v-if="error" class="err" role="alert">{{ error }}</p>
    <ul v-if="results.length" class="rows">
      <li v-for="r in results" :key="r.uid" class="row">
        <div class="main">
          <span class="title">{{ r.nickname }}</span>
          <span class="meta">{{ r.uid }}</span>
        </div>
        <div class="actions">
          <button type="button" data-testid="recipient-pick" @click="pick(r)">
            {{ t("admin.compose.pick") }}
          </button>
        </div>
      </li>
    </ul>
    <p v-else-if="searched && !busy" class="empty">{{ t("admin.db.noMatches") }}</p>
  </div>
</template>

<style scoped src="./admin.css"></style>
<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
