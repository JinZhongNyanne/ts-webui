<script setup lang="ts">
/**
 * "Move to…": pick a channel from a searchable copy of the tree and move the
 * client there (ourselves included, which is just a join). A channel with a
 * password gets a password field; someone allowed to ignore passwords can
 * leave it empty. Moving others needs i_client_move_power against their
 * needed power; the server decides, and its refusal is shown here.
 *
 * The search box drives the list as a combobox: arrow keys pick a row
 * (announced through aria-activedescendant), Enter moves.
 */
import { computed, nextTick, ref, useId } from "vue";
import AppDialog from "../ui/AppDialog.vue";
import FormField from "../ui/FormField.vue";
import { useTsStore } from "../../stores/ts";
import { useTargetClient } from "../../composables/useTargetClient";
import { useI18n } from "../../i18n";
import { displayChannelName } from "../../ts/format";
import { channelPickerRows, stepPick } from "../../ts/moderation";
import { moveClient } from "../../ts/moderation-actions";

const props = defineProps<{ clientId: number; channelId?: string }>();
const emit = defineEmits<{ close: [] }>();
const ts = useTsStore();
const { t } = useI18n();

// Closes if they leave: their id may go to the next person to join.
const client = useTargetClient(ts.clients, props.clientId, () => emit("close"));
const query = ref("");
const selectedId = ref<string | null>(props.channelId ?? null);
const password = ref("");
const busy = ref(false);
const error = ref<string | null>(null);

const rows = computed(() => channelPickerRows(ts.tree, query.value));
const target = computed(() =>
  selectedId.value ? (ts.channels.get(selectedId.value) ?? null) : null,
);

function pick(id: string): void {
  if (id === client.value?.channelId) return;
  if (id !== selectedId.value) password.value = "";
  selectedId.value = id;
  error.value = null;
}

/** Option element ids, so the search box can point at the picked row. */
const listId = useId();
const optionId = (channelId: string) => `${listId}-${channelId}`;
const activeOption = computed(() =>
  rows.value.some((r) => r.channel.id === selectedId.value)
    ? optionId(selectedId.value!)
    : undefined,
);

/** Arrow keys in the search box walk the list; Enter submits the form as usual. */
async function step(delta: 1 | -1): Promise<void> {
  const ids = rows.value.map((r) => r.channel.id);
  const next = stepPick(ids, selectedId.value, delta, client.value?.channelId);
  if (next === null) return;
  pick(next);
  await nextTick();
  document.getElementById(optionId(next))?.scrollIntoView({ block: "nearest" });
}

function pickAndMove(id: string): void {
  if (id === client.value?.channelId) return;
  pick(id);
  // A password channel still needs its field filled in first.
  if (!target.value?.flags.password) void move();
}

async function move(): Promise<void> {
  if (busy.value) return;
  if (!client.value) {
    error.value = t("tsErr.invalidClient");
    return;
  }
  if (!target.value) {
    error.value = t("mod.pickChannel");
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await moveClient(props.clientId, target.value.id, password.value);
    emit("close");
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppDialog
    as="form"
    width="440px"
    :title="t('mod.moveTitle')"
    :subtitle="client?.nickname"
    :dismissible="!busy"
    @submit="move"
    @close="emit('close')"
  >
    <FormField
      data-testid="move-dialog"
      v-slot="f"
      :label="t('mod.moveSearch')"
      :error="target?.flags.password ? null : error"
    >
      <input
        :id="f.id"
        v-model="query"
        type="search"
        autocomplete="off"
        autofocus
        role="combobox"
        aria-autocomplete="list"
        aria-expanded="true"
        :aria-controls="listId"
        :aria-activedescendant="activeOption"
        :aria-describedby="f.describedby"
        :aria-invalid="f.invalid"
        @keydown.down.prevent="step(1)"
        @keydown.up.prevent="step(-1)"
      />
    </FormField>
    <ul :id="listId" class="picker" role="listbox" :aria-label="t('mod.moveSearch')">
      <li v-if="!rows.length" class="empty">{{ t("mod.moveNoMatch") }}</li>
      <li
        v-for="r in rows"
        :id="optionId(r.channel.id)"
        :key="r.channel.id"
        role="option"
        class="row"
        :class="{
          selected: r.channel.id === selectedId,
          current: r.channel.id === client?.channelId,
        }"
        :aria-selected="r.channel.id === selectedId"
        :aria-disabled="r.channel.id === client?.channelId"
        :data-cid="r.channel.id"
        :style="{ paddingLeft: `${8 + r.depth * 14}px` }"
        @click="pick(r.channel.id)"
        @dblclick="pickAndMove(r.channel.id)"
      >
        <span class="name">{{ displayChannelName(r.channel.name, r.channel.parentId) }}</span>
        <span v-if="r.channel.flags.password" class="lock" aria-hidden="true">🔒</span>
        <span v-if="r.channel.id === client?.channelId" class="tag">{{
          t("mod.moveCurrent")
        }}</span>
      </li>
    </ul>
    <FormField
      v-if="target?.flags.password"
      v-slot="f"
      :label="t('mod.movePassword')"
      :hint="t('mod.movePasswordHint')"
      :error="error"
    >
      <input
        :id="f.id"
        v-model="password"
        type="password"
        autocomplete="off"
        data-testid="move-password"
        :aria-describedby="f.describedby"
        :aria-invalid="f.invalid"
      />
    </FormField>
    <template #footer>
      <button type="button" @click="emit('close')">{{ t("dialog.cancel") }}</button>
      <button type="submit" class="primary" :disabled="busy || !target">
        {{ t("mod.move") }}
      </button>
    </template>
  </AppDialog>
</template>

<style scoped>
.picker {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  max-height: 300px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding-right: 8px;
  cursor: pointer;
  white-space: nowrap;
}
.row:hover {
  background: var(--bg-elev-2);
}
.row.selected {
  background: rgba(79, 140, 255, 0.16);
  outline: 1px solid var(--accent);
}
.row.current {
  color: var(--text-dim);
  cursor: default;
}
.name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lock,
.tag {
  font-size: 11px;
  color: var(--text-dim);
}
.empty {
  padding: 8px;
  color: var(--text-dim);
}
</style>
