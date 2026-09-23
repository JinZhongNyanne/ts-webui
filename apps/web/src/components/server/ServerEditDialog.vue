<script setup lang="ts">
/**
 * Edit the virtual server (`serveredit`), limited to the enumerated fields in
 * ts-commands-server.ts. The form starts from the session's server info and
 * `servergetvariables` (reserved slots, security level and forced silence
 * are only there); only fields that changed are sent, and a field the user
 * may not change is shown but disabled. The default groups start as "keep":
 * neither source reports them to a client.
 */
import { computed, onMounted, reactive, ref, shallowRef } from "vue";
import {
  HOST_MESSAGE_MAX,
  SECURITY_LEVEL_MAX,
  SERVER_NAME_MAX,
  SERVER_URL_MAX,
  ServerEditArgs,
  WELCOME_MESSAGE_MAX_BYTES,
  utf8Length,
  type ServerEditField,
} from "@jinz/protocol";
import AppDialog from "../ui/AppDialog.vue";
import { useI18n, type MessageKey } from "../../i18n";
import { useTsStore } from "../../stores/ts";
import { errorText } from "../admin/useBusy";
import { editServer, readServerVariables } from "./server-actions";
import {
  editValuesOf,
  serverEditPatch,
  type ServerEditValues,
  type ServerVariables,
} from "./server-rows";
import { useServerGates } from "./useServerGates";

const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const ts = useTsStore();
const gates = useServerGates();

const vars = shallowRef<ServerVariables>({});
const loading = ref(true);
const saving = ref(false);
const error = ref<string | null>(null);
const invalid = ref<ReadonlySet<string>>(new Set());

const current = computed<ServerEditValues | null>(() =>
  ts.server ? editValuesOf(ts.server, vars.value) : null,
);
const form = reactive<ServerEditValues>({ ...editValuesOf(emptyInfo(), {}) });

function emptyInfo() {
  return {
    name: "",
    welcomeMessage: "",
    hostMessage: "",
    hostMessageMode: 0,
    hostbannerUrl: "",
    hostbannerGfxUrl: "",
    hostbuttonUrl: "",
    hostbuttonGfxUrl: "",
    maxClients: 0,
  };
}

const REGULAR_GROUP = 1;
const byName = <G extends { name: string }>(a: G, b: G) => a.name.localeCompare(b.name);
const serverGroups = computed(() =>
  [...ts.serverGroups.values()].filter((g) => g.type === REGULAR_GROUP).sort(byName),
);
const channelGroups = computed(() =>
  [...ts.channelGroups.values()].filter((g) => g.type === REGULAR_GROUP).sort(byName),
);

const HOST_MODES: readonly { value: number; key: MessageKey }[] = [
  { value: 0, key: "server.hostMessageNone" },
  { value: 1, key: "server.hostMessageLog" },
  { value: 2, key: "server.hostMessageModal" },
  { value: 3, key: "server.hostMessageModalQuit" },
];

const welcomeBytes = computed(() => utf8Length(form.welcomeMessage));
const may = (field: ServerEditField) => gates.editField(field);

onMounted(async () => {
  try {
    vars.value = await readServerVariables();
  } catch {
    // Without them the form still edits what the server info holds; the
    // fields only the variables know start from 0 and are sent only if changed.
  } finally {
    if (current.value) Object.assign(form, current.value);
    loading.value = false;
  }
});

async function save(): Promise<void> {
  const base = current.value;
  if (!base) return;
  const patch = serverEditPatch(base, form);
  if (!patch) {
    emit("close");
    return;
  }
  const checked = ServerEditArgs.safeParse(patch);
  if (!checked.success) {
    invalid.value = new Set(checked.error.issues.map((i) => String(i.path[0] ?? "")));
    error.value = t("server.edit.invalid");
    return;
  }
  invalid.value = new Set();
  error.value = null;
  saving.value = true;
  try {
    await editServer(checked.data);
    ts.pushEvent(t("server.edit.saved"), "info");
    emit("close");
  } catch (err) {
    error.value = errorText(err);
  } finally {
    saving.value = false;
  }
}

const bad = (field: ServerEditField) => invalid.value.has(field);
</script>

<template>
  <AppDialog
    as="form"
    width="560px"
    :title="t('server.edit.title')"
    :dismissible="!saving"
    @submit="save"
    @close="emit('close')"
  >
    <div class="edit-form" data-testid="srvedit-dialog">
      <p v-if="loading" class="meta">{{ t("server.edit.loading") }}</p>
      <label :class="{ bad: bad('virtualserver_name') }">
        <span>{{ t("server.edit.name") }}</span>
        <input
          v-model="form.name"
          data-testid="srvedit-name"
          :maxlength="SERVER_NAME_MAX"
          :disabled="!may('virtualserver_name')"
          required
          autocomplete="off"
        />
      </label>
      <label :class="{ bad: bad('virtualserver_welcomemessage') }">
        <span>
          {{ t("server.welcome") }}
          <small>{{ welcomeBytes }} / {{ WELCOME_MESSAGE_MAX_BYTES }} B</small>
        </span>
        <textarea
          v-model="form.welcomeMessage"
          data-testid="srvedit-welcome"
          rows="3"
          :disabled="!may('virtualserver_welcomemessage')"
        ></textarea>
      </label>
      <div class="pair">
        <label :class="{ bad: bad('virtualserver_hostmessage') }">
          <span>{{ t("server.edit.hostMessage") }}</span>
          <textarea
            v-model="form.hostMessage"
            data-testid="srvedit-hostmessage"
            rows="2"
            :maxlength="HOST_MESSAGE_MAX"
            :disabled="!may('virtualserver_hostmessage')"
          ></textarea>
        </label>
        <label>
          <span>{{ t("server.edit.hostMessageMode") }}</span>
          <select
            v-model.number="form.hostMessageMode"
            :disabled="!may('virtualserver_hostmessage_mode')"
          >
            <option v-for="m in HOST_MODES" :key="m.value" :value="m.value">
              {{ t(m.key) }}
            </option>
          </select>
        </label>
      </div>
      <fieldset>
        <legend>{{ t("server.edit.banner") }}</legend>
        <label :class="{ bad: bad('virtualserver_hostbanner_gfx_url') }">
          <span>{{ t("server.edit.imageUrl") }}</span>
          <input
            v-model="form.hostbannerGfxUrl"
            type="url"
            data-testid="srvedit-banner-gfx"
            :maxlength="SERVER_URL_MAX"
            :disabled="!may('virtualserver_hostbanner_gfx_url')"
            placeholder="https://"
          />
        </label>
        <label :class="{ bad: bad('virtualserver_hostbanner_url') }">
          <span>{{ t("server.edit.linkUrl") }}</span>
          <input
            v-model="form.hostbannerUrl"
            type="url"
            :maxlength="SERVER_URL_MAX"
            :disabled="!may('virtualserver_hostbanner_url')"
            placeholder="https://"
          />
        </label>
      </fieldset>
      <fieldset>
        <legend>{{ t("server.edit.button") }}</legend>
        <label :class="{ bad: bad('virtualserver_hostbutton_gfx_url') }">
          <span>{{ t("server.edit.imageUrl") }}</span>
          <input
            v-model="form.hostbuttonGfxUrl"
            type="url"
            :maxlength="SERVER_URL_MAX"
            :disabled="!may('virtualserver_hostbutton_gfx_url')"
            placeholder="https://"
          />
        </label>
        <label :class="{ bad: bad('virtualserver_hostbutton_url') }">
          <span>{{ t("server.edit.linkUrl") }}</span>
          <input
            v-model="form.hostbuttonUrl"
            type="url"
            :maxlength="SERVER_URL_MAX"
            :disabled="!may('virtualserver_hostbutton_url')"
            placeholder="https://"
          />
        </label>
      </fieldset>
      <div class="pair">
        <label :class="{ bad: bad('virtualserver_maxclients') }">
          <span>{{ t("server.edit.maxClients") }}</span>
          <input
            v-model.number="form.maxClients"
            type="number"
            min="1"
            data-testid="srvedit-maxclients"
            :disabled="!may('virtualserver_maxclients')"
          />
        </label>
        <label :class="{ bad: bad('virtualserver_reserved_slots') }">
          <span>{{ t("server.edit.reservedSlots") }}</span>
          <input
            v-model.number="form.reservedSlots"
            type="number"
            min="0"
            :disabled="!may('virtualserver_reserved_slots')"
          />
        </label>
      </div>
      <div class="pair">
        <label>
          <span>{{ t("server.edit.defaultServerGroup") }}</span>
          <select
            v-model="form.defaultServerGroup"
            :disabled="!may('virtualserver_default_server_group')"
          >
            <option value="">{{ t("server.edit.keep") }}</option>
            <option v-for="g in serverGroups" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
        </label>
        <label>
          <span>{{ t("server.edit.defaultChannelGroup") }}</span>
          <select
            v-model="form.defaultChannelGroup"
            :disabled="!may('virtualserver_default_channel_group')"
          >
            <option value="">{{ t("server.edit.keep") }}</option>
            <option v-for="g in channelGroups" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
        </label>
      </div>
      <div class="pair">
        <label :class="{ bad: bad('virtualserver_needed_identity_security_level') }">
          <span>{{ t("server.edit.securityLevel") }}</span>
          <input
            v-model.number="form.securityLevel"
            type="number"
            min="0"
            :max="SECURITY_LEVEL_MAX"
            :disabled="!may('virtualserver_needed_identity_security_level')"
          />
        </label>
        <label :class="{ bad: bad('virtualserver_min_clients_in_channel_before_forced_silence') }">
          <span>{{ t("server.edit.forcedSilence") }}</span>
          <input
            v-model.number="form.forcedSilence"
            type="number"
            min="0"
            :disabled="!may('virtualserver_min_clients_in_channel_before_forced_silence')"
          />
        </label>
      </div>
      <p class="meta">{{ t("server.edit.scopeHint") }}</p>
      <p v-if="error" class="err" role="alert" data-testid="srvedit-error">{{ error }}</p>
    </div>
    <template #footer>
      <button type="button" @click="emit('close')">{{ t("dialog.cancel") }}</button>
      <button
        type="submit"
        class="primary"
        data-testid="srvedit-save"
        :disabled="saving || loading || !current"
      >
        {{ t("server.edit.save") }}
      </button>
    </template>
  </AppDialog>
</template>

<style scoped>
.edit-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  color: var(--text-dim);
  font-size: 12px;
}
label.bad input,
label.bad textarea {
  border-color: var(--danger);
}
label small {
  float: right;
  font-variant-numeric: tabular-nums;
}
input,
textarea,
select {
  width: 100%;
  min-width: 0;
  font: inherit;
}
textarea {
  resize: vertical;
}
fieldset {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 10px 10px;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
legend {
  color: var(--text-dim);
  font-size: 12px;
  padding: 0 4px;
}
.pair {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.pair > label {
  flex: 1 1 180px;
}
.meta {
  color: var(--text-dim);
  font-size: 12px;
  margin: 0;
}
.err {
  color: var(--danger);
  margin: 0;
  overflow-wrap: anywhere;
}
button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}
</style>
