<script setup lang="ts">
/**
 * Settings pane for whispering: who the whisper hotkey reaches (TS3's group
 * presets plus hand-picked channels and people) and whether whispers from
 * others are heard at all.
 *
 * The list is stored in presets, channel ids and client UIDs, and turned into
 * targets only when the key goes down (see whisper-targets.ts); the preview
 * line shows what that would be right now — and, when the server has said
 * this client has no whisper power, that it may drop all of it
 * (whisper-power.ts).
 */
import { computed } from "vue";
import { WHISPER_MAX_TARGETS, type TsChannel } from "@jinz/protocol";
import { useI18n, type MessageKey } from "../../i18n";
import { useTsStore } from "../../stores/ts";
import { useVoiceStore, type WhisperPolicy } from "../../stores/voice";
import { useHotkeysStore } from "../../stores/hotkeys";
import { usePermsStore } from "../../stores/perms";
import { comboLabel, parseCombo } from "../../hotkeys/combo";
import type { ChannelNode } from "../../ts/tree";
import {
  resolveWhisperTargets,
  WHISPER_PRESETS,
  type WhisperList,
  type WhisperPreset,
} from "./whisper-targets";
import { lacksWhisperPower } from "./whisper-power";

const { t } = useI18n();
const ts = useTsStore();
const voice = useVoiceStore();
const hotkeys = useHotkeysStore();
const perms = usePermsStore();

const powerless = computed(() => lacksWhisperPower(perms.values, perms.loaded));

const list = computed(() => voice.whisperList);

function update(patch: Partial<WhisperList>): void {
  voice.whisperList = { ...voice.whisperList, ...patch };
}

const hotkeyLine = computed(() => {
  const combo = parseCombo(hotkeys.bindings.whisper);
  return combo ? t("whisper.hotkey", { key: comboLabel(combo) }) : t("whisper.hotkeyUnbound");
});

function togglePreset(preset: WhisperPreset, on: boolean): void {
  const rest = list.value.presets.filter((p) => p !== preset);
  // Kept in the catalogue's order, so the list resolves the same way however it was ticked.
  const presets = on ? WHISPER_PRESETS.filter((p) => p === preset || rest.includes(p)) : rest;
  update({ presets });
}

/** One level of indent in the channel picker; an <option> collapses ordinary spaces. */
const PICKER_INDENT = "\u00a0\u00a0";

/** Channels in tree order, indented by depth, for the "add a channel" picker. */
const channelOptions = computed(() => {
  const out: { channel: TsChannel; label: string }[] = [];
  const walk = (nodes: readonly ChannelNode[]) => {
    for (const node of nodes) {
      out.push({
        channel: node.channel,
        label: PICKER_INDENT.repeat(node.depth) + node.channel.name,
      });
      walk(node.children);
    }
  };
  walk(ts.tree);
  return out.filter((o) => !list.value.channels.includes(o.channel.id));
});

const pickedChannels = computed(() =>
  list.value.channels.map((id) => ({
    id,
    label: ts.channels.get(id)?.name ?? t("whisper.unknownChannel", { id }),
  })),
);

/** People online now, not us, not ServerQuery clients, not already on the list. */
const clientOptions = computed(() =>
  [...ts.clients.values()]
    .filter((c) => !c.isSelf && c.type === 0 && !list.value.clients.includes(c.uid))
    .sort((a, b) => a.nickname.localeCompare(b.nickname)),
);

const pickedClients = computed(() =>
  list.value.clients.map((uid) => {
    const online = [...ts.clients.values()].find((c) => c.uid === uid);
    return {
      uid,
      label: online ? online.nickname : `${uid.slice(0, 10)}… ${t("whisper.offline")}`,
    };
  }),
);

function addChannel(ev: Event): void {
  const select = ev.target as HTMLSelectElement;
  if (select.value) update({ channels: [...list.value.channels, select.value] });
  select.value = "";
}

function addClient(ev: Event): void {
  const select = ev.target as HTMLSelectElement;
  if (select.value) update({ clients: [...list.value.clients, select.value] });
  select.value = "";
}

const preview = computed(() =>
  resolveWhisperTargets(list.value, {
    channels: [...ts.channels.values()],
    clients: [...ts.clients.values()],
    selfChannelId: ts.selfChannel?.id ?? null,
  }),
);

function setPolicy(policy: WhisperPolicy): void {
  voice.whisperPolicy = policy;
}
</script>

<template>
  <div class="pane" data-testid="whisper-pane">
    <p class="hint">{{ t("whisper.intro") }}</p>
    <p class="hint">{{ hotkeyLine }}</p>

    <h4>{{ t("whisper.targets.title") }}</h4>
    <label v-for="preset in WHISPER_PRESETS" :key="preset" class="row check">
      <input
        type="checkbox"
        :data-testid="`whisper-preset-${preset}`"
        :checked="list.presets.includes(preset)"
        @change="togglePreset(preset, ($event.target as HTMLInputElement).checked)"
      />
      <span>{{ t(`whisper.preset.${preset}` as MessageKey) }}</span>
    </label>

    <h4>{{ t("whisper.channels.title") }}</h4>
    <ul v-if="pickedChannels.length" class="picked">
      <li v-for="c in pickedChannels" :key="c.id">
        <span>{{ c.label }}</span>
        <button
          type="button"
          :title="t('whisper.remove')"
          @click="update({ channels: list.channels.filter((id) => id !== c.id) })"
        >
          ×
        </button>
      </li>
    </ul>
    <select data-testid="whisper-add-channel" @change="addChannel">
      <option value="">{{ t("whisper.channels.add") }}</option>
      <option v-for="o in channelOptions" :key="o.channel.id" :value="o.channel.id">
        {{ o.label }}
      </option>
    </select>

    <h4>{{ t("whisper.clients.title") }}</h4>
    <ul v-if="pickedClients.length" class="picked">
      <li v-for="c in pickedClients" :key="c.uid" :data-testid="`whisper-picked-${c.uid}`">
        <span>{{ c.label }}</span>
        <button
          type="button"
          :title="t('whisper.remove')"
          @click="update({ clients: list.clients.filter((uid) => uid !== c.uid) })"
        >
          ×
        </button>
      </li>
    </ul>
    <select data-testid="whisper-add-client" @change="addClient">
      <option value="">{{ t("whisper.clients.add") }}</option>
      <option v-for="c in clientOptions" :key="c.id" :value="c.uid">{{ c.nickname }}</option>
    </select>

    <p class="hint" data-testid="whisper-preview">
      {{
        preview.channels.length + preview.clients.length === 0
          ? t("whisper.previewEmpty")
          : t("whisper.preview", {
              channels: preview.channels.length,
              clients: preview.clients.length,
            })
      }}
    </p>
    <p v-if="powerless" class="warn" role="note" data-testid="whisper-power-hint">
      ⚠ {{ t("whisper.noPowerHint") }}
    </p>
    <p v-if="preview.truncated" class="warn">
      {{ t("whisper.truncated", { max: WHISPER_MAX_TARGETS }) }}
    </p>

    <h4>{{ t("whisper.receive.title") }}</h4>
    <label class="row check">
      <input
        type="radio"
        name="whisper-policy"
        data-testid="whisper-policy-allow"
        :checked="voice.whisperPolicy === 'allow'"
        @change="setPolicy('allow')"
      />
      <span>{{ t("whisper.receive.allow") }}</span>
    </label>
    <label class="row check">
      <input
        type="radio"
        name="whisper-policy"
        data-testid="whisper-policy-block"
        :checked="voice.whisperPolicy === 'block'"
        @change="setPolicy('block')"
      />
      <span>{{ t("whisper.receive.block") }}</span>
    </label>
  </div>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
h4 {
  margin: 4px 0 0;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-dim);
}
.row input {
  width: auto;
}
.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-dim);
}
.warn {
  margin: 0;
  font-size: 11px;
  color: var(--warn);
}
select {
  max-width: 100%;
}
.picked {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.picked li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  min-width: 0;
}
.picked li span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
