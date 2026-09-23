<script setup lang="ts">
/**
 * The sticker picker, opened from a chat composer's 😀 button.
 *
 * Two scopes side by side — the hub's shared set and this identity's own —
 * each with its user-made packs and an implicit "Ungrouped". A click sends
 * the sticker to this conversation (stores/stickers.ts does the work); the
 * manage mode turns the same grid into an editor: add, rename, move between
 * packs, delete, and the pack list itself.
 *
 * It is a plain popover, not a dock panel: it belongs to the composer it was
 * opened from, on the desktop and on the phone alike. A labelled group rather
 * than a dialog, since it is not modal and the button beside it carries the
 * `aria-expanded` — the modal dialogs on the page are the confirmations this
 * opens. Escape closes it, the grid is a list of buttons so it can be walked
 * with Tab, and every tile keeps its name as text for a screen reader.
 */
import { computed, nextTick, ref, watch } from "vue";
import {
  MAX_STICKER_BYTES,
  MAX_STICKER_NAME_LENGTH,
  MAX_STICKER_PACKS,
  MAX_STICKER_PIXELS,
  STICKER_EXTENSIONS,
  formatBytes,
  maxStickersIn,
  type Sticker,
  type StickerScope,
} from "@jinz/protocol";
import { useStickersStore } from "../../stores/stickers";
import { useTsStore } from "../../stores/ts";
import { useI18n, type MessageKey } from "../../i18n";
import type { StickerUploadError } from "../../stickers/rules";
import { STICKER_LIMITS, stickerErrorText } from "../../stickers/errors";
import { confirmDialog } from "../ui/confirm";

const props = defineProps<{ conversation: string }>();
const emit = defineEmits<{ close: [] }>();

const store = useStickersStore();
const ts = useTsStore();
const { t } = useI18n();

const scope = ref<StickerScope>("shared");
const query = ref("");
const managing = ref(false);
const busy = ref(false);
const uploadError = ref<StickerUploadError | null>(null);
const saveFailed = ref(false);
/** The sticker the manage bar is acting on. */
const selected = ref<string | null>(null);
const dragDepth = ref(0);
const newName = ref("");
const newPackId = ref("");
const packDraft = ref("");
const renameDraft = ref("");
/** The pack whose name is being edited in place, and the name being typed. */
const renamingPack = ref<string | null>(null);
const packRenameDraft = ref("");
const fileInput = ref<HTMLInputElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);

const ACCEPT = Object.values(STICKER_EXTENSIONS)
  .map((ext) => `.${ext}`)
  .join(",");

/** Sending needs a hub that does file transfer, and a server to send to. */
const canSend = computed(() => ts.connState === "connected" && !!ts.features.files);
/** A personal set needs an identity, which only a live session has. */
const hasIdentity = computed(() => ts.connState === "connected");

const groups = computed(() => store.groups(scope.value, query.value));
const packs = computed(() => store.packsOf(scope.value));
const count = computed(() => store.countOf(scope.value));
const capacity = computed(() => maxStickersIn(scope.value));
const searching = computed(() => query.value.trim().length > 0);
const showRecent = computed(
  () => !searching.value && !managing.value && store.recentlyUsed.length > 0,
);
const nothing = computed(() => groups.value.every((g) => g.stickers.length === 0));

const errorText = computed(() => (uploadError.value ? stickerErrorText(uploadError.value) : ""));

const current = computed(() => store.all.find((s) => s.id === selected.value) ?? null);

/** Leaving a scope or the manage mode drops what was being edited there. */
watch([scope, managing], () => {
  selected.value = null;
  uploadError.value = null;
  saveFailed.value = false;
  packDraft.value = "";
  renamingPack.value = null;
  if (!packs.value.some((p) => p.id === newPackId.value)) newPackId.value = "";
});

watch(current, (sticker) => (renameDraft.value = sticker?.name ?? ""));

function close(): void {
  emit("close");
}

async function pick(sticker: Sticker): Promise<void> {
  if (managing.value) {
    selected.value = selected.value === sticker.id ? null : sticker.id;
    return;
  }
  if (!canSend.value || busy.value) return;
  busy.value = true;
  const ok = await store.send(props.conversation, sticker);
  busy.value = false;
  if (ok) close();
}

/* ------------------------------------------------------------ adding */

async function add(files: Iterable<File>): Promise<void> {
  uploadError.value = null;
  busy.value = true;
  try {
    for (const file of files) {
      const problem = await store.upload(scope.value, file, newName.value, newPackId.value || null);
      if (problem) {
        uploadError.value = problem;
        break;
      }
      // The name field is for one file; a batch keeps only the file names.
      newName.value = "";
    }
  } finally {
    busy.value = false;
  }
}

function onPicked(ev: Event): void {
  const input = ev.target as HTMLInputElement;
  void add(Array.from(input.files ?? []));
  // Picking the same file again must fire `change` again.
  input.value = "";
}

const hasFiles = (ev: DragEvent): boolean => [...(ev.dataTransfer?.types ?? [])].includes("Files");

function onDragEnter(ev: DragEvent): void {
  if (!managing.value || !hasFiles(ev)) return;
  ev.preventDefault();
  dragDepth.value++;
}

function onDragOver(ev: DragEvent): void {
  if (!managing.value || !hasFiles(ev)) return;
  ev.preventDefault();
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
}

function onDragLeave(ev: DragEvent): void {
  if (!hasFiles(ev)) return;
  dragDepth.value = Math.max(0, dragDepth.value - 1);
}

function onDrop(ev: DragEvent): void {
  dragDepth.value = 0;
  if (!managing.value || !hasFiles(ev)) return;
  ev.preventDefault();
  void add(Array.from(ev.dataTransfer?.files ?? []));
}

/** A pasted screenshot becomes a sticker while the manage mode is open. */
function onPaste(ev: ClipboardEvent): void {
  const files = Array.from(ev.clipboardData?.files ?? []);
  if (!managing.value || files.length === 0) return;
  ev.preventDefault();
  void add(files);
}

/* ----------------------------------------------------------- editing */

async function run(action: Promise<boolean>): Promise<void> {
  busy.value = true;
  const ok = await action;
  busy.value = false;
  saveFailed.value = !ok;
}

function renameSelected(): void {
  const sticker = current.value;
  if (!sticker) return;
  void run(store.rename(scope.value, sticker.id, renameDraft.value));
}

function moveSelected(ev: Event): void {
  const sticker = current.value;
  if (!sticker) return;
  const value = (ev.target as HTMLSelectElement).value;
  void run(store.moveTo(scope.value, sticker.id, value || null));
}

async function deleteSelected(): Promise<void> {
  const sticker = current.value;
  if (!sticker) return;
  const ok = await confirmDialog({
    title: t("stickers.deleteConfirm", { name: sticker.name }),
    message: t(
      scope.value === "shared" ? "stickers.deleteSharedHint" : "stickers.deletePersonalHint",
    ),
    confirmLabel: t("stickers.delete"),
    danger: true,
  });
  if (!ok) return;
  selected.value = null;
  await run(store.remove(scope.value, sticker.id));
}

/* ------------------------------------------------------------- packs */

async function addPack(): Promise<void> {
  if (!packDraft.value.trim()) return;
  const name = packDraft.value;
  packDraft.value = "";
  await run(store.createPack(scope.value, name));
}

function startRenamePack(id: string, was: string): void {
  renamingPack.value = id;
  packRenameDraft.value = was;
}

async function commitRenamePack(id: string): Promise<void> {
  const name = packRenameDraft.value;
  renamingPack.value = null;
  await run(store.renamePack(scope.value, id, name));
}

async function deletePack(id: string, name: string): Promise<void> {
  const withStickers = await confirmDialog({
    title: t("stickers.deletePackConfirm", { name }),
    message: t("stickers.deletePackHint"),
    confirmLabel: t("stickers.deletePack"),
    cancelLabel: t("stickers.deletePackWith"),
    danger: true,
  });
  // "Confirm" ungroups (the safe answer); the other button deletes them too.
  await run(store.removePack(scope.value, id, !withStickers));
}

const tipOf = (sticker: Sticker): string =>
  managing.value
    ? `${sticker.name} · ${t("stickers.addedBy", { name: sticker.addedBy || "?" })}`
    : t("stickers.send", { name: sticker.name });

watch(
  () => managing.value,
  async (on) => {
    if (on) return;
    await nextTick();
    searchInput.value?.focus();
  },
);
</script>

<template>
  <section
    class="stickers"
    :class="{ dropping: dragDepth > 0 }"
    role="group"
    :aria-label="t('stickers.title')"
    data-testid="sticker-picker"
    @keydown.esc.stop="close"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
    @paste="onPaste"
  >
    <div v-if="dragDepth > 0" class="drop-hint" aria-hidden="true">
      {{ t("stickers.dropHere") }}
    </div>

    <header class="bar">
      <div class="tabs" role="tablist" :aria-label="t('stickers.title')">
        <button
          v-for="s in ['shared', 'personal'] as StickerScope[]"
          :key="s"
          role="tab"
          class="tab"
          :class="{ on: scope === s }"
          :aria-selected="scope === s"
          :data-testid="`sticker-scope-${s}`"
          @click="scope = s"
        >
          {{ t(s === "shared" ? "stickers.shared" : "stickers.personal") }}
        </button>
      </div>
      <button
        class="tool"
        :class="{ on: managing }"
        :aria-pressed="managing"
        :title="t('stickers.manage')"
        data-testid="sticker-manage"
        @click="managing = !managing"
      >
        {{ managing ? t("stickers.done") : t("stickers.manage") }}
      </button>
      <button class="tool" :title="t('dialog.close')" data-testid="sticker-close" @click="close">
        ✕
      </button>
    </header>

    <div class="search">
      <input
        ref="searchInput"
        v-model="query"
        type="search"
        :placeholder="t('stickers.search')"
        :aria-label="t('stickers.search')"
        data-testid="sticker-search"
      />
    </div>

    <p class="hint">
      {{ t(scope === "shared" ? "stickers.sharedHint" : "stickers.personalHint") }}
    </p>
    <p v-if="scope === 'personal' && !hasIdentity" class="notice">
      {{ t("stickers.noIdentity") }}
    </p>

    <!-- Manage mode: adding, and the packs themselves. -->
    <div v-if="managing" class="manage">
      <div class="row">
        <input
          v-model="newName"
          class="grow"
          :maxlength="MAX_STICKER_NAME_LENGTH"
          :placeholder="t('stickers.nameLabel')"
          :aria-label="t('stickers.nameLabel')"
          data-testid="sticker-upload-name"
        />
        <select
          v-model="newPackId"
          :aria-label="t('stickers.packLabel')"
          data-testid="sticker-upload-pack"
        >
          <option value="">{{ t("stickers.ungrouped") }}</option>
          <option v-for="p in packs" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <button :disabled="busy" data-testid="sticker-upload" @click="fileInput?.click()">
          {{ busy ? t("stickers.uploading") : t("stickers.add") }}
        </button>
        <input
          ref="fileInput"
          class="picker"
          type="file"
          multiple
          :accept="ACCEPT"
          tabindex="-1"
          aria-hidden="true"
          data-testid="sticker-upload-file"
          @change="onPicked"
        />
      </div>
      <p class="hint">{{ t("stickers.addHint", STICKER_LIMITS) }}</p>

      <div class="row">
        <input
          v-model="packDraft"
          class="grow"
          :maxlength="MAX_STICKER_NAME_LENGTH"
          :placeholder="t('stickers.packName')"
          :aria-label="t('stickers.packName')"
          data-testid="sticker-pack-name"
          @keydown.enter.prevent="addPack"
        />
        <button
          :disabled="busy || !packDraft.trim() || packs.length >= MAX_STICKER_PACKS"
          data-testid="sticker-pack-add"
          @click="addPack"
        >
          {{ t("stickers.newPack") }}
        </button>
      </div>
      <p class="hint">
        {{ t("stickers.packCount", { n: packs.length, max: MAX_STICKER_PACKS }) }} ·
        {{ t("stickers.count", { n: count, max: capacity }) }}
      </p>
      <p v-if="packs.length === 0" class="hint">{{ t("stickers.noPacks") }}</p>
    </div>

    <div class="body">
      <p v-if="errorText" class="error" data-testid="sticker-upload-error">{{ errorText }}</p>
      <p v-if="saveFailed" class="error">{{ t("stickers.saveFailed") }}</p>
      <p v-if="store.sendMessage" class="error" data-testid="sticker-send-error">
        {{ store.sendMessage }}
      </p>

      <template v-if="showRecent">
        <h3 class="group-title">{{ t("stickers.recent") }}</h3>
        <div class="grid">
          <button
            v-for="s in store.recentlyUsed"
            :key="`r${s.id}`"
            class="tile"
            :title="tipOf(s)"
            :disabled="!canSend || busy"
            data-testid="sticker-recent"
            @click="pick(s)"
          >
            <img v-if="store.fileUrl(s)" :src="store.fileUrl(s)!" :alt="s.name" loading="lazy" />
            <span class="sr">{{ s.name }}</span>
          </button>
        </div>
      </template>

      <p v-if="nothing" class="empty">
        {{ t(searching ? "stickers.noResults" : "stickers.empty") }}
      </p>

      <section v-for="group in groups" :key="group.pack?.id ?? 'ungrouped'" class="group">
        <h3 class="group-title">
          <input
            v-if="managing && group.pack && renamingPack === group.pack.id"
            v-model="packRenameDraft"
            class="grow"
            :maxlength="MAX_STICKER_NAME_LENGTH"
            :aria-label="t('stickers.renamePack')"
            data-testid="sticker-pack-rename-input"
            @keydown.enter.prevent="commitRenamePack(group.pack!.id)"
            @blur="commitRenamePack(group.pack!.id)"
          />
          <span v-else class="grow" data-testid="sticker-pack-title">
            {{ group.pack ? group.pack.name : t("stickers.ungrouped") }}
          </span>
          <template v-if="managing && group.pack">
            <button
              class="tool"
              :title="t('stickers.renamePack')"
              data-testid="sticker-pack-rename"
              @click="startRenamePack(group.pack.id, group.pack.name)"
            >
              ✎
            </button>
            <button
              class="tool"
              :title="t('stickers.deletePack')"
              data-testid="sticker-pack-delete"
              @click="deletePack(group.pack.id, group.pack.name)"
            >
              🗑
            </button>
          </template>
        </h3>
        <div class="grid">
          <button
            v-for="s in group.stickers"
            :key="s.id"
            class="tile"
            :class="{ picked: selected === s.id }"
            :title="tipOf(s)"
            :aria-pressed="managing ? selected === s.id : undefined"
            :disabled="!managing && (!canSend || busy)"
            data-testid="sticker"
            @click="pick(s)"
          >
            <img v-if="store.fileUrl(s)" :src="store.fileUrl(s)!" :alt="s.name" loading="lazy" />
            <span class="sr">{{ s.name }}</span>
          </button>
        </div>
      </section>
    </div>

    <!-- What the selected sticker can be done to; one at a time, so it fits a phone. -->
    <footer v-if="managing && current" class="edit" data-testid="sticker-edit">
      <input
        v-model="renameDraft"
        class="grow"
        :maxlength="MAX_STICKER_NAME_LENGTH"
        :aria-label="t('stickers.renameLabel')"
        data-testid="sticker-rename-input"
        @keydown.enter.prevent="renameSelected"
      />
      <button :disabled="busy" data-testid="sticker-rename" @click="renameSelected">
        {{ t("stickers.rename") }}
      </button>
      <select
        :value="current.packId ?? ''"
        :aria-label="t('stickers.move')"
        data-testid="sticker-move"
        @change="moveSelected"
      >
        <option value="">{{ t("stickers.ungrouped") }}</option>
        <option v-for="p in packs" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <button class="danger" :disabled="busy" data-testid="sticker-delete" @click="deleteSelected">
        {{ t("stickers.delete") }}
      </button>
    </footer>

    <p v-if="!canSend && !managing" class="notice">
      {{ ts.connState === "connected" ? t("stickers.unavailable") : t("status.notConnected") }}
    </p>
  </section>
</template>

<style scoped>
.stickers {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: min(360px, calc(100vw - 24px));
  /*
   * `--popover-max-*` is what `usePopoverAnchor` measured of the *visible*
   * viewport, so this also shrinks when a phone's keyboard comes up under the
   * composer the picker hangs off. Taking the smaller of the two keeps the
   * desktop's 460px, which is the size the grid was designed at.
   */
  max-width: var(--popover-max-width, 100vw);
  max-height: min(60dvh, 460px, var(--popover-max-height, 100dvh));
  padding: 8px 10px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-raised, var(--bg));
  box-shadow: 0 8px 24px rgb(0 0 0 / 35%);
}
.bar {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tabs {
  display: flex;
  flex: 1;
  gap: 4px;
  min-width: 0;
}
.tab {
  flex: 1;
  padding: 4px 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-dim);
  font-size: 12px;
}
.tab.on {
  border-color: var(--border);
  color: var(--accent);
  font-weight: 600;
}
.tool {
  padding: 2px 6px;
  border: none;
  background: transparent;
  font-size: 12px;
  opacity: 0.7;
}
.tool:hover,
.tool.on {
  opacity: 1;
}
.search input,
.grow {
  width: 100%;
  min-width: 0;
}
.hint,
.notice,
.empty {
  margin: 0;
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.4;
}
.error {
  margin: 0;
  color: var(--danger);
  font-size: 11px;
}
.manage,
.edit {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
}
.edit {
  flex-direction: row;
  align-items: center;
  gap: 4px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
  border-bottom: none;
}
.row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.row .grow {
  flex: 1;
}
.body {
  flex: 1;
  overflow: auto;
  min-height: 60px;
}
.group-title {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 8px 0 4px;
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
  gap: 4px;
}
.tile {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  padding: 2px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
}
.tile:hover:not(:disabled),
.tile:focus-visible {
  border-color: var(--border);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.tile.picked {
  border-color: var(--accent);
}
.tile:disabled {
  opacity: 0.5;
}
.tile img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
/* The name is on the button for a screen reader, and in the tooltip for everyone else. */
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.picker {
  display: none;
}
.danger {
  color: var(--danger);
}
.dropping {
  outline: 2px dashed var(--accent);
  outline-offset: -4px;
}
.drop-hint {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--bg) 80%, transparent);
  color: var(--accent);
  font-weight: 600;
  pointer-events: none;
}
@media (max-width: 480px) {
  .stickers {
    width: calc(100vw - 16px);
    max-height: min(70dvh, var(--popover-max-height, 100dvh));
  }
  .edit {
    flex-wrap: wrap;
  }
}
@media (pointer: coarse) {
  /* `.tool` sets no width of its own, so ✕ came out 22px across. */
  .tool {
    min-width: var(--touch-target);
  }
}
</style>
