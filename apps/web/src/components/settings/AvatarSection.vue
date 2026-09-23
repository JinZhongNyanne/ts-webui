<script setup lang="ts">
/**
 * The TeamSpeak avatar in the Profile pane: the one every client on the
 * server sees, native ones included (avatar/avatar-file.ts). Needs a live
 * connection; offered unless the server's i_client_max_avatar_filesize is
 * known to be 0.
 */
import { computed, ref, shallowRef } from "vue";
import { formatBytes } from "@jinz/protocol";
import { useTsStore } from "../../stores/ts";
import { usePermsStore } from "../../stores/perms";
import { useI18n } from "../../i18n";
import { avatarUrl } from "../../ts/assets";
import {
  AVATAR_ACCEPT,
  avatarByteLimit,
  removeAvatar,
  uploadAvatar,
} from "../../avatar/avatar-file";
import { avatarIo } from "../../icons/internal-files";
import { ICON_PERM } from "../../icons/icon-gates";
import { confirmDialog } from "../ui/confirm";
import AvatarCropDialog from "./AvatarCropDialog.vue";

const ts = useTsStore();
const perms = usePermsStore();
const { t } = useI18n();
const input = ref<HTMLInputElement | null>(null);
const picked = shallowRef<File | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);

const connected = computed(() => ts.connState === "connected" && !!ts.selfClient);
const current = computed(() => avatarUrl(ts.selfClient?.avatar));
const limit = computed(() =>
  avatarByteLimit(perms.values[ICON_PERM.maxAvatarSize], ts.features.files?.maxUploadBytes),
);

function pick(ev: Event): void {
  const el = ev.target as HTMLInputElement;
  const file = el.files?.[0];
  el.value = ""; // the same file may be picked again after a failure
  error.value = null;
  if (file) picked.value = file;
}

async function upload(blob: Blob, signal: AbortSignal): Promise<void> {
  const uid = ts.selfClient?.uid ?? "";
  await uploadAvatar(new Uint8Array(await blob.arrayBuffer()), blob.type, uid, avatarIo, signal);
}

async function remove(): Promise<void> {
  const yes = await confirmDialog({
    title: t("avatar.removeTitle"),
    message: t("avatar.removeHint"),
    confirmLabel: t("profile.remove"),
    danger: true,
  });
  if (!yes) return;
  busy.value = true;
  error.value = null;
  try {
    await removeAvatar(avatarIo, perms.mayUse(ICON_PERM.deleteAvatar));
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section data-testid="ts-avatar">
    <div class="label">{{ t("avatar.title") }}</div>
    <div class="row">
      <div class="preview">
        <img v-if="current" :src="current" alt="" data-testid="ts-avatar-img" />
        <span v-else class="none">{{ t("profile.none") }}</span>
      </div>
      <div class="actions">
        <button
          type="button"
          data-testid="ts-avatar-choose"
          :disabled="!connected || busy || limit === null"
          @click="input?.click()"
        >
          {{ current ? t("profile.replace") : t("profile.choose") }}
        </button>
        <button
          v-if="current"
          type="button"
          data-testid="ts-avatar-remove"
          :disabled="!connected || busy"
          @click="remove"
        >
          {{ t("profile.remove") }}
        </button>
      </div>
    </div>
    <p v-if="!connected" class="hint">{{ t("avatar.offline") }}</p>
    <p v-else-if="limit === null" class="hint">{{ t("avatar.notAllowed") }}</p>
    <p v-else class="hint">{{ t("avatar.hint", { max: formatBytes(limit) }) }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <input
      ref="input"
      type="file"
      class="file"
      data-testid="ts-avatar-input"
      :accept="AVATAR_ACCEPT"
      @change="pick"
    />
    <AvatarCropDialog
      v-if="picked && limit !== null"
      :file="picked"
      :limit="limit"
      :upload="upload"
      @close="picked = null"
    />
  </section>
</template>

<style scoped>
section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.label {
  font-size: 12px;
  font-weight: 600;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.preview {
  width: 48px;
  height: 48px;
  border: 1px solid var(--border);
  border-radius: 8px;
  display: grid;
  place-items: center;
  overflow: hidden;
  flex: none;
}
.preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.none {
  color: var(--text-dim);
  font-size: 11px;
}
.hint {
  margin: 0;
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.5;
}
.error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}
.file {
  display: none;
}
</style>
