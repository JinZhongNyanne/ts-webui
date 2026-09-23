<script setup lang="ts">
/**
 * The server's privilege keys: the list (`privilegekeylist`), a new one for a
 * server group or a channel group in one channel (`privilegekeyadd`, whose
 * answer names the new key so it can be copied at once), and deleting one
 * (`privilegekeydelete`). Gated on b_virtualserver_token_list; adding and
 * deleting on their own flags.
 */
import { computed, onMounted, ref, shallowRef } from "vue";
import { PRIVILEGE_KEY_DESC_MAX, TOKEN_CHANNEL_GROUP, TOKEN_SERVER_GROUP } from "@jinz/protocol";
import AppDialog from "../ui/AppDialog.vue";
import FormField from "../ui/FormField.vue";
import { confirmDialog } from "../ui/confirm";
import { useI18n } from "../../i18n";
import { useTsStore } from "../../stores/ts";
import { formatDateTime } from "../../ts/assets";
import { channelOptions } from "../../ts/admin-rows";
import { useBusy } from "../admin/useBusy";
import { addPrivilegeKey, deletePrivilegeKey, listPrivilegeKeys } from "./server-actions";
import type { PrivilegeKey } from "./server-rows";
import { useServerGates } from "./useServerGates";

const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const ts = useTsStore();
const gates = useServerGates();
const { busy, error, run, act } = useBusy();

const keys = shallowRef<readonly PrivilegeKey[]>([]);
const loaded = ref(false);
const adding = ref(false);
/** The key just made, shown until the next action so it can be copied. */
const created = ref("");

const REGULAR_GROUP = 1;
const regular = <G extends { type: number; name: string }>(groups: Iterable<G>) =>
  [...groups].filter((g) => g.type === REGULAR_GROUP).sort((a, b) => a.name.localeCompare(b.name));
const serverGroups = computed(() => regular(ts.serverGroups.values()));
const channelGroups = computed(() => regular(ts.channelGroups.values()));
const channels = computed(() => channelOptions(ts.channels.values()));

const draft = ref({ type: TOKEN_SERVER_GROUP as number, groupId: "", channelId: "", desc: "" });
const draftReady = computed(
  () =>
    !!draft.value.groupId && (draft.value.type === TOKEN_SERVER_GROUP || !!draft.value.channelId),
);

async function load(): Promise<void> {
  const res = await run(listPrivilegeKeys);
  if (res) keys.value = res;
  loaded.value = true;
}

function startAdding(): void {
  created.value = "";
  draft.value = { type: TOKEN_SERVER_GROUP, groupId: "", channelId: "", desc: "" };
  adding.value = true;
}

async function add(): Promise<void> {
  const d = draft.value;
  const token = await run(() =>
    addPrivilegeKey(
      d.type === TOKEN_CHANNEL_GROUP
        ? {
            tokentype: TOKEN_CHANNEL_GROUP,
            tokenid1: d.groupId,
            tokenid2: d.channelId,
            tokendescription: d.desc.trim(),
          }
        : { tokentype: TOKEN_SERVER_GROUP, tokenid1: d.groupId, tokendescription: d.desc.trim() },
    ),
  );
  if (token === undefined) return;
  adding.value = false;
  created.value = token;
  await load();
}

async function remove(k: PrivilegeKey): Promise<void> {
  const yes = await confirmDialog({
    title: t("server.pk.deleteTitle"),
    message: t("server.pk.deleteHint", { group: groupName(k) }),
    confirmLabel: t("admin.delete"),
    danger: true,
  });
  if (!yes) return;
  created.value = "";
  if (await act(() => deletePrivilegeKey(k.token))) {
    keys.value = keys.value.filter((x) => x.token !== k.token);
  }
}

async function copy(token: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(token);
    ts.pushEvent(t("server.pk.copied"), "info");
  } catch {
    // No clipboard (insecure context, denied): the key is on screen to copy by hand.
    ts.pushEvent(t("server.pk.copyFailed"), "warn");
  }
}

function groupName(k: PrivilegeKey): string {
  if (k.type === TOKEN_CHANNEL_GROUP) {
    const group = ts.channelGroups.get(k.groupId)?.name ?? `#${k.groupId}`;
    const channel = k.channelId ? (ts.channels.get(k.channelId)?.name ?? `#${k.channelId}`) : "";
    return t("server.pk.channelGroupIn", { group, channel });
  }
  return ts.serverGroups.get(k.groupId)?.name ?? `#${k.groupId}`;
}

onMounted(load);
</script>

<template>
  <AppDialog width="620px" :title="t('server.pk.title')" @close="emit('close')">
    <form v-if="adding" class="pk-form" data-testid="pk-form" @submit.prevent="add">
      <FormField v-slot="f" :label="t('server.pk.kind')">
        <select :id="f.id" v-model.number="draft.type" data-testid="pk-kind">
          <option :value="TOKEN_SERVER_GROUP">{{ t("server.pk.kindServer") }}</option>
          <option :value="TOKEN_CHANNEL_GROUP">{{ t("server.pk.kindChannel") }}</option>
        </select>
      </FormField>
      <FormField v-slot="f" :label="t('server.pk.group')" required>
        <select :id="f.id" v-model="draft.groupId" data-testid="pk-group">
          <option value="" disabled>{{ t("server.pk.pickGroup") }}</option>
          <option
            v-for="g in draft.type === TOKEN_SERVER_GROUP ? serverGroups : channelGroups"
            :key="g.id"
            :value="g.id"
          >
            {{ g.name }}
          </option>
        </select>
      </FormField>
      <FormField
        v-if="draft.type === TOKEN_CHANNEL_GROUP"
        v-slot="f"
        :label="t('server.pk.channel')"
        required
      >
        <select :id="f.id" v-model="draft.channelId" data-testid="pk-channel">
          <option value="" disabled>{{ t("server.pk.pickChannel") }}</option>
          <option v-for="c in channels" :key="c.id" :value="c.id">{{ c.path }}</option>
        </select>
      </FormField>
      <FormField v-slot="f" :label="t('server.pk.description')">
        <input
          :id="f.id"
          v-model="draft.desc"
          data-testid="pk-desc"
          :maxlength="PRIVILEGE_KEY_DESC_MAX"
          autocomplete="off"
        />
      </FormField>
      <p v-if="error" class="err" role="alert">{{ error }}</p>
      <div class="toolbar end">
        <button type="button" @click="adding = false">{{ t("dialog.cancel") }}</button>
        <button
          type="submit"
          class="primary"
          data-testid="pk-create"
          :disabled="busy || !draftReady"
        >
          {{ t("server.pk.create") }}
        </button>
      </div>
    </form>
    <template v-else>
      <div class="toolbar" data-testid="pk-dialog">
        <span class="grow meta">{{ t("server.pk.intro") }}</span>
        <button v-if="gates.addKey()" type="button" data-testid="pk-new" @click="startAdding">
          ＋ {{ t("server.pk.new") }}
        </button>
        <button type="button" :disabled="busy" @click="load">{{ t("admin.refresh") }}</button>
      </div>
      <div v-if="created" class="created" data-testid="pk-created">
        <span class="meta">{{ t("server.pk.createdHint") }}</span>
        <div class="toolbar">
          <code class="grow" data-testid="pk-created-token">{{ created }}</code>
          <button type="button" @click="copy(created)">{{ t("server.pk.copy") }}</button>
        </div>
      </div>
      <p v-if="error" class="err" role="alert">{{ error }}</p>
      <p v-if="loaded && !keys.length && !error" class="empty">{{ t("server.pk.none") }}</p>
      <ul class="rows">
        <li v-for="k in keys" :key="k.token" class="row" data-testid="pk-row">
          <div class="main">
            <span class="title">{{ groupName(k) }}</span>
            <code class="meta">{{ k.token }}</code>
            <span class="meta">
              {{ formatDateTime(k.created / 1000) }}
              <template v-if="k.description"> · {{ k.description }}</template>
            </span>
          </div>
          <div class="actions">
            <button type="button" @click="copy(k.token)">{{ t("server.pk.copy") }}</button>
            <button
              v-if="gates.deleteKey()"
              type="button"
              class="danger-text"
              :disabled="busy"
              @click="remove(k)"
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

<style scoped src="../admin/admin.css"></style>
<style scoped>
.pk-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.end {
  justify-content: flex-end;
}
.meta {
  color: var(--text-dim);
  font-size: 12px;
}
code {
  overflow-wrap: anywhere;
}
.created {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid var(--accent);
  border-radius: 8px;
}
select,
input {
  width: 100%;
  font: inherit;
}
button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}
</style>
