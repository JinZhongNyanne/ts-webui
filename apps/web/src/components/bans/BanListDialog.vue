<script setup lang="ts">
/**
 * The server's ban list (`banlist`, needs b_client_ban_list): search, add,
 * edit (a new ban replacing the old one), delete one, delete all. The list is
 * fetched on open and after every change; TeamSpeak sends no notification
 * when someone else changes it, hence the refresh button.
 */
import { computed, onMounted, ref, shallowRef } from "vue";
import AppDialog from "../ui/AppDialog.vue";
import { confirmDialog } from "../ui/confirm";
import { locale, useI18n } from "../../i18n";
import { deleteAllBans, deleteBan, listBans } from "../../ts/ban-actions";
import { banLabel, filterBans, type BanEntry } from "../../ts/bans";
import BanDialog from "./BanDialog.vue";

const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();

const bans = shallowRef<readonly BanEntry[]>([]);
const query = ref("");
const loading = ref(false);
const error = ref<string | null>(null);
/** The ban being edited, `"new"` for the add dialog, or null. */
const editing = shallowRef<BanEntry | "new" | null>(null);

const shown = computed(() => filterBans(bans.value, query.value));

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Bumped per refresh: only the latest one's answer lands (the button and a change can overlap). */
let generation = 0;

async function refresh(): Promise<void> {
  const gen = ++generation;
  loading.value = true;
  error.value = null;
  try {
    const list = await listBans();
    if (gen === generation) bans.value = list;
  } catch (err) {
    if (gen === generation) error.value = message(err);
  } finally {
    if (gen === generation) loading.value = false;
  }
}

/** After the ban dialog saved: show the list as it is now, and any half-done edit. */
async function saved(warning?: string): Promise<void> {
  await refresh();
  if (warning) error.value = warning;
}

/** Runs a change, then shows the list as the server now has it. */
async function change(action: () => Promise<void>): Promise<void> {
  error.value = null;
  let failed: string | null = null;
  try {
    await action();
  } catch (err) {
    failed = message(err);
  }
  // After the refresh, which clears the error line on its way.
  await refresh();
  if (failed) error.value = failed;
}

async function remove(ban: BanEntry): Promise<void> {
  const ok = await confirmDialog({
    title: t("banList.deleteOneTitle"),
    message: t("banList.deleteOneMessage", { ban: banLabel(ban) }),
    confirmLabel: t("dialog.delete"),
    danger: true,
  });
  if (ok) await change(() => deleteBan(ban.id));
}

async function removeAll(): Promise<void> {
  const ok = await confirmDialog({
    title: t("banList.deleteAllTitle"),
    message: t("banList.deleteAllMessage", { n: bans.value.length }),
    confirmLabel: t("banList.deleteAll"),
    danger: true,
  });
  if (ok) await change(deleteAllBans);
}

const time = (ms: number) =>
  new Date(ms).toLocaleString(locale.value, {
    hour12: false,
    dateStyle: "short",
    timeStyle: "short",
  });
const expiry = (b: BanEntry) => (b.expires === null ? t("ban.permanent") : time(b.expires));

onMounted(refresh);
</script>

<template>
  <AppDialog width="1000px" :title="t('banList.title')" @close="emit('close')">
    <div class="toolbar" data-testid="ban-list">
      <input
        v-model="query"
        type="search"
        class="search"
        :placeholder="t('banList.search')"
        :aria-label="t('banList.search')"
      />
      <button type="button" :disabled="loading" @click="refresh">{{ t("banList.refresh") }}</button>
      <button type="button" class="add" @click="editing = 'new'">{{ t("banList.add") }}</button>
      <button type="button" class="danger" :disabled="!bans.length" @click="removeAll">
        {{ t("banList.deleteAll") }}
      </button>
    </div>
    <p v-if="error" class="note error" role="alert">{{ error }}</p>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ t("ban.ip") }}</th>
            <th>{{ t("banList.nameCol") }}</th>
            <th>{{ t("ban.uid") }}</th>
            <th>{{ t("ban.reason") }}</th>
            <th>{{ t("banList.invoker") }}</th>
            <th>{{ t("banList.created") }}</th>
            <th>{{ t("banList.expires") }}</th>
            <th :title="t('banList.enforcementsHint')">{{ t("banList.enforcements") }}</th>
            <th>
              <span class="sr-only">{{ t("banList.actions") }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in shown" :key="b.id" class="ban" :data-banid="b.id">
            <td>{{ b.ip }}</td>
            <td>
              <span v-if="b.name" class="mono">{{ b.name }}</span>
              <span v-if="b.lastNickname" class="dim" :title="t('banList.lastNickname')">
                {{ b.lastNickname }}
              </span>
            </td>
            <td class="mono uid" :title="b.uid">{{ b.uid }}</td>
            <td>{{ b.reason }}</td>
            <td>{{ b.invokerName }}</td>
            <td class="nowrap">{{ time(b.created) }}</td>
            <td class="nowrap">{{ expiry(b) }}</td>
            <td class="num">{{ b.enforcements }}</td>
            <td class="actions">
              <button
                type="button"
                class="edit"
                :aria-label="t('banList.editOne', { ban: banLabel(b) })"
                @click="editing = b"
              >
                {{ t("banList.edit") }}
              </button>
              <button
                type="button"
                class="delete"
                :aria-label="t('banList.deleteOne', { ban: banLabel(b) })"
                @click="remove(b)"
              >
                {{ t("dialog.delete") }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!loading && !shown.length" class="empty">
        {{ bans.length ? t("banList.noMatch") : t("banList.empty") }}
      </p>
    </div>

    <template #footer>
      <button type="button" @click="emit('close')">{{ t("dialog.close") }}</button>
    </template>
  </AppDialog>

  <BanDialog
    v-if="editing"
    :edit="editing === 'new' ? undefined : editing"
    @done="saved"
    @close="editing = null"
  />
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.search {
  flex: 1;
  min-width: 160px;
}
.toolbar .danger {
  color: var(--danger);
}
.table-wrap {
  overflow: auto;
  min-height: 120px;
  max-height: 60vh;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
th,
td {
  text-align: left;
  padding: 4px 6px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
th {
  position: sticky;
  top: 0;
  background: var(--bg-elev);
  color: var(--text-dim);
  font-weight: 500;
}
.mono {
  font-family: ui-monospace, monospace;
}
.uid {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dim {
  display: block;
  color: var(--text-dim);
}
.nowrap {
  white-space: nowrap;
}
.num {
  text-align: right;
}
.actions {
  white-space: nowrap;
}
.actions button {
  font-size: 12px;
  padding: 2px 8px;
}
.actions .delete {
  color: var(--danger);
}
.note.error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}
.empty {
  color: var(--text-dim);
  text-align: center;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
