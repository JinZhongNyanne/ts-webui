<script setup lang="ts">
/**
 * A client's server groups as a checklist: ticking adds them
 * (`servergroupaddclient`), unticking removes them (`servergroupdelclient`),
 * each at once. Groups belong to the identity, so the commands name the
 * database id. The ticks follow the live client: the server's
 * notifyservergroupclientadded/deleted updates it, and until then the box
 * shows what was asked for. When the server says the client already is (or
 * is not) in the group, our copy lagged: the box keeps what the server said
 * until the client's group list changes again.
 *
 * Offered where i_group_member_add_power or i_group_member_remove_power is
 * not known to be 0; the server also checks the group's needed member power.
 */
import { computed, onMounted, ref, watch } from "vue";
import AppDialog from "../ui/AppDialog.vue";
import GroupIconButton from "../icons/GroupIconButton.vue";
import { useTsStore } from "../../stores/ts";
import { useTargetClient } from "../../composables/useTargetClient";
import { useI18n } from "../../i18n";
import { tsCommand } from "../../ts/commands";
import { assignableGroups } from "../../ts/moderation";
import { setServerGroup } from "../../ts/moderation-actions";

const props = defineProps<{ clientId: number }>();
const emit = defineEmits<{ close: [] }>();
const ts = useTsStore();
const { t } = useI18n();

// Closes if they leave: their id may go to the next person to join.
const client = useTargetClient(ts.clients, props.clientId, () => emit("close"));
const groups = computed(() => assignableGroups(ts.serverGroups.values()));
/** Requested states still in flight, by group id. */
const pending = ref<ReadonlyMap<string, boolean>>(new Map());
/** Memberships the server confirmed while our copy of the client disagreed. */
const confirmed = ref<ReadonlyMap<string, boolean>>(new Map());
const error = ref<string | null>(null);

// Any change to the client's own list is newer than what the server told us.
watch(
  () => client.value?.serverGroups,
  () => {
    if (confirmed.value.size) confirmed.value = new Map();
  },
);

function member(groupId: string): boolean {
  return (
    pending.value.get(groupId) ??
    confirmed.value.get(groupId) ??
    client.value?.serverGroups.includes(groupId) ??
    false
  );
}

function withEntry(
  map: ReadonlyMap<string, boolean>,
  groupId: string,
  value: boolean | null,
): ReadonlyMap<string, boolean> {
  const next = new Map(map);
  if (value === null) next.delete(groupId);
  else next.set(groupId, value);
  return next;
}

function withPending(groupId: string, value: boolean | null): void {
  pending.value = withEntry(pending.value, groupId, value);
}

async function toggle(groupId: string, on: boolean): Promise<void> {
  const c = client.value;
  if (!c) {
    error.value = t("tsErr.invalidClient");
    return;
  }
  if (pending.value.has(groupId)) return;
  error.value = null;
  withPending(groupId, on);
  try {
    const outcome = await setServerGroup(c.databaseId, groupId, on);
    if (outcome === "unchanged") confirmed.value = withEntry(confirmed.value, groupId, on);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    // The notify comes before the command's answer, so the client is current.
    withPending(groupId, null);
  }
}

onMounted(() => {
  // Groups made or renamed since we connected; the hub folds the answer into
  // the store. Not everyone may list them, and the connect-time list is there anyway.
  tsCommand("servergrouplist", {}).catch(() => undefined);
});
</script>

<template>
  <AppDialog
    width="380px"
    :title="t('mod.serverGroupsTitle')"
    :subtitle="client?.nickname"
    @close="emit('close')"
  >
    <div data-testid="server-groups-dialog" class="groups">
      <p class="hint">{{ t("mod.serverGroupsHint") }}</p>
      <p v-if="!groups.length" class="hint">{{ t("mod.noGroups") }}</p>
      <label v-for="g in groups" :key="g.id" class="group" :data-sgid="g.id">
        <input
          type="checkbox"
          :checked="member(g.id)"
          :disabled="pending.has(g.id) || !client"
          @change="toggle(g.id, ($event.target as HTMLInputElement).checked)"
        />
        <span>{{ g.name }}</span>
        <GroupIconButton kind="serverGroup" :group="g" />
      </label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </div>
    <template #footer>
      <button type="button" @click="emit('close')">{{ t("m1.close") }}</button>
    </template>
  </AppDialog>
</template>

<style scoped>
.groups {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.group {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 2px;
  cursor: pointer;
}
.hint {
  margin: 0 0 4px;
  color: var(--text-dim);
  font-size: 12px;
}
.error {
  margin: 6px 0 0;
  color: var(--danger);
  font-size: 12px;
}
</style>
