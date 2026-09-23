<script setup lang="ts">
/**
 * The folder's entries as a table: a checkbox, name, size and date, sorted by
 * a click on a column header (folders stay on top). A click selects (Ctrl /
 * Cmd adds, Shift takes a range), a double-click or Enter opens a folder or
 * downloads a file. The date column goes on a narrow window.
 *
 * A row says whether it is selected, which only means anything inside a
 * grid: hence the explicit grid / row / gridcell roles over the table.
 */
import { computed } from "vue";
import { formatBytes, type FtEntry } from "@jinz/protocol";
import { useI18n } from "../../i18n";
import type { SortKey, SortOrder } from "../../files/browser";
import type { ClickMods } from "../../files/selection";

const props = defineProps<{
  rows: readonly FtEntry[];
  selected: ReadonlySet<string>;
  sort: SortOrder;
}>();
const emit = defineEmits<{
  select: [name: string, mods: ClickMods];
  open: [entry: FtEntry];
  sort: [key: SortKey];
  selectAll: [on: boolean];
}>();
const { t, locale } = useI18n();

const allSelected = computed(
  () => props.rows.length > 0 && props.rows.every((e) => props.selected.has(e.name)),
);

const COLUMNS: readonly { key: SortKey; label: "fb.colName" | "fb.colSize" | "fb.colDate" }[] = [
  { key: "name", label: "fb.colName" },
  { key: "size", label: "fb.colSize" },
  { key: "datetime", label: "fb.colDate" },
];

function ariaSort(key: SortKey): "ascending" | "descending" | "none" {
  if (props.sort.key !== key) return "none";
  return props.sort.dir === "asc" ? "ascending" : "descending";
}

const dateFormat = computed(
  () => new Intl.DateTimeFormat(locale.value, { dateStyle: "short", timeStyle: "short" }),
);
const when = (e: FtEntry) => (e.datetime > 0 ? dateFormat.value.format(e.datetime * 1000) : "");

function onClick(ev: MouseEvent, e: FtEntry): void {
  emit("select", e.name, { toggle: ev.ctrlKey || ev.metaKey, range: ev.shiftKey });
}

function onKey(ev: KeyboardEvent, e: FtEntry): void {
  if (ev.key === "Enter") emit("open", e);
  else if (ev.key === " ") {
    ev.preventDefault();
    emit("select", e.name, { toggle: true });
  }
}
</script>

<template>
  <table class="files" role="grid" :aria-rowcount="rows.length" data-testid="fb-table">
    <thead>
      <tr role="row">
        <th class="check" role="columnheader">
          <input
            type="checkbox"
            :checked="allSelected"
            :aria-label="t('fb.selectAll')"
            @change="emit('selectAll', ($event.target as HTMLInputElement).checked)"
          />
        </th>
        <th
          v-for="c in COLUMNS"
          :key="c.key"
          role="columnheader"
          :class="c.key"
          :aria-sort="ariaSort(c.key)"
        >
          <button type="button" class="sort" :data-sort="c.key" @click="emit('sort', c.key)">
            {{ t(c.label) }}
            <span v-if="sort.key === c.key" aria-hidden="true">
              {{ sort.dir === "asc" ? "▲" : "▼" }}
            </span>
          </button>
        </th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="e in rows"
        :key="e.name"
        role="row"
        :class="{ selected: selected.has(e.name), dir: e.isDir }"
        :aria-selected="selected.has(e.name)"
        :data-name="e.name"
        tabindex="0"
        data-testid="fb-row"
        @click="onClick($event, e)"
        @dblclick="emit('open', e)"
        @keydown="onKey($event, e)"
      >
        <td class="check" role="gridcell" @click.stop>
          <input
            type="checkbox"
            :checked="selected.has(e.name)"
            :aria-label="t('fb.select', { name: e.name })"
            @change="emit('select', e.name, { toggle: true })"
          />
        </td>
        <td class="name" role="gridcell" :title="e.name">
          <span class="icon" aria-hidden="true">{{ e.isDir ? "📁" : "📄" }}</span>
          <span class="label">{{ e.name }}</span>
        </td>
        <td class="size" role="gridcell">{{ e.isDir ? "" : formatBytes(e.size) }}</td>
        <td class="datetime" role="gridcell">{{ when(e) }}</td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.files {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 12px;
}
th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--bg-elev);
  text-align: left;
  font-weight: 600;
  border-bottom: 1px solid var(--border);
}
th.size,
td.size {
  width: 6.5em;
  text-align: right;
}
th.datetime,
td.datetime {
  width: 11.5em;
}
.check {
  width: 26px;
  text-align: center;
}
.sort {
  width: 100%;
  padding: 3px 4px;
  border: none;
  background: transparent;
  text-align: inherit;
  font: inherit;
  color: inherit;
}
td {
  padding: 3px 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
td.size,
td.datetime {
  color: var(--text-dim);
}
tbody tr {
  cursor: default;
  user-select: none;
}
tbody tr:hover {
  background: var(--bg-elev-2);
}
tbody tr.selected {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
}
tbody tr:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}
.icon {
  margin-right: 5px;
}
/* A narrow window (a phone, a slim dock column) drops the date. */
@container (max-width: 420px) {
  th.datetime,
  td.datetime {
    display: none;
  }
}
</style>
