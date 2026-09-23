<script setup lang="ts">
/**
 * The "Files" window (M3): a channel's files, picked from the channel list
 * (my own channel until another is chosen, or the one "Browse files…" named).
 * Breadcrumb, a sortable table, upload by button or by dropping files on the
 * list, new folder, rename, delete, download, and the transfer queue at the
 * bottom. The logic lives in files/useFileBrowser.ts; actions a known power
 * of 0 rules out are hidden, the rest are tried and a refusal names what is
 * missing. The same component fills the phone's sheet.
 */
import { computed, ref } from "vue";
import { useI18n } from "../i18n";
import { useTransfersStore } from "../stores/transfers";
import { displayChannelName } from "../ts/format";
import { useFileBrowser } from "./files/useFileBrowser";
import FileBreadcrumb from "./files/FileBreadcrumb.vue";
import FileChannelSelect from "./files/FileChannelSelect.vue";
import FileNameDialog from "./files/FileNameDialog.vue";
import FilePasswordForm from "./files/FilePasswordForm.vue";
import FileTable from "./files/FileTable.vue";
import TransferList from "./files/TransferList.vue";

const { t } = useI18n();
const fb = useFileBrowser();
const transfers = useTransfersStore();
const picker = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
/** Nested elements fire enter/leave pairs of their own; count them (as chat does). */
let dragDepth = 0;

const channelName = computed(() =>
  fb.channel.value ? displayChannelName(fb.channel.value.name, fb.channel.value.parentId) : "",
);
const listed = computed(() => fb.status.value === "ready" || fb.status.value === "loading");
const one = computed(() => (fb.selected.value.length === 1 ? fb.selected.value[0]! : null));
const files = computed(() => fb.selected.value.filter((e) => !e.isDir));
const canUpload = computed(() => fb.actions.value.upload && listed.value);

function pickFiles(ev: Event): void {
  const input = ev.target as HTMLInputElement;
  void fb.uploadFiles([...(input.files ?? [])]);
  input.value = "";
}

const hasFiles = (ev: DragEvent) => !!ev.dataTransfer?.types.includes("Files");

function onDragEnter(ev: DragEvent): void {
  if (!canUpload.value || !hasFiles(ev)) return;
  ev.preventDefault();
  dragDepth++;
  dragging.value = true;
}

function onDragOver(ev: DragEvent): void {
  if (!canUpload.value || !hasFiles(ev)) return;
  ev.preventDefault();
  ev.dataTransfer!.dropEffect = "copy";
  dragging.value = true;
}

function onDragLeave(ev: DragEvent): void {
  if (!hasFiles(ev)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dragging.value = false;
}

function onDrop(ev: DragEvent): void {
  dragDepth = 0;
  dragging.value = false;
  if (!canUpload.value || !hasFiles(ev)) return;
  ev.preventDefault();
  void fb.uploadFiles([...(ev.dataTransfer?.files ?? [])]);
}

const up = () => fb.goTo(fb.path.value.slice(0, fb.path.value.lastIndexOf("/")) || "/");
</script>

<template>
  <section class="fbrowser" data-testid="file-browser">
    <header class="bar">
      <FileChannelSelect :model-value="fb.cid.value" @update:model-value="fb.pickChannel" />
      <button
        type="button"
        class="icon"
        :title="t('fb.refresh')"
        :aria-label="t('fb.refresh')"
        data-testid="fb-refresh"
        :disabled="!fb.cid.value"
        @click="fb.load()"
      >
        ⟳
      </button>
    </header>
    <div class="bar">
      <button
        type="button"
        class="icon"
        :title="t('fb.up')"
        :aria-label="t('fb.up')"
        :disabled="fb.path.value === '/'"
        @click="up"
      >
        ↑
      </button>
      <FileBreadcrumb :path="fb.path.value" :root-label="channelName" @go="fb.goTo" />
    </div>
    <div v-if="listed" class="bar actions">
      <button
        v-if="fb.actions.value.upload"
        type="button"
        data-testid="fb-upload"
        @click="picker?.click()"
      >
        ⬆ <span class="lbl">{{ t("fb.upload") }}</span>
      </button>
      <button
        v-if="fb.actions.value.createDir"
        type="button"
        data-testid="fb-new-folder"
        @click="fb.openNameDialog({ kind: 'folder' })"
      >
        📁 <span class="lbl">{{ t("fb.newFolder") }}</span>
      </button>
      <button v-if="one" type="button" data-testid="fb-open" @click="fb.openEntry(one)">
        ↵ <span class="lbl">{{ one.isDir ? t("fb.open") : t("fb.download") }}</span>
      </button>
      <button
        v-else-if="files.length && fb.actions.value.download"
        type="button"
        data-testid="fb-download"
        @click="fb.download(files)"
      >
        ⬇ <span class="lbl">{{ t("fb.download") }}</span>
      </button>
      <button
        v-if="one && fb.actions.value.rename"
        type="button"
        data-testid="fb-rename"
        @click="fb.openNameDialog({ kind: 'rename', entry: one })"
      >
        ✏️ <span class="lbl">{{ t("fb.rename") }}</span>
      </button>
      <button
        v-if="fb.selected.value.length && fb.actions.value.delete"
        type="button"
        class="danger"
        data-testid="fb-delete"
        @click="fb.deleteEntries(fb.selected.value)"
      >
        🗑 <span class="lbl">{{ t("fb.delete") }}</span>
      </button>
      <span v-if="fb.selected.value.length > 1" class="count">
        {{ t("fb.selected", { n: fb.selected.value.length }) }}
      </span>
      <input
        ref="picker"
        type="file"
        multiple
        hidden
        data-testid="fb-file-input"
        @change="pickFiles"
      />
    </div>

    <p v-if="fb.notice.value" class="notice" role="alert" data-testid="fb-notice">
      {{ fb.notice.value }}
      <button
        type="button"
        class="icon"
        :aria-label="t('dialog.close')"
        @click="fb.notice.value = null"
      >
        ✕
      </button>
    </p>

    <div
      class="body"
      :class="{ dragging }"
      :data-drop-label="t('fb.dropHere')"
      data-testid="fb-drop"
      @dragenter="onDragEnter"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <p v-if="!fb.cid.value" class="state">{{ t("fb.noChannel") }}</p>
      <FilePasswordForm
        v-else-if="fb.status.value === 'password'"
        :channel-name="channelName"
        :wrong="fb.passwordWrong.value"
        @submit="fb.submitPassword"
      />
      <div
        v-else-if="fb.status.value === 'error'"
        class="state error"
        role="alert"
        data-testid="fb-error"
      >
        <p>{{ t("fb.loadFailed", { msg: fb.error.value ?? "" }) }}</p>
        <button type="button" @click="fb.load()">{{ t("fb.retry") }}</button>
      </div>
      <p v-else-if="fb.status.value === 'loading' && !fb.rows.value.length" class="state">
        {{ t("fb.loading") }}
      </p>
      <template v-else-if="listed">
        <FileTable
          v-if="fb.rows.value.length"
          :rows="fb.rows.value"
          :selected="fb.selection.value.names"
          :sort="fb.sort.value"
          @select="fb.select"
          @select-all="fb.selectAll"
          @open="fb.openEntry"
          @sort="fb.sortBy"
        />
        <p v-else class="state" data-testid="fb-empty">
          {{ t("fb.empty") }}<br />
          <span v-if="fb.actions.value.upload" class="dim">{{ t("fb.emptyDrop") }}</span>
        </p>
      </template>
    </div>

    <footer class="transfers">
      <button
        type="button"
        class="toggle"
        :aria-expanded="fb.showTransfers.value"
        data-testid="fb-transfers-toggle"
        @click="fb.showTransfers.value = !fb.showTransfers.value"
      >
        {{ fb.showTransfers.value ? "▾" : "▸" }}
        {{
          transfers.listedActive.length
            ? t("fb.transfersActive", { n: transfers.listedActive.length })
            : t("fb.transfers")
        }}
      </button>
      <div v-if="fb.showTransfers.value" class="queue">
        <TransferList />
      </div>
    </footer>

    <FileNameDialog
      v-if="fb.nameDialog.value"
      :key="
        fb.nameDialog.value.kind === 'rename' ? `r:${fb.nameDialog.value.entry.name}` : 'folder'
      "
      :title="
        fb.nameDialog.value.kind === 'folder'
          ? t('fb.newFolderTitle')
          : t('fb.renameTitle', { name: fb.nameDialog.value.entry.name })
      "
      :label="fb.nameDialog.value.kind === 'folder' ? t('fb.folderName') : t('fb.newName')"
      :submit-label="fb.nameDialog.value.kind === 'folder' ? t('fb.create') : t('fb.rename')"
      :initial="fb.nameDialog.value.kind === 'rename' ? fb.nameDialog.value.entry.name : ''"
      :error="fb.nameError.value"
      :busy="fb.busy.value"
      @submit="fb.submitName"
      @close="fb.closeNameDialog"
    />
  </section>
</template>

<style scoped>
.fbrowser {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
}
.bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  min-width: 0;
}
.bar + .bar {
  padding-top: 0;
}
.actions {
  flex-wrap: wrap;
  border-bottom: 1px solid var(--border);
}
.actions button {
  font-size: 12px;
  padding: 2px 8px;
}
.count {
  font-size: 12px;
  color: var(--text-dim);
}
.icon {
  flex: none;
  padding: 2px 7px;
}
.notice {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin: 4px 6px 0;
  padding: 4px 8px;
  border: 1px solid var(--danger);
  border-radius: 6px;
  font-size: 12px;
  color: var(--danger);
}
.body {
  position: relative;
  flex: 1;
  min-height: 80px;
  overflow: auto;
}
.body.dragging::after {
  content: attr(data-drop-label);
  position: absolute;
  inset: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed var(--accent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  pointer-events: none;
  font-size: 13px;
}
.state {
  margin: 24px 12px;
  text-align: center;
  color: var(--text-dim);
  font-size: 13px;
}
.state.error {
  color: var(--danger);
}
.dim {
  font-size: 12px;
}
.transfers {
  flex: none;
  border-top: 1px solid var(--border);
}
.toggle {
  width: 100%;
  border: none;
  border-radius: 0;
  background: transparent;
  text-align: left;
  font-size: 12px;
  padding: 4px 8px;
}
.queue {
  max-height: 180px;
  overflow: auto;
  padding: 0 6px 6px;
}
/* The toggle above already says what this is. */
.queue :deep(h3) {
  display: none;
}
/* A narrow window keeps the icons and drops the words. */
@container (max-width: 360px) {
  .lbl {
    display: none;
  }
}
</style>
