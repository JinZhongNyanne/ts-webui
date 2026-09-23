<script setup lang="ts">
/**
 * One client database entry: what the server knows, the description to edit
 * (`clientdbedit`, b_client_modify_dbproperties) and deletion
 * (`clientdbdelete`, b_client_delete_dbproperties, behind a danger confirm).
 */
import { ref } from "vue";
import { confirmDialog } from "../ui/confirm";
import { openClientDialog } from "../client/client-dialogs";
import { useI18n } from "../../i18n";
import { formatDateTime } from "../../ts/assets";
import { deleteClientDbEntry, setClientDbDescription } from "../../ts/admin-actions";
import type { DbEntry } from "../../ts/admin-rows";
import { DESCRIPTION_MAX } from "../../ts/client-features";
import { useAdminGates } from "./useAdminGates";
import { useBusy } from "./useBusy";

const props = defineProps<{ entry: DbEntry }>();
const emit = defineEmits<{ changed: [DbEntry]; deleted: [string]; back: [] }>();
const { t } = useI18n();
const gates = useAdminGates();
const { busy, error, act } = useBusy();

const description = ref(props.entry.description);
const saved = ref(false);

async function save(): Promise<void> {
  saved.value = false;
  if (await act(() => setClientDbDescription(props.entry.dbId, description.value))) {
    saved.value = true;
    emit("changed", { ...props.entry, description: description.value });
  }
}

async function remove(): Promise<void> {
  const yes = await confirmDialog({
    title: t("admin.db.deleteTitle", { name: props.entry.nickname }),
    message: t("admin.db.deleteHint"),
    confirmLabel: t("admin.delete"),
    danger: true,
  });
  if (!yes) return;
  if (await act(() => deleteClientDbEntry(props.entry.dbId))) emit("deleted", props.entry.dbId);
}

function message(): void {
  openClientDialog({
    kind: "composeMessage",
    uid: props.entry.uid,
    nickname: props.entry.nickname,
  });
}

const when = (ms: number) => formatDateTime(ms / 1000);
</script>

<template>
  <section class="details-pane" data-testid="clientdb-details">
    <div class="toolbar">
      <button type="button" @click="emit('back')">← {{ t("admin.back") }}</button>
      <strong class="grow name">{{ entry.nickname }}</strong>
    </div>
    <dl class="details">
      <dt>{{ t("admin.db.uid") }}</dt>
      <dd>{{ entry.uid }}</dd>
      <dt>{{ t("admin.db.dbId") }}</dt>
      <dd>{{ entry.dbId }}</dd>
      <dt>{{ t("admin.db.created") }}</dt>
      <dd>{{ when(entry.created) }}</dd>
      <dt>{{ t("admin.db.lastConnected") }}</dt>
      <dd>{{ when(entry.lastConnected) }}</dd>
      <dt>{{ t("admin.db.connections") }}</dt>
      <dd>{{ entry.totalConnections }}</dd>
      <dt v-if="entry.lastIp">{{ t("admin.db.lastIp") }}</dt>
      <dd v-if="entry.lastIp">{{ entry.lastIp }}</dd>
    </dl>
    <label class="desc-label" for="clientdb-description">{{ t("info.clientDescription") }}</label>
    <textarea
      id="clientdb-description"
      v-model="description"
      data-testid="clientdb-description"
      rows="3"
      :maxlength="DESCRIPTION_MAX"
      :readonly="!gates.editDb()"
    ></textarea>
    <p v-if="error" class="err" role="alert">{{ error }}</p>
    <p v-else-if="saved" class="meta">{{ t("admin.saved") }}</p>
    <div class="toolbar">
      <button
        v-if="gates.editDb()"
        type="button"
        class="primary"
        :disabled="busy || description === entry.description"
        @click="save"
      >
        {{ t("desc.save") }}
      </button>
      <button v-if="gates.sendOffline()" type="button" @click="message">
        ✉️ {{ t("admin.sendOffline") }}
      </button>
      <span class="grow"></span>
      <button
        v-if="gates.deleteDb()"
        type="button"
        class="danger-text"
        :disabled="busy"
        @click="remove"
      >
        {{ t("admin.db.delete") }}
      </button>
    </div>
  </section>
</template>

<style scoped src="./admin.css"></style>
<style scoped>
.details-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.name {
  overflow-wrap: anywhere;
}
.desc-label,
.meta {
  color: var(--text-dim);
  font-size: 12px;
  margin: 0;
}
button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}
</style>
