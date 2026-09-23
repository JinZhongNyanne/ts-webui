<script setup lang="ts">
/**
 * A client's channel group in the channel they are in now: one of the
 * server's regular channel groups, applied on pick with
 * `setclientchannelgroup`. The server checks i_group_member_add_power (and,
 * for the group they leave, i_group_member_remove_power, which is what it
 * names when it refuses).
 */
import { computed, onMounted, ref } from "vue";
import AppDialog from "../ui/AppDialog.vue";
import GroupIconButton from "../icons/GroupIconButton.vue";
import { useTsStore } from "../../stores/ts";
import { useTargetClient } from "../../composables/useTargetClient";
import { useI18n } from "../../i18n";
import { tsCommand } from "../../ts/commands";
import { displayChannelName } from "../../ts/format";
import { assignableGroups } from "../../ts/moderation";
import { setChannelGroup } from "../../ts/moderation-actions";

const props = defineProps<{ clientId: number }>();
const emit = defineEmits<{ close: [] }>();
const ts = useTsStore();
const { t } = useI18n();

// Closes if they leave: their id may go to the next person to join.
const client = useTargetClient(ts.clients, props.clientId, () => emit("close"));
const channel = computed(() => (client.value ? ts.channels.get(client.value.channelId) : null));
const groups = computed(() => assignableGroups(ts.channelGroups.values()));
/** The group asked for, until the server's notify makes it the client's. */
const pending = ref<string | null>(null);
const error = ref<string | null>(null);
const current = computed(() => pending.value ?? client.value?.channelGroupId ?? "");

async function pick(groupId: string): Promise<void> {
  const c = client.value;
  if (!c) {
    error.value = t("tsErr.invalidClient");
    return;
  }
  if (pending.value || groupId === c.channelGroupId) return;
  error.value = null;
  pending.value = groupId;
  try {
    await setChannelGroup(c.databaseId, c.channelId, groupId);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    pending.value = null;
  }
}

onMounted(() => {
  // As for server groups: pick up groups made since we connected, if we may list them.
  tsCommand("channelgrouplist", {}).catch(() => undefined);
});
</script>

<template>
  <AppDialog
    width="380px"
    :title="t('mod.channelGroupTitle')"
    :subtitle="client?.nickname"
    @close="emit('close')"
  >
    <div data-testid="channel-group-dialog" class="groups" role="radiogroup">
      <p v-if="channel" class="hint">
        {{
          t("mod.channelGroupIn", { channel: displayChannelName(channel.name, channel.parentId) })
        }}
      </p>
      <p v-if="!groups.length" class="hint">{{ t("mod.noGroups") }}</p>
      <label v-for="g in groups" :key="g.id" class="group" :data-cgid="g.id">
        <input
          type="radio"
          name="channel-group"
          :value="g.id"
          :checked="current === g.id"
          :disabled="!!pending || !client"
          @change="pick(g.id)"
        />
        <span>{{ g.name }}</span>
        <GroupIconButton kind="channelGroup" :group="g" />
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
