<script setup lang="ts">
/**
 * Server and channel groups: add, rename, copy, delete, and the two display
 * settings a group has (its sort id and whether its name shows in the tree),
 * which are group permissions set through the widened `*groupaddperm`.
 *
 * The list is read with `servergrouplist` / `channelgrouplist` rather than
 * from the session's group maps: those follow the server's pushed lists a
 * moment later (coalesced by the hub), whereas the window wants the answer to
 * its own change the moment it has one. Only regular groups are shown:
 * templates and query groups are the instance administrator's. Each change
 * reloads the list, since the server renumbers nothing but may refuse
 * anything (a group's needed modify power is checked there).
 */
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { GROUP_NAME_MAX } from "@jinz/protocol";
import AppDialog from "../ui/AppDialog.vue";
import { confirmDialog } from "../ui/confirm";
import { useI18n, type MessageKey } from "../../i18n";
import { useBusy } from "../admin/useBusy";
import {
  addGroup,
  copyGroup,
  deleteGroup,
  listGroups,
  renameGroup,
  setGroupDisplay,
  type GroupKind,
} from "./server-actions";
import { groupNameProblem, type GroupNameProblem, type GroupRow } from "./server-rows";
import { useServerGates } from "./useServerGates";

const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const gates = useServerGates();
const { busy, error, run, act } = useBusy();

const kind = ref<GroupKind>("server");
const groups = shallowRef<readonly GroupRow[]>([]);
const loaded = ref(false);
const newName = ref("");
/** The one row being edited or copied, with its draft. */
const editing = ref<{ id: string; name: string; sortId: number; nameMode: number } | null>(null);
const copying = ref<{ id: string; name: string } | null>(null);
const problem = ref<string | null>(null);

const mayCreate = computed(() =>
  kind.value === "server" ? gates.createServerGroup() : gates.createChannelGroup(),
);
const mayDelete = computed(() =>
  kind.value === "server" ? gates.deleteServerGroup() : gates.deleteChannelGroup(),
);

const NAME_MODES = [0, 1, 2] as const;
const NAME_MODE_KEYS: Record<number, MessageKey> = {
  0: "server.groups.nameHidden",
  1: "server.groups.nameBefore",
  2: "server.groups.nameAfter",
};
const PROBLEM_KEYS: Record<GroupNameProblem, MessageKey> = {
  empty: "server.groups.nameEmpty",
  tooLong: "server.groups.nameTooLong",
  taken: "server.groups.nameTaken",
};

function takenExcept(id: string | null): string[] {
  return groups.value.filter((g) => g.id !== id).map((g) => g.name);
}

/** Checks a name before the server has to refuse it; answers whether it is fine. */
function nameOk(name: string, ownId: string | null): boolean {
  const p = groupNameProblem(name, takenExcept(ownId));
  problem.value = p ? t(PROBLEM_KEYS[p], { max: GROUP_NAME_MAX }) : null;
  return !p;
}

async function load(): Promise<void> {
  const res = await run(() => listGroups(kind.value));
  if (res) groups.value = res;
  loaded.value = true;
}

watch(kind, () => {
  editing.value = null;
  copying.value = null;
  problem.value = null;
  groups.value = [];
  loaded.value = false;
  void load();
});

async function add(): Promise<void> {
  if (!nameOk(newName.value, null)) return;
  if (await act(() => addGroup(kind.value, newName.value))) {
    newName.value = "";
    await load();
  }
}

function startEdit(g: GroupRow): void {
  copying.value = null;
  problem.value = null;
  editing.value = { id: g.id, name: g.name, sortId: g.sortId, nameMode: g.nameMode };
}

function startCopy(g: GroupRow): void {
  editing.value = null;
  problem.value = null;
  copying.value = { id: g.id, name: t("server.groups.copyName", { name: g.name }) };
}

/** Applies only what changed: a rename, a sort id, a name display, in that order. */
async function saveEdit(): Promise<void> {
  const e = editing.value;
  const before = groups.value.find((g) => g.id === e?.id);
  if (!e || !before) return;
  if (e.name.trim() !== before.name && !nameOk(e.name, e.id)) return;
  if (!Number.isInteger(e.sortId) || e.sortId < 0) {
    problem.value = t("server.groups.sortInvalid");
    return;
  }
  problem.value = null;
  const ok = await act(async () => {
    if (e.name.trim() !== before.name) await renameGroup(kind.value, e.id, e.name);
    if (e.sortId !== before.sortId) {
      await setGroupDisplay(kind.value, e.id, "i_group_sort_id", e.sortId);
    }
    if (e.nameMode !== before.nameMode) {
      await setGroupDisplay(kind.value, e.id, "i_group_show_name_in_tree", e.nameMode);
    }
  });
  if (ok) editing.value = null;
  await load();
}

async function saveCopy(): Promise<void> {
  const c = copying.value;
  if (!c || !nameOk(c.name, null)) return;
  if (await act(() => copyGroup(kind.value, c.id, c.name))) {
    copying.value = null;
    await load();
  }
}

async function remove(g: GroupRow): Promise<void> {
  const yes = await confirmDialog({
    title: t("server.groups.deleteTitle"),
    message: t("server.groups.deleteHint", { name: g.name }),
    confirmLabel: t("admin.delete"),
    danger: true,
  });
  if (!yes) return;
  // Members only lose the group; nobody is removed from the server.
  if (await act(() => deleteGroup(kind.value, g.id, true))) await load();
}

onMounted(load);
</script>

<template>
  <AppDialog width="640px" :title="t('server.groups.title')" @close="emit('close')">
    <div class="toolbar" data-testid="groups-dialog" role="tablist">
      <button
        type="button"
        role="tab"
        data-testid="groups-tab-server"
        :aria-selected="kind === 'server'"
        :class="{ on: kind === 'server' }"
        @click="kind = 'server'"
      >
        {{ t("server.groups.server") }}
      </button>
      <button
        type="button"
        role="tab"
        data-testid="groups-tab-channel"
        :aria-selected="kind === 'channel'"
        :class="{ on: kind === 'channel' }"
        @click="kind = 'channel'"
      >
        {{ t("server.groups.channel") }}
      </button>
      <span class="grow"></span>
      <button type="button" :disabled="busy" @click="load">{{ t("admin.refresh") }}</button>
    </div>
    <form v-if="mayCreate" class="toolbar" @submit.prevent="add">
      <input
        v-model="newName"
        class="grow"
        data-testid="group-new-name"
        :maxlength="GROUP_NAME_MAX"
        :placeholder="t('server.groups.newPlaceholder')"
        :aria-label="t('server.groups.newPlaceholder')"
        autocomplete="off"
      />
      <button type="submit" data-testid="group-add" :disabled="busy || !newName.trim()">
        ＋ {{ t("server.groups.add") }}
      </button>
    </form>
    <p v-if="problem" class="err" role="alert">{{ problem }}</p>
    <p v-if="error" class="err" role="alert">{{ error }}</p>
    <p v-if="loaded && !groups.length && !error" class="empty">{{ t("server.groups.none") }}</p>
    <ul class="rows">
      <li v-for="g in groups" :key="g.id" class="row" data-testid="group-row" :data-group-id="g.id">
        <form v-if="editing?.id === g.id" class="edit" @submit.prevent="saveEdit">
          <label>
            <span>{{ t("server.groups.name") }}</span>
            <input
              v-model="editing.name"
              data-testid="group-edit-name"
              :maxlength="GROUP_NAME_MAX"
              autocomplete="off"
            />
          </label>
          <label>
            <span>{{ t("server.groups.sortId") }}</span>
            <input
              v-model.number="editing.sortId"
              data-testid="group-edit-sort"
              type="number"
              min="0"
              step="1"
            />
          </label>
          <label>
            <span>{{ t("server.groups.nameMode") }}</span>
            <select v-model.number="editing.nameMode" data-testid="group-edit-namemode">
              <option v-for="m in NAME_MODES" :key="m" :value="m">
                {{ t(NAME_MODE_KEYS[m]!) }}
              </option>
            </select>
          </label>
          <div class="actions">
            <button type="button" @click="editing = null">{{ t("dialog.cancel") }}</button>
            <button type="submit" class="primary" data-testid="group-edit-save" :disabled="busy">
              {{ t("server.groups.save") }}
            </button>
          </div>
        </form>
        <form v-else-if="copying?.id === g.id" class="edit" @submit.prevent="saveCopy">
          <label>
            <span>{{ t("server.groups.copyAs", { name: g.name }) }}</span>
            <input
              v-model="copying.name"
              data-testid="group-copy-name"
              :maxlength="GROUP_NAME_MAX"
              autocomplete="off"
            />
          </label>
          <div class="actions">
            <button type="button" @click="copying = null">{{ t("dialog.cancel") }}</button>
            <button type="submit" class="primary" data-testid="group-copy-save" :disabled="busy">
              {{ t("server.groups.copy") }}
            </button>
          </div>
        </form>
        <template v-else>
          <div class="main">
            <span class="title" data-testid="group-name">{{ g.name }}</span>
            <span class="meta">
              #{{ g.id }} · {{ t("server.groups.sortIdShort", { n: g.sortId }) }} ·
              {{ t(NAME_MODE_KEYS[g.nameMode] ?? "server.groups.nameHidden") }}
            </span>
          </div>
          <div class="actions">
            <button
              v-if="gates.modifyGroups()"
              type="button"
              data-testid="group-edit"
              :disabled="busy"
              @click="startEdit(g)"
            >
              {{ t("server.groups.edit") }}
            </button>
            <button
              v-if="mayCreate"
              type="button"
              data-testid="group-copy"
              :disabled="busy"
              @click="startCopy(g)"
            >
              {{ t("server.groups.copy") }}
            </button>
            <button
              v-if="mayDelete"
              type="button"
              class="danger-text"
              data-testid="group-delete"
              :disabled="busy"
              @click="remove(g)"
            >
              {{ t("admin.delete") }}
            </button>
          </div>
        </template>
      </li>
    </ul>
    <template #footer>
      <button type="button" @click="emit('close')">{{ t("dialog.close") }}</button>
    </template>
  </AppDialog>
</template>

<style scoped src="../admin/admin.css"></style>
<style scoped>
.toolbar {
  margin-bottom: 8px;
}
button.on {
  border-color: var(--accent);
  color: var(--accent);
}
.edit {
  flex: 1 1 100%;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
  align-items: flex-end;
}
.edit label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 140px;
  min-width: 0;
  color: var(--text-dim);
  font-size: 12px;
}
.edit input,
.edit select {
  width: 100%;
  font: inherit;
}
.toolbar input {
  min-width: 0;
}
button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}
</style>
