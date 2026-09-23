<script setup lang="ts">
import { computed } from "vue";
import { useTsStore } from "../stores/ts";
import { useVoiceStore } from "../stores/voice";
import {
  countryFlag,
  countryName,
  formatDateTime,
  formatUptime,
  iconUrl,
  renderBBCode,
} from "../ts/assets";
import { useI18n } from "../i18n";
import { onRichClick } from "../chat/richClick";
import "../chat/bbcode.css";
import type { MessageKey } from "../i18n";
import ClientAvatar from "./client/ClientAvatar.vue";
import { openClientDialog } from "./client/client-dialogs";
import { useClientMenus } from "./client/useClientMenus";
import { setTalker } from "../ts/client-actions";
import { denyTalkRequest } from "../ts/moderation-actions";
import { safeHttpUrl } from "../ts/bbcode";
import HostImage from "./server/HostImage.vue";
import ConnectionInfo from "./server/ConnectionInfo.vue";
import { useServerGates } from "./server/useServerGates";

const ts = useTsStore();
const voice = useVoiceStore();
const { t } = useI18n();
const clientMenus = useClientMenus();
const serverGates = useServerGates();
const sel = computed(() => ts.selection);
const s = computed(() => ts.server);

/** Live loudness meter for the selected client (from the mixer worklet). */
const meter = computed(() => (client.value ? voice.clientLevels[String(client.value.id)] : null));
function meterPct(db: number | null | undefined): number {
  if (db === null || db === undefined || db <= -60) return 0;
  return Math.max(0, Math.min(100, Math.round(((db + 60) / 60) * 100)));
}

const channel = computed(() =>
  sel.value?.kind === "channel" ? (ts.channels.get(sel.value.id) ?? null) : null,
);
const client = computed(() =>
  sel.value?.kind === "client" ? (ts.clients.get(Number(sel.value.id)) ?? null) : null,
);
const channelDesc = computed(() =>
  channel.value ? (ts.descriptions.get(channel.value.id) ?? "") : "",
);
const clientRaw = computed(() =>
  client.value ? (ts.clientInfoRaw.get(client.value.id) ?? {}) : {},
);

const hostModeLabel: Record<number, MessageKey> = {
  0: "server.hostMessageNone",
  1: "server.hostMessageLog",
  2: "server.hostMessageModal",
  3: "server.hostMessageModalQuit",
};

function num(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function bytes(v: string | undefined): string {
  let n = num(v);
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

/** Only an http(s) link: the server's owner typed it, and `javascript:` must not run here. */
const hostbuttonHref = computed(() =>
  s.value?.hostbuttonUrl ? safeHttpUrl(s.value.hostbuttonUrl) : null,
);

const onlineNow = computed(() => {
  const known = s.value?.clientsOnline ?? 0;
  return known > 0 ? known : ts.clients.size;
});

const connectedFor = computed(() => {
  const ms = num(clientRaw.value["connection_connected_time"]);
  return ms ? formatUptime(Math.floor(ms / 1000)) : "";
});
</script>

<template>
  <div class="info">
    <!-- Server -->
    <template v-if="sel?.kind === 'server' && s">
      <header class="head">
        <img v-if="iconUrl(s.iconId)" :src="iconUrl(s.iconId)!" class="icon" alt="" />
        <div class="titles">
          <div class="name">{{ s.name }}</div>
          <div v-if="s.namePhonetic" class="sub">{{ s.namePhonetic }}</div>
        </div>
      </header>
      <!-- Click-to-load: the banner's host would otherwise see who opened this (HostImage). -->
      <div v-if="s.hostbannerGfxUrl" class="banner" data-testid="info-banner">
        <HostImage :url="s.hostbannerGfxUrl" :link="s.hostbannerUrl" variant="banner" />
      </div>
      <div v-if="s.welcomeMessage" class="block">
        <div class="label">{{ t("server.welcome") }}</div>
        <div
          class="rich bb-rich"
          @click="onRichClick"
          v-html="renderBBCode(s.welcomeMessage)"
        ></div>
      </div>
      <div v-if="s.hostMessage" class="block">
        <div class="label">
          {{
            t("server.hostMessage", {
              mode: hostModeLabel[s.hostMessageMode]
                ? t(hostModeLabel[s.hostMessageMode]!)
                : s.hostMessageMode,
            })
          }}
        </div>
        <div class="rich bb-rich" @click="onRichClick" v-html="renderBBCode(s.hostMessage)"></div>
      </div>
      <dl class="grid">
        <dt>{{ t("server.version") }}</dt>
        <dd>{{ s.version }}</dd>
        <dt>{{ t("server.platform") }}</dt>
        <dd>{{ s.platform }}</dd>
        <dt>{{ t("server.kind") }}</dt>
        <dd>{{ s.flavor.toUpperCase() }}</dd>
        <dt>{{ t("server.clientsOnline") }}</dt>
        <dd>
          {{ onlineNow }}<template v-if="s.maxClients"> / {{ s.maxClients }}</template>
        </dd>
        <template v-if="s.channelsOnline">
          <dt>{{ t("server.channels") }}</dt>
          <dd>{{ s.channelsOnline }}</dd>
        </template>
        <template v-if="s.created">
          <dt>{{ t("server.created") }}</dt>
          <dd>{{ formatDateTime(s.created) }}</dd>
        </template>
        <template v-if="s.uptime">
          <dt>{{ t("server.uptime") }}</dt>
          <dd>{{ formatUptime(s.uptime) }}</dd>
        </template>
      </dl>
      <div v-if="s.hostbuttonGfxUrl || hostbuttonHref" class="hostbutton">
        <HostImage
          v-if="s.hostbuttonGfxUrl"
          :url="s.hostbuttonGfxUrl"
          :link="s.hostbuttonUrl"
          :title="s.hostbuttonTooltip"
          variant="button"
        />
        <a
          v-if="hostbuttonHref"
          :href="hostbuttonHref"
          :title="s.hostbuttonTooltip"
          target="_blank"
          rel="noreferrer"
          >{{ s.hostbuttonTooltip || s.hostbuttonUrl }}</a
        >
      </div>
      <ConnectionInfo v-if="serverGates.connectionInfo()" />
    </template>

    <!-- Channel -->
    <template v-else-if="channel">
      <header class="head">
        <img v-if="iconUrl(channel.iconId)" :src="iconUrl(channel.iconId)!" class="icon" alt="" />
        <div class="titles">
          <div class="name">{{ channel.name }}</div>
          <div class="sub">{{ t("chat.channel") }}</div>
        </div>
      </header>
      <div v-if="channel.topic" class="block">
        <div class="label">{{ t("info.topic") }}</div>
        <div class="rich">{{ channel.topic }}</div>
      </div>
      <div v-if="channelDesc" class="block">
        <div class="label">{{ t("info.description") }}</div>
        <div class="rich bb-rich" @click="onRichClick" v-html="renderBBCode(channelDesc)"></div>
      </div>
      <dl class="grid">
        <dt>{{ t("info.codec") }}</dt>
        <dd>
          {{
            ["Speex NB", "Speex WB", "Speex UWB", "CELT", "Opus Voice", "Opus Music"][
              channel.codec
            ] ?? channel.codec
          }}{{ t("info.codecQuality", { quality: channel.codecQuality }) }}
        </dd>
        <dt>{{ t("info.maxClients") }}</dt>
        <dd>{{ channel.flags.maxClientsUnlimited ? t("info.unlimited") : channel.maxClients }}</dd>
        <dt>{{ t("info.neededTalkPower") }}</dt>
        <dd>{{ channel.neededTalkPower }}</dd>
        <dt>{{ t("server.kind") }}</dt>
        <dd>
          {{
            channel.flags.permanent
              ? t("info.permanent")
              : channel.flags.semiPermanent
                ? t("info.semiPermanent")
                : t("info.temporary")
          }}
          <template v-if="channel.flags.default"> · {{ t("info.defaultChannel") }}</template>
          <template v-if="channel.flags.password"> · {{ t("info.hasPassword") }}</template>
        </dd>
      </dl>
      <button
        class="act"
        :disabled="channel.id === ts.selfChannel?.id"
        @click="ts.moveTo(channel.id)"
      >
        {{ t("tree.joinChannel") }}
      </button>
    </template>

    <!-- Client -->
    <template v-else-if="client">
      <header class="head">
        <ClientAvatar :avatar="client.avatar" :size="40" />
        <span v-if="countryFlag(client.country)" class="flag-emoji">{{
          countryFlag(client.country)
        }}</span>
        <div class="titles">
          <div class="name">{{ client.nickname }}</div>
          <div class="sub">
            {{ client.isSelf ? t("info.me") : t("info.client")
            }}<template v-if="client.country"> · {{ countryName(client.country) }}</template>
          </div>
        </div>
        <img v-if="iconUrl(client.iconId)" :src="iconUrl(client.iconId)!" class="icon sm" alt="" />
      </header>
      <div v-if="!client.isSelf" class="block vol-block">
        <div class="label">
          {{ t("info.volume", { pct: Math.round(voice.gainFor(client.uid) * 100) }) }}
          <template v-if="voice.autoLevel && meter && meter.autoGainDb">{{
            t("info.autoLevelApplied", {
              db: `${meter.autoGainDb > 0 ? "+" : ""}${meter.autoGainDb}`,
            })
          }}</template>
        </div>
        <input
          type="range"
          min="0"
          max="200"
          step="5"
          class="vol"
          :value="Math.round(voice.gainFor(client.uid) * 100)"
          @input="
            voice.setGain(client.uid, Number(($event.target as HTMLInputElement).value) / 100)
          "
        />
        <div class="meter" :title="t('info.liveLoudness')">
          <div class="meter-fill" :style="{ width: `${meterPct(meter?.rmsDb)}%` }"></div>
          <div
            v-if="meter?.avgDb != null"
            class="meter-avg"
            :style="{ left: `${meterPct(meter.avgDb)}%` }"
            :title="t('info.avgLoudness')"
          ></div>
        </div>
        <div class="meter-labels">
          <span>{{ meter && meter.rmsDb > -180 ? `${meter.rmsDb} dB` : t("info.silent") }}</span>
          <span v-if="meter?.avgDb != null">{{
            t("info.avg30s", { db: Math.round(meter.avgDb) })
          }}</span>
        </div>
        <button
          class="act vol-mute"
          @click="voice.setGain(client.uid, voice.gainFor(client.uid) === 0 ? 1 : 0)"
        >
          {{ voice.gainFor(client.uid) === 0 ? t("info.unmuteLocal") : t("info.muteLocal") }}
        </button>
      </div>
      <div v-if="client.awayMessage" class="block">
        <div class="label">{{ t("info.awayMessage") }}</div>
        <div class="rich">{{ client.awayMessage }}</div>
      </div>
      <div v-if="client.talkRequest" class="block" data-testid="info-talk-request">
        <div class="label">{{ t("info.talkRequest") }}</div>
        <div class="rich">{{ client.talkRequestMessage || t("talk.pending") }}</div>
        <div v-if="clientMenus.canGrantTalk(client)" class="talk-acts">
          <button class="act block-act" @click="clientMenus.run(setTalker(client.id, true))">
            {{ t("talk.grant") }}
          </button>
          <button
            class="act block-act"
            data-testid="info-talk-deny"
            @click="clientMenus.run(denyTalkRequest(client.id))"
          >
            {{ t("mod.talkDeny") }}
          </button>
        </div>
      </div>
      <div
        v-if="client.description || clientMenus.canEditDescription(client)"
        class="block"
        data-testid="info-description"
      >
        <div class="label label-row">
          <span>{{ t("info.clientDescription") }}</span>
          <button
            v-if="clientMenus.canEditDescription(client)"
            class="mini-act"
            :title="t('desc.edit')"
            @click="openClientDialog({ kind: 'description', clientId: client.id })"
          >
            ✏️
          </button>
        </div>
        <div v-if="client.description" class="rich">{{ client.description }}</div>
      </div>
      <dl class="grid">
        <dt>{{ t("info.state") }}</dt>
        <dd>
          <template v-if="client.away">🌙 {{ t("status.awayShort") }}</template>
          <template v-else>{{ t("info.online") }}</template>
          <template v-if="client.inputMuted"> · 🎙️ {{ t("status.mutedShort") }}</template>
          <template v-if="client.outputMuted"> · 🔇 {{ t("info.speakersOff") }}</template>
        </dd>
        <template v-if="clientRaw['client_version']">
          <dt>{{ t("server.version") }}</dt>
          <dd>{{ clientRaw["client_version"] }}</dd>
        </template>
        <template v-if="clientRaw['client_platform']">
          <dt>{{ t("server.platform") }}</dt>
          <dd>{{ clientRaw["client_platform"] }}</dd>
        </template>
        <template v-if="connectedFor">
          <dt>{{ t("info.connectedFor") }}</dt>
          <dd>{{ connectedFor }}</dd>
        </template>
        <template v-if="clientRaw['client_created']">
          <dt>{{ t("info.firstSeen") }}</dt>
          <dd>{{ formatDateTime(num(clientRaw["client_created"])) }}</dd>
        </template>
        <template v-if="clientRaw['client_totalconnections']">
          <dt>{{ t("info.connections") }}</dt>
          <dd>{{ clientRaw["client_totalconnections"] }}</dd>
        </template>
        <template v-if="clientRaw['connection_bytes_sent_total']">
          <dt>{{ t("info.sent") }}</dt>
          <dd>{{ bytes(clientRaw["connection_bytes_sent_total"]) }}</dd>
        </template>
        <template v-if="clientRaw['connection_bytes_received_total']">
          <dt>{{ t("info.received") }}</dt>
          <dd>{{ bytes(clientRaw["connection_bytes_received_total"]) }}</dd>
        </template>
        <dt>{{ t("info.talkPower") }}</dt>
        <dd>{{ client.talkPower }}</dd>
        <dt>{{ t("info.serverGroups") }}</dt>
        <dd>
          {{
            client.serverGroups.map((id) => ts.serverGroups.get(id)?.name ?? `#${id}`).join(", ") ||
            "-"
          }}
        </dd>
        <dt>{{ t("info.channelGroup") }}</dt>
        <dd>
          {{ ts.channelGroups.get(client.channelGroupId)?.name ?? `#${client.channelGroupId}` }}
        </dd>
        <dt>{{ t("info.uid") }}</dt>
        <dd class="mono">{{ client.uid }}</dd>
      </dl>
      <div v-if="client.isSelf" class="row-actions">
        <button class="act" @click="openClientDialog({ kind: 'nickname' })">
          {{ t("nick.change") }}
        </button>
        <button class="act" @click="openClientDialog({ kind: 'away' })">
          {{ t("away.menu") }}
        </button>
      </div>
      <div v-if="!client.isSelf" class="row-actions">
        <button class="act" @click="ts.openConversation(`client:${client.id}`)">
          {{ t("tree.privateChat") }}
        </button>
        <button class="act" @click="ts.requestClientInfo(client.id)">
          {{ t("info.refresh") }}
        </button>
      </div>
    </template>

    <p v-else class="empty">{{ t("info.empty") }}</p>
  </div>
</template>

<style scoped>
.info {
  height: 100%;
  overflow: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  object-fit: contain;
  flex: none;
}
.icon.sm {
  width: 20px;
  height: 20px;
}
.flag-emoji {
  font-size: 26px;
  flex: none;
}
.titles {
  flex: 1;
  min-width: 0;
}
.name {
  font-weight: 600;
  font-size: 15px;
  word-break: break-word;
}
.sub {
  color: var(--text-dim);
  font-size: 12px;
}
.block .label {
  color: var(--text-dim);
  font-size: 12px;
  margin-bottom: 4px;
}
.rich {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  word-break: break-word;
}
.grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 12px;
  margin: 0;
  align-items: baseline;
}
.grid dt {
  color: var(--text-dim);
  font-size: 12px;
  white-space: nowrap;
}
.grid dd {
  margin: 0;
  font-size: 13px;
  word-break: break-word;
}
.mono {
  font-family: ui-monospace, "Consolas", monospace;
  font-size: 11px;
}
.banner {
  display: block;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border);
}
.hostbutton {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.hostbutton a {
  color: var(--accent);
  text-decoration: none;
  overflow-wrap: anywhere;
  min-width: 0;
}
.act {
  padding: 7px 12px;
}
.vol-block {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}
.vol-mute {
  margin-top: 8px;
}
.vol {
  width: 100%;
  padding: 0;
  border: none;
  background: transparent;
}
.meter {
  position: relative;
  height: 8px;
  margin-top: 6px;
  border-radius: 4px;
  background: var(--bg);
  border: 1px solid var(--border);
  overflow: hidden;
}
.meter-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--ok), var(--warn) 75%, var(--danger));
  transition: width 120ms linear;
}
.meter-avg {
  position: absolute;
  top: -1px;
  bottom: -1px;
  width: 2px;
  background: var(--accent);
}
.meter-labels {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-dim);
  margin-top: 3px;
  font-variant-numeric: tabular-nums;
}
.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.mini-act {
  padding: 0 6px;
  border-color: transparent;
  background: transparent;
  font-size: 12px;
}
.mini-act:hover {
  border-color: var(--border);
}
.block-act {
  margin-top: 6px;
}
.talk-acts {
  display: flex;
  gap: 6px;
}
.empty {
  color: var(--text-dim);
  font-size: 13px;
}
:deep(.rich a) {
  color: var(--accent);
}
:deep(.bb-img) {
  max-width: 100%;
  border-radius: 6px;
}
</style>
