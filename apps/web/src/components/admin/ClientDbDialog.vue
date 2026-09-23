<script setup lang="ts">
/**
 * The server's client database: pages of `clientdblist` (with `-count` for
 * the total), a search (`clientdbfind`, by nickname substring or exact UID,
 * with the hits' details a page at a time: one `clientdbinfo` each), and one
 * entry's details (ClientDbDetails). Opened where
 * b_virtualserver_client_dblist allows; searching needs _dbsearch.
 */
import { computed, onMounted, ref, shallowRef } from "vue";
import AppDialog from "../ui/AppDialog.vue";
import { useI18n } from "../../i18n";
import { formatDateTime } from "../../ts/assets";
import {
  DB_SEARCH_PAGE,
  clientDbInfos,
  listClientDb,
  searchClientDb,
} from "../../ts/admin-actions";
import { pageInfo, type DbEntry } from "../../ts/admin-rows";
import ClientDbDetails from "./ClientDbDetails.vue";
import { useAdminGates } from "./useAdminGates";
import { useBusy } from "./useBusy";

const PAGE_SIZE = 25;

const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const gates = useAdminGates();
const { busy, error, run } = useBusy();

const entries = shallowRef<readonly DbEntry[]>([]);
const total = ref<number | null>(null);
const start = ref(0);
const query = ref("");
/** The query the list shows results for; empty while paging. */
const searchedFor = ref("");
/** Every id the search found; `entries` holds the details fetched so far. */
const hitIds = shallowRef<readonly string[]>([]);
const more = computed(() => entries.value.length < hitIds.value.length);
const selected = shallowRef<DbEntry | null>(null);
const loaded = ref(false);

const page = computed(() => pageInfo(start.value, PAGE_SIZE, total.value, entries.value.length));

async function loadPage(at: number): Promise<void> {
  const res = await run(() => listClientDb(at, PAGE_SIZE));
  loaded.value = true;
  if (!res) return;
  start.value = at;
  entries.value = res.entries;
  // The total only comes with a page that has rows; keep the last one otherwise.
  if (res.total !== null || res.entries.length === 0) total.value = res.total ?? at;
  searchedFor.value = "";
  hitIds.value = [];
}

async function search(): Promise<void> {
  const q = query.value.trim();
  if (!q) {
    await loadPage(0);
    return;
  }
  const res = await run(() => searchClientDb(q));
  if (!res) return;
  entries.value = res.entries;
  hitIds.value = res.ids;
  searchedFor.value = q;
}

/** The next page of hits' details, only when asked for. */
async function showMore(): Promise<void> {
  const next = hitIds.value.slice(entries.value.length, entries.value.length + DB_SEARCH_PAGE);
  const res = await run(() => clientDbInfos(next));
  if (!res) return;
  const known = new Set(entries.value.map((e) => e.dbId));
  entries.value = [...entries.value, ...res.filter((e) => !known.has(e.dbId))];
  // Entries deleted since the search come back as nothing: drop their ids.
  const got = new Set(res.map((e) => e.dbId));
  hitIds.value = hitIds.value.filter((id) => !next.includes(id) || got.has(id));
}

function clearSearch(): void {
  query.value = "";
  void loadPage(0);
}

function onChanged(e: DbEntry): void {
  entries.value = entries.value.map((x) => (x.dbId === e.dbId ? e : x));
  selected.value = e;
}

function onDeleted(dbId: string): void {
  entries.value = entries.value.filter((x) => x.dbId !== dbId);
  if (total.value !== null) total.value = Math.max(0, total.value - 1);
  selected.value = null;
}

const when = (ms: number) => formatDateTime(ms / 1000);

onMounted(() => loadPage(0));
</script>

<template>
  <AppDialog width="640px" :title="t('admin.db.title')" @close="emit('close')">
    <ClientDbDetails
      v-if="selected"
      :key="selected.dbId"
      :entry="selected"
      @back="selected = null"
      @changed="onChanged"
      @deleted="onDeleted"
    />
    <template v-else>
      <form
        v-if="gates.searchDb()"
        class="toolbar"
        data-testid="clientdb-dialog"
        @submit.prevent="search"
      >
        <input
          v-model="query"
          class="grow"
          data-testid="clientdb-search"
          :placeholder="t('admin.db.searchPlaceholder')"
          autocomplete="off"
        />
        <button type="submit" :disabled="busy">{{ t("admin.db.search") }}</button>
        <button v-if="searchedFor" type="button" @click="clearSearch">
          {{ t("admin.db.clearSearch") }}
        </button>
      </form>
      <div v-else data-testid="clientdb-dialog"></div>
      <p v-if="error" class="err" role="alert">{{ error }}</p>
      <p v-if="searchedFor" class="meta">
        {{ t("admin.db.results", { n: hitIds.length, q: searchedFor }) }}
        <template v-if="more">{{ t("admin.db.moreResults", { n: entries.length }) }}</template>
      </p>
      <p v-if="loaded && !entries.length && !error" class="empty">
        {{ searchedFor ? t("admin.db.noMatches") : t("admin.db.empty") }}
      </p>
      <ul class="rows">
        <li
          v-for="e in entries"
          :key="e.dbId"
          class="row clickable"
          data-testid="clientdb-row"
          tabindex="0"
          @click="selected = e"
          @keydown.enter="selected = e"
        >
          <div class="main">
            <span class="title">{{ e.nickname }}</span>
            <span class="meta">
              {{ t("admin.db.lastSeen", { when: when(e.lastConnected) }) }} ·
              {{ t("admin.db.connectionsN", { n: e.totalConnections }) }}
            </span>
          </div>
        </li>
      </ul>
      <div v-if="searchedFor && more" class="toolbar">
        <button type="button" data-testid="clientdb-more" :disabled="busy" @click="showMore">
          {{ t("admin.db.showMore") }}
        </button>
      </div>
      <div v-if="!searchedFor" class="toolbar pager">
        <button
          type="button"
          :disabled="busy || !page.hasPrev"
          @click="loadPage(Math.max(0, start - PAGE_SIZE))"
        >
          ‹ {{ t("admin.db.prev") }}
        </button>
        <span class="grow meta center">
          {{
            page.pages
              ? t("admin.db.pageOf", { page: page.page, pages: page.pages, total: total ?? 0 })
              : t("admin.db.page", { page: page.page })
          }}
        </span>
        <button
          type="button"
          :disabled="busy || !page.hasNext"
          @click="loadPage(start + PAGE_SIZE)"
        >
          {{ t("admin.db.next") }} ›
        </button>
      </div>
    </template>
    <template #footer>
      <button type="button" @click="emit('close')">{{ t("dialog.close") }}</button>
    </template>
  </AppDialog>
</template>

<style scoped src="./admin.css"></style>
<style scoped>
.meta {
  color: var(--text-dim);
  font-size: 12px;
  margin: 0;
}
.center {
  text-align: center;
}
</style>
