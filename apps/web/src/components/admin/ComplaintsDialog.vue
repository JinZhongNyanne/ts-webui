<script setup lang="ts">
/**
 * Every complaint on the server (`complainlist`), grouped by the client they
 * are about. Delete one (`complaindel`, b_client_complain_delete, or _own for
 * the ones we filed) or all about someone (`complaindelall`).
 */
import { computed, onMounted, shallowRef } from "vue";
import AppDialog from "../ui/AppDialog.vue";
import { confirmDialog } from "../ui/confirm";
import { useI18n } from "../../i18n";
import { formatDateTime } from "../../ts/assets";
import { deleteAllComplaints, deleteComplaint, listComplaints } from "../../ts/admin-actions";
import { groupComplaints, type Complaint, type ComplaintGroup } from "../../ts/admin-rows";
import { useAdminGates } from "./useAdminGates";
import { useBusy } from "./useBusy";

const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const gates = useAdminGates();
const { busy, error, run, act } = useBusy();

const complaints = shallowRef<readonly Complaint[]>([]);
const groups = computed(() => groupComplaints(complaints.value));
const loaded = shallowRef(false);

async function load(): Promise<void> {
  const list = await run(listComplaints);
  if (list) complaints.value = list;
  loaded.value = true;
}

async function removeOne(c: Complaint): Promise<void> {
  if (await act(() => deleteComplaint(c.targetDbId, c.fromDbId))) {
    complaints.value = complaints.value.filter(
      (x) => !(x.targetDbId === c.targetDbId && x.fromDbId === c.fromDbId),
    );
  }
}

async function removeAll(g: ComplaintGroup): Promise<void> {
  const yes = await confirmDialog({
    title: t("admin.complaints.deleteAllTitle", { name: g.targetName }),
    message: t("admin.complaints.deleteAllHint", { n: g.complaints.length }),
    confirmLabel: t("admin.delete"),
    danger: true,
  });
  if (!yes) return;
  if (await act(() => deleteAllComplaints(g.targetDbId))) {
    complaints.value = complaints.value.filter((x) => x.targetDbId !== g.targetDbId);
  }
}

const when = (ms: number) => formatDateTime(ms / 1000);

onMounted(load);
</script>

<template>
  <AppDialog width="600px" :title="t('admin.complaints.title')" @close="emit('close')">
    <div class="toolbar" data-testid="complaints-dialog">
      <span class="grow meta">{{ t("admin.complaints.count", { n: complaints.length }) }}</span>
      <button type="button" :disabled="busy" @click="load">{{ t("admin.refresh") }}</button>
    </div>
    <p v-if="error" class="err" role="alert">{{ error }}</p>
    <p v-if="loaded && !groups.length && !error" class="empty">{{ t("admin.complaints.none") }}</p>
    <section v-for="g in groups" :key="g.targetDbId" class="group" data-testid="complaint-group">
      <header class="toolbar">
        <strong class="grow target">
          {{ g.targetName }} <span class="badge">{{ g.complaints.length }}</span>
        </strong>
        <button
          v-if="gates.deleteAllComplaints()"
          type="button"
          class="danger-text"
          :disabled="busy"
          @click="removeAll(g)"
        >
          {{ t("admin.complaints.deleteAll") }}
        </button>
      </header>
      <ul class="rows">
        <li v-for="c in g.complaints" :key="c.fromDbId" class="row">
          <div class="main">
            <span class="title">{{ c.message }}</span>
            <span class="meta">
              {{ t("admin.complaints.from", { name: c.fromName }) }} · {{ when(c.at) }}
            </span>
          </div>
          <div class="actions">
            <button
              v-if="gates.deleteComplaint(c.fromDbId, gates.myDbId())"
              type="button"
              class="danger-text"
              :disabled="busy"
              :aria-label="t('admin.delete')"
              @click="removeOne(c)"
            >
              {{ t("admin.delete") }}
            </button>
          </div>
        </li>
      </ul>
    </section>
    <template #footer>
      <button type="button" @click="emit('close')">{{ t("dialog.close") }}</button>
    </template>
  </AppDialog>
</template>

<style scoped src="./admin.css"></style>
<style scoped>
.group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.target {
  overflow-wrap: anywhere;
}
.meta {
  color: var(--text-dim);
  font-size: 12px;
}
</style>
