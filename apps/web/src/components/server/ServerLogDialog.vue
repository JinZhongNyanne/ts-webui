<script setup lang="ts">
/**
 * The virtual server's log (`logview`), newest first, a page at a time
 * (ts/server-log.ts parses it). The level filter and the search run over the
 * pages already loaded, in the page: the server has no search of its own.
 * Without b_virtualserver_log_view the server's refusal names that
 * permission, and that is what the window shows.
 */
import { computed, onMounted, ref, shallowRef } from "vue";
import AppDialog from "../ui/AppDialog.vue";
import { useI18n, type MessageKey } from "../../i18n";
import {
  filterLog,
  LOG_LEVELS,
  nextLogPage,
  type LogEntry,
  type LogLevel,
} from "../../ts/server-log";
import { useBusy } from "../admin/useBusy";
import { readServerLog } from "./server-actions";

const emit = defineEmits<{ close: [] }>();
const { t, locale } = useI18n();
const { busy, error, run } = useBusy();

const entries = shallowRef<readonly LogEntry[]>([]);
/** Where the next older page starts; null once the start of the log is reached. */
const next = ref<number | null>(null);
const loaded = ref(false);
const query = ref("");
const levels = ref<ReadonlySet<LogLevel>>(new Set(LOG_LEVELS));

const LEVEL_KEYS: Record<LogLevel, MessageKey> = {
  CRITICAL: "server.log.critical",
  ERROR: "server.log.error",
  WARNING: "server.log.warning",
  INFO: "server.log.info",
  DEBUG: "server.log.debug",
  UNKNOWN: "server.log.unknown",
};

const shown = computed(() =>
  filterLog(entries.value, { levels: levels.value, query: query.value }),
);

function toggle(level: LogLevel): void {
  const set = new Set(levels.value);
  if (set.has(level)) set.delete(level);
  else set.add(level);
  levels.value = set;
}

async function reload(): Promise<void> {
  const page = await run(() => readServerLog());
  if (page) {
    entries.value = page.entries;
    next.value = nextLogPage(page);
  }
  loaded.value = true;
}

async function older(): Promise<void> {
  const from = next.value;
  if (from === null) return;
  const page = await run(() => readServerLog(from));
  if (page) {
    entries.value = [...entries.value, ...page.entries];
    next.value = nextLogPage(page);
  }
}

function when(ms: number): string {
  return ms ? new Date(ms).toLocaleString(locale.value, { hour12: false }) : "";
}

onMounted(reload);
</script>

<template>
  <AppDialog width="760px" :title="t('server.log.title')" @close="emit('close')">
    <div class="toolbar" data-testid="log-dialog">
      <input
        v-model="query"
        class="grow"
        type="search"
        data-testid="log-search"
        :placeholder="t('server.log.search')"
        :aria-label="t('server.log.search')"
      />
      <button type="button" :disabled="busy" @click="reload">{{ t("admin.refresh") }}</button>
    </div>
    <div class="levels" role="group" :aria-label="t('server.log.levels')">
      <label v-for="level in LOG_LEVELS" :key="level" class="level" :class="level.toLowerCase()">
        <input
          type="checkbox"
          :checked="levels.has(level)"
          :data-testid="`log-level-${level.toLowerCase()}`"
          @change="toggle(level)"
        />
        {{ t(LEVEL_KEYS[level]) }}
      </label>
    </div>
    <p v-if="error" class="err" role="alert" data-testid="log-error">{{ error }}</p>
    <p v-if="loaded && !shown.length && !error" class="empty">{{ t("server.log.none") }}</p>
    <ol class="log">
      <li
        v-for="(e, i) in shown"
        :key="i"
        class="entry"
        data-testid="log-row"
        :class="e.level.toLowerCase()"
      >
        <div class="head">
          <span class="badge-level">{{ t(LEVEL_KEYS[e.level]) }}</span>
          <time class="meta" :datetime="e.at ? new Date(e.at).toISOString() : undefined">
            {{ when(e.at) }}
          </time>
          <span class="meta">{{ e.channel }}</span>
        </div>
        <div class="msg">{{ e.message }}</div>
      </li>
    </ol>
    <div v-if="next !== null && loaded" class="toolbar more">
      <button type="button" data-testid="log-more" :disabled="busy" @click="older">
        {{ t("server.log.older") }}
      </button>
    </div>
    <template #footer>
      <button type="button" @click="emit('close')">{{ t("dialog.close") }}</button>
    </template>
  </AppDialog>
</template>

<style scoped src="../admin/admin.css"></style>
<style scoped>
.toolbar input {
  min-width: 0;
}
.levels {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin: 8px 0;
  font-size: 12px;
}
.level {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}
.log {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.entry {
  padding: 6px 8px;
  border-left: 3px solid var(--border);
  background: var(--bg);
  border-radius: 4px;
  min-width: 0;
}
.entry.error,
.entry.critical {
  border-left-color: var(--danger);
}
.entry.warning {
  border-left-color: var(--warn);
}
.head {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 8px;
  align-items: baseline;
}
.badge-level {
  font-size: 11px;
  font-weight: 600;
}
.meta {
  color: var(--text-dim);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.msg {
  font-size: 13px;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.more {
  justify-content: center;
  margin-top: 8px;
}
</style>
