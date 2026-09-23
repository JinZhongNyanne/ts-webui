<script setup lang="ts">
/**
 * Temporary server passwords: the list (`servertemppasswordlist`), add
 * (TempPasswordForm) and delete (`servertemppassworddel`). Gated on
 * b_virtualserver_modify_temporary_passwords (the right flag, as the server's
 * 2568 on a guest named it; b_virtualserver_modify_password is the permanent
 * server password), or its _own variant for one's own passwords.
 */
import { onMounted, ref, shallowRef } from "vue";
import AppDialog from "../ui/AppDialog.vue";
import { confirmDialog } from "../ui/confirm";
import { useI18n } from "../../i18n";
import { useTsStore } from "../../stores/ts";
import { formatDateTime } from "../../ts/assets";
import { deleteTempPassword, listTempPasswords } from "../../ts/admin-actions";
import type { TempPassword } from "../../ts/admin-rows";
import TempPasswordForm from "./TempPasswordForm.vue";
import { useAdminGates } from "./useAdminGates";
import { useBusy } from "./useBusy";

const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const ts = useTsStore();
const gates = useAdminGates();
const { busy, error, run, act } = useBusy();

const list = shallowRef<readonly TempPassword[]>([]);
const loaded = ref(false);
const adding = ref(false);

async function load(): Promise<void> {
  const res = await run(listTempPasswords);
  if (res) list.value = res;
  loaded.value = true;
}

async function remove(tp: TempPassword): Promise<void> {
  const yes = await confirmDialog({
    title: t("admin.tp.deleteTitle"),
    message: t("admin.tp.deleteHint", { pw: tp.password }),
    confirmLabel: t("admin.delete"),
    danger: true,
  });
  if (!yes) return;
  if (await act(() => deleteTempPassword(tp.password))) {
    list.value = list.value.filter((x) => x.password !== tp.password);
  }
}

async function onAdded(): Promise<void> {
  adding.value = false;
  await load();
}

function channelName(id: string | null): string {
  return id ? (ts.channels.get(id)?.name ?? `#${id}`) : t("admin.tp.noChannel");
}

const when = (ms: number) => formatDateTime(ms / 1000);

onMounted(load);
</script>

<template>
  <AppDialog width="600px" :title="t('admin.tp.title')" @close="emit('close')">
    <TempPasswordForm v-if="adding" @added="onAdded" @cancel="adding = false" />
    <template v-else>
      <div class="toolbar" data-testid="temppw-dialog">
        <span class="grow meta">{{ t("admin.tp.intro") }}</span>
        <button type="button" data-testid="temppw-new" @click="adding = true">
          ＋ {{ t("admin.tp.new") }}
        </button>
        <button type="button" :disabled="busy" @click="load">{{ t("admin.refresh") }}</button>
      </div>
      <p v-if="error" class="err" role="alert">{{ error }}</p>
      <p v-if="loaded && !list.length && !error" class="empty">{{ t("admin.tp.none") }}</p>
      <ul class="rows">
        <li v-for="tp in list" :key="tp.password" class="row" data-testid="temppw-row">
          <div class="main">
            <span class="title"
              ><code>{{ tp.password }}</code></span
            >
            <span v-if="tp.description" class="meta">{{ tp.description }}</span>
            <span class="meta">
              {{ t("admin.tp.until", { when: when(tp.end) }) }} ·
              {{ t("admin.tp.by", { name: tp.creator }) }} · {{ channelName(tp.channelId) }}
            </span>
          </div>
          <div class="actions">
            <button
              v-if="gates.deleteTempPassword(tp.creatorUid, gates.myUid())"
              type="button"
              class="danger-text"
              :disabled="busy"
              @click="remove(tp)"
            >
              {{ t("admin.delete") }}
            </button>
          </div>
        </li>
      </ul>
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
}
code {
  overflow-wrap: anywhere;
}
</style>
