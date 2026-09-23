<script setup lang="ts">
/**
 * The server's icons as a grid. Without a target it manages them: upload
 * (icons/icon-upload.ts: checked, scaled to 16 px when bigger, named by
 * CRC-32) and delete. With a target (a group, channel or client) it picks
 * that target's icon: a click sets `i_icon_id`, "No icon" removes it, and
 * the server's notify updates everyone's tree.
 *
 * The list is channel 0's `/icons` where b_icon_manage allows it, plus the
 * icons already in use and, for a target, the built-in group icons.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import AppDialog from "../ui/AppDialog.vue";
import { confirmDialog } from "../ui/confirm";
import { useI18n } from "../../i18n";
import { usePermsStore } from "../../stores/perms";
import { useTsStore } from "../../stores/ts";
import { builtinIcon, iconUrl } from "../../ts/assets";
import { useBusy } from "../admin/useBusy";
import { ICON_ACCEPT, iconByteLimit } from "../../icons/icon-image";
import { ICON_PERM } from "../../icons/icon-gates";
import { iconIdsInUse, mergeIconIds, targetIconId, type IconTarget } from "../../icons/icon-set";
import { deleteIcon, listIcons, setIcon, uploadIcon } from "../../icons/internal-files";
import { prepareIcon } from "../../icons/icon-upload";
import { useIconGates } from "./useIconMenus";

const props = defineProps<{ target: IconTarget | null }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const ts = useTsStore();
const perms = usePermsStore();
const gates = useIconGates();
const { busy, error, run, act } = useBusy();

/** The built-in group icons a target may also get. */
const BUILTIN = [100, 200, 300, 400, 500, 600];

const listed = shallowRef<readonly number[]>([]);
const input = ref<HTMLInputElement | null>(null);
/** The icon upload on its way, so it can be cancelled (it may be waiting in line). */
const uploading = shallowRef<AbortController | null>(null);
const canManage = computed(() => gates.manage());
const maxBytes = computed(() => iconByteLimit(perms.values[ICON_PERM.maxIconSize]));

const inUse = computed(() =>
  iconIdsInUse({
    server: ts.server,
    serverGroups: ts.serverGroups.values(),
    channelGroups: ts.channelGroups.values(),
    channels: ts.channels.values(),
    clients: ts.clients.values(),
  }),
);
const icons = computed(() => mergeIconIds(listed.value, inUse.value));
const current = computed(() =>
  props.target
    ? targetIconId(props.target, {
        serverGroups: ts.serverGroups,
        channelGroups: ts.channelGroups,
        channels: ts.channels,
        clients: ts.clients.values(),
      })
    : null,
);
const title = computed(() => (props.target ? t("icons.pickTitle") : t("icons.title")));

async function load(): Promise<void> {
  if (!canManage.value) return;
  const ids = await run(listIcons);
  if (ids) listed.value = ids;
}

async function pickFile(ev: Event): Promise<void> {
  const el = ev.target as HTMLInputElement;
  const file = el.files?.[0];
  el.value = "";
  const max = maxBytes.value;
  if (!file || max === null) return;
  const abort = new AbortController();
  uploading.value = abort;
  await run(async () => {
    const icon = await prepareIcon(file, max);
    await uploadIcon(icon.bytes, icon.type, icon.iconId, abort.signal);
    listed.value = mergeIconIds(listed.value, [icon.iconId]);
  });
  uploading.value = null;
}

/** Cancel, and closing the dialog, stop an upload that has not gone through. */
function cancelUpload(): void {
  uploading.value?.abort();
  uploading.value = null;
}

function close(): void {
  cancelUpload();
  emit("close");
}

async function remove(id: number): Promise<void> {
  const used = inUse.value.includes(id);
  const yes = await confirmDialog({
    title: t("icons.deleteTitle"),
    message: used ? t("icons.deleteInUse") : t("icons.deleteHint"),
    confirmLabel: t("admin.delete"),
    danger: true,
  });
  if (!yes) return;
  if (await act(() => deleteIcon(id))) listed.value = listed.value.filter((x) => x !== id);
}

async function assign(id: number | null): Promise<void> {
  const target = props.target;
  if (!target) return;
  if (await act(() => setIcon(target, id))) emit("close");
}

onMounted(load);
onBeforeUnmount(cancelUpload);
</script>

<template>
  <AppDialog width="520px" :title="title" :subtitle="target?.name" @close="close">
    <div class="icons" data-testid="icon-manager">
      <div class="toolbar">
        <span class="grow hint">
          {{ target ? t("icons.pickHint") : t("icons.intro") }}
        </span>
        <template v-if="canManage">
          <button
            type="button"
            data-testid="icon-upload"
            :disabled="busy || maxBytes === null"
            @click="input?.click()"
          >
            ＋ {{ t("icons.upload") }}
          </button>
          <button type="button" :disabled="busy" @click="load">{{ t("admin.refresh") }}</button>
          <button
            v-if="uploading"
            type="button"
            data-testid="icon-upload-cancel"
            @click="cancelUpload"
          >
            {{ t("dialog.cancel") }}
          </button>
        </template>
      </div>
      <p v-if="canManage" class="hint">{{ t("icons.uploadHint") }}</p>
      <p v-if="error" class="err" role="alert">{{ error }}</p>
      <div class="grid" role="list">
        <button
          v-if="target"
          type="button"
          class="tile none"
          :class="{ selected: current === 0 }"
          data-testid="icon-none"
          :disabled="busy"
          @click="assign(null)"
        >
          {{ t("icons.none") }}
        </button>
        <template v-if="target">
          <button
            v-for="id in BUILTIN"
            :key="`b${id}`"
            type="button"
            class="tile"
            :class="{ selected: current === id }"
            :title="builtinIcon(id)?.label"
            :disabled="busy"
            @click="assign(id)"
          >
            <span class="glyph">{{ builtinIcon(id)?.glyph }}</span>
          </button>
        </template>
        <div
          v-for="id in icons"
          :key="id"
          class="cell"
          role="listitem"
          :data-icon-id="id"
          data-testid="icon-tile"
        >
          <button
            type="button"
            class="tile"
            :class="{ selected: current === id, pick: !!target }"
            :title="String(id)"
            :disabled="busy || !target"
            @click="assign(id)"
          >
            <img v-if="iconUrl(id)" :src="iconUrl(id)!" alt="" />
          </button>
          <button
            v-if="!target && canManage"
            type="button"
            class="del"
            :aria-label="t('icons.delete')"
            :title="t('icons.delete')"
            data-testid="icon-delete"
            :disabled="busy"
            @click="remove(id)"
          >
            ×
          </button>
        </div>
      </div>
      <p v-if="!icons.length && !busy" class="hint">{{ t("icons.empty") }}</p>
      <input
        ref="input"
        type="file"
        class="file"
        data-testid="icon-input"
        :accept="ICON_ACCEPT"
        @change="pickFile"
      />
    </div>
    <template #footer>
      <button type="button" @click="close">{{ t("dialog.close") }}</button>
    </template>
  </AppDialog>
</template>

<style scoped src="../admin/admin.css"></style>
<style scoped>
.icons {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.hint {
  margin: 0;
  color: var(--text-dim);
  font-size: 12px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
  gap: 6px;
}
.cell {
  position: relative;
}
.tile {
  width: 100%;
  height: 40px;
  padding: 0;
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elev-2);
}
.tile:disabled {
  cursor: default;
  opacity: 1;
}
.tile.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}
.tile img {
  width: 16px;
  height: 16px;
  image-rendering: pixelated;
}
.tile.none {
  font-size: 11px;
  color: var(--text-dim);
}
.glyph {
  font-size: 14px;
}
.del {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 50%;
  font-size: 12px;
  line-height: 1;
  color: var(--danger);
}
.file {
  display: none;
}
</style>
