<script setup lang="ts">
import { computed, ref } from "vue";
import type { TsChannel, TsClient } from "@jinz/protocol";
import { isOpusCodec } from "@jinz/protocol";
import { useTsStore } from "../stores/ts";
import { useVoiceStore } from "../stores/voice";
import { useProfilesStore } from "../stores/profiles";
import { useRtcStore } from "../stores/rtc";
import { useContextMenu, type MenuAnchorEvent, type MenuItem } from "../stores/contextMenu";
import type { ChannelNode } from "../ts/tree";
import { displayChannelName, parseSpacer, spacerFill, type Spacer } from "../ts/format";
import { builtinIcon, countryFlag, countryName, iconUrl } from "../ts/assets";
import type { TsGroup } from "@jinz/protocol";
import TextPromptDialog from "./TextPromptDialog.vue";
import { useI18n } from "../i18n";
import { useLongPress } from "../mobile/useLongPress";
import ClientAvatar from "./client/ClientAvatar.vue";
import { useClientMenus } from "./client/useClientMenus";
import { useClientDrag } from "./client/useClientDrag";
import { useClientPrefsStore } from "../stores/clientPrefs";
import { isChannelVisible } from "../ts/client-features";
import { useChannelDrag } from "./channels/useChannelDrag";

/** TeamSpeak caps poke messages at 100 characters. */
const POKE_MAX_LENGTH = 100;
/**
 * Where a user row starts, before depth. A channel row puts its name at 30px
 * (8px padding, 16px caret, 6px gap); users sit one step further in, so they
 * read as the channel's contents rather than as another channel.
 */
const CLIENT_INDENT = 44;

/** Groups shown as badges next to a nickname: server groups (by sortid) then channel group. */
function clientGroups(c: TsClient): TsGroup[] {
  const out: TsGroup[] = [];
  for (const id of c.serverGroups) {
    const g = ts.serverGroups.get(id);
    if (g && g.type === 1) out.push(g);
  }
  out.sort((a, b) => a.sortId - b.sortId || Number(a.id) - Number(b.id));
  const cg = ts.channelGroups.get(c.channelGroupId);
  if (cg && cg.type === 1) out.push(cg);
  return out;
}

const ts = useTsStore();
const voice = useVoiceStore();
const profiles = useProfilesStore();
const { t } = useI18n();
const rtc = useRtcStore();
const ctx = useContextMenu();
const clientMenus = useClientMenus();
const clientPrefs = useClientPrefsStore();
const channelDrag = useChannelDrag();
/**
 * Touch devices never fire `contextmenu`, so a held finger opens the same menus
 * the right button does on the desktop. `longPress(fn)` returns the touch
 * handlers for one row; spread them with `v-on`.
 */
const longPress = useLongPress();
const drag = useClientDrag({ join: joinChannel, run: clientMenus.run });
const collapsed = ref(new Set<string>());
const passwordPrompt = ref<{ channel: TsChannel; value: string } | null>(null);
const pokePrompt = ref<{ client: TsClient; value: string } | null>(null);

const sel = computed(() => ts.selection);

function toggle(id: string): void {
  const next = new Set(collapsed.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsed.value = next;
}

function joinChannel(channel: TsChannel): void {
  if (channel.id === ts.selfChannel?.id) return;
  if (channel.flags.password) {
    passwordPrompt.value = { channel, value: "" };
    return;
  }
  ts.moveTo(channel.id);
}

function setPasswordValue(value: string): void {
  if (!passwordPrompt.value) return;
  passwordPrompt.value = { ...passwordPrompt.value, value };
}

function submitPassword(): void {
  if (!passwordPrompt.value) return;
  ts.moveTo(passwordPrompt.value.channel.id, passwordPrompt.value.value);
  passwordPrompt.value = null;
}

function pokeClient(c: TsClient): void {
  pokePrompt.value = { client: c, value: t("tree.pokeDefault") };
}

function setPokeValue(value: string): void {
  if (!pokePrompt.value) return;
  pokePrompt.value = { ...pokePrompt.value, value };
}

function submitPoke(): void {
  if (!pokePrompt.value) return;
  const { client, value } = pokePrompt.value;
  const msg = value.trim();
  if (msg) ts.poke(client.id, msg);
  pokePrompt.value = null;
}

function clientIcon(c: TsClient): string {
  if (c.away) return "🌙";
  if (c.outputMuted) return "🔇";
  if (c.inputMuted || !c.inputHardware) return "🎙️";
  if (isWhispering(c)) return "🟣";
  if (ts.talking.has(c.id)) return "🟢";
  return "⚪";
}

/**
 * Talking, and what we hear of it is a whisper (to us, or ours to others):
 * TeamSpeak's second speaking style, so a whisper is never mistaken for
 * something the whole channel heard.
 */
function isWhispering(c: TsClient): boolean {
  return ts.talking.has(c.id) && voice.whispering.has(c.id);
}

function channelBadge(ch: TsChannel): string {
  const parts: string[] = [];
  if (ch.flags.password) parts.push("🔒");
  if (!isOpusCodec(ch.codec)) parts.push("⚠︎");
  return parts.join(" ");
}

function spacerOf(ch: TsChannel): Spacer | null {
  return parseSpacer(ch.name, ch.parentId);
}

/** What a channel row shows: a repeat-spacer's pattern is repeated to fill the row. */
function channelLabel(ch: TsChannel): string {
  const spacer = spacerOf(ch);
  if (spacer?.align === "repeat") return spacerFill(spacer.text);
  return displayChannelName(ch.name, ch.parentId);
}

function spacerClass(ch: TsChannel): string {
  const spacer = spacerOf(ch);
  return spacer ? `spacer spacer-${spacer.align}` : "";
}

function channelTitle(ch: TsChannel): string {
  const lines = [ch.name];
  if (ch.topic) lines.push(ch.topic);
  if (!isChannelVisible(ch, ts.selfChannel?.id)) lines.push(t("sub.unsubscribed"));
  return lines.join("\n");
}

/** Nickname, then what others left for us to read: away message, talk request. */
function clientTitle(c: TsClient): string {
  const lines = [c.awayMessage ? `${c.nickname} — ${c.awayMessage}` : c.nickname];
  if (isWhispering(c)) lines.push(t("whisper.treeHint"));
  if (c.talkRequest) {
    lines.push(
      c.talkRequestMessage
        ? t("talk.pendingWith", { msg: c.talkRequestMessage })
        : t("talk.pending"),
    );
  }
  return lines.join("\n");
}

function visible(nodes: ChannelNode[]): ChannelNode[] {
  const out: ChannelNode[] = [];
  const walk = (list: ChannelNode[]) => {
    for (const n of list) {
      out.push(n);
      if (!collapsed.value.has(n.channel.id)) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/* ------------------------------ context menus ------------------------------ */

function serverMenu(ev: MenuAnchorEvent): void {
  const items: MenuItem[] = [
    { label: t("tree.serverInfo"), icon: "ℹ️", action: () => ts.select("server", "0") },
    { label: t("tree.serverChat"), icon: "💬", action: () => ts.openConversation("server") },
    { separator: true },
    { label: t("tree.expandAll"), icon: "▾", action: () => (collapsed.value = new Set()) },
    { label: t("tree.collapseAll"), icon: "▸", action: collapseAll },
    { separator: true },
    ...clientMenus.serverItems(),
  ];
  ctx.show(ev, items, ts.server?.name || t("tree.server"));
}

function channelMenu(ev: MenuAnchorEvent, ch: TsChannel): void {
  const isCurrent = ch.id === ts.selfChannel?.id;
  const items: MenuItem[] = [
    {
      label: t("tree.joinChannel"),
      icon: "➡️",
      disabled: isCurrent,
      action: () => joinChannel(ch),
    },
    { label: t("tree.channelInfo"), icon: "ℹ️", action: () => ts.select("channel", ch.id) },
    {
      label: t("tree.channelChat"),
      icon: "💬",
      action: () => ts.openConversation(`channel:${ch.id}`),
    },
    ...clientMenus.channelItems(ch),
  ];
  ctx.show(ev, items, ch.name);
}

function clientMenu(ev: MenuAnchorEvent, c: TsClient): void {
  const muted = voice.gainFor(c.uid) === 0;
  const pub = ts.publishers.get(c.id);
  const videoItems: MenuItem[] = [];
  if (!c.isSelf && pub?.screen) {
    videoItems.push({ label: t("tree.watchScreen"), icon: "🖥️", action: () => rtc.watch(c.id) });
  }
  if (!c.isSelf && pub?.camera) {
    videoItems.push({ label: t("tree.watchCamera"), icon: "📷", action: () => rtc.watch(c.id) });
  }
  if (videoItems.length) videoItems.push({ separator: true });
  const items: MenuItem[] = c.isSelf
    ? [
        {
          label: t("tree.clientInfo"),
          icon: "ℹ️",
          action: () => ts.select("client", String(c.id)),
        },
        {
          label: ts.selfClient?.inputMuted ? t("tree.unmuteMic") : t("tree.muteMic"),
          icon: "🎙️",
          action: () => ts.setInputMuted(!(ts.selfClient?.inputMuted ?? false)),
        },
        ...clientMenus.selfItems(),
        ...(rtc.available
          ? [
              { separator: true } as MenuItem,
              {
                label: rtc.screenOn ? t("status.stopShare") : t("tree.shareScreen"),
                icon: "🖥️",
                action: () => rtc.toggleScreen(),
              },
              {
                label: rtc.cameraOn ? t("tree.cameraOff") : t("tree.cameraStart"),
                icon: "📷",
                disabled: rtc.state !== "connected",
                action: () => rtc.toggleCamera(),
              },
            ]
          : []),
      ]
    : [
        ...videoItems,
        {
          label: t("tree.clientInfo"),
          icon: "ℹ️",
          action: () => ts.select("client", String(c.id)),
        },
        {
          label: t("tree.privateChat"),
          icon: "💬",
          action: () => ts.openConversation(`client:${c.id}`),
        },
        { label: t("tree.poke"), icon: "👉", action: () => pokeClient(c) },
        { separator: true },
        {
          label: t("tree.adjustVolume"),
          icon: "🔊",
          action: () => ts.select("client", String(c.id)),
        },
        {
          label: muted ? t("tree.unmuteLocal") : t("tree.muteLocal"),
          icon: muted ? "🔈" : "🔇",
          action: () => voice.setGain(c.uid, muted ? 1 : 0),
        },
        ...clientMenus.clientItems(c),
      ];
  ctx.show(ev, items, c.nickname);
}

function collapseAll(): void {
  const all = new Set<string>();
  for (const ch of ts.channels.values()) all.add(ch.id);
  collapsed.value = all;
}
</script>

<template>
  <div class="tree" @contextmenu.prevent>
    <div
      class="server-row"
      :class="[{ selected: sel?.kind === 'server' }, channelDrag.rowClass(null)]"
      v-bind="channelDrag.serverEvents()"
      @click="ts.select('server', '0')"
      @contextmenu="serverMenu"
      v-on="longPress(serverMenu)"
    >
      <img
        v-if="iconUrl(ts.server?.iconId)"
        :src="iconUrl(ts.server?.iconId)!"
        class="srv-icon"
        alt=""
      />
      <span v-else class="server-icon">🖥️</span>
      <span class="server-name" :title="ts.server?.version">{{
        ts.server?.name || t("tree.server")
      }}</span>
      <button class="mini" :title="t('tree.serverInfo')" @click.stop="ts.select('server', '0')">
        ℹ️
      </button>
      <button
        class="mini"
        :title="t('tree.serverChat')"
        @click.stop="ts.openConversation('server')"
      >
        💬
      </button>
    </div>

    <template v-for="node in visible(ts.tree)" :key="node.channel.id">
      <div
        class="channel"
        :class="[
          {
            current: node.channel.id === ts.selfChannel?.id,
            selected: sel?.kind === 'channel' && sel.id === node.channel.id,
            unsubscribed:
              !spacerOf(node.channel) && !isChannelVisible(node.channel, ts.selfChannel?.id),
            'drop-target': drag.dropTarget.value === node.channel.id,
          },
          spacerClass(node.channel),
          channelDrag.rowClass(node.channel.id),
        ]"
        v-bind="
          channelDrag.rowEvents(
            node.channel,
            !!node.children.length && !collapsed.has(node.channel.id),
          )
        "
        :style="{ paddingLeft: `${8 + node.depth * 14}px` }"
        :title="channelTitle(node.channel)"
        @click="ts.select('channel', node.channel.id)"
        @dblclick="joinChannel(node.channel)"
        @contextmenu="channelMenu($event, node.channel)"
        v-on="longPress((e) => channelMenu(e, node.channel))"
        @dragover="drag.onDragOver($event, node.channel)"
        @dragleave="drag.onDragLeave($event, node.channel)"
        @drop="drag.onDrop($event, node.channel)"
      >
        <button v-if="node.children.length" class="caret" @click.stop="toggle(node.channel.id)">
          {{ collapsed.has(node.channel.id) ? "▸" : "▾" }}
        </button>
        <span v-else class="caret placeholder"></span>
        <img
          v-if="iconUrl(node.channel.iconId)"
          :src="iconUrl(node.channel.iconId)!"
          class="ch-icon"
          alt=""
        />
        <span class="channel-name">{{ channelLabel(node.channel) }}</span>
        <span class="badge">{{ channelBadge(node.channel) }}</span>
        <span v-if="node.clients.length" class="count">{{ node.clients.length }}</span>
        <span v-if="ts.unread.get(`channel:${node.channel.id}`)" class="unread">
          {{ ts.unread.get(`channel:${node.channel.id}`) }}
        </span>
      </div>
      <div
        v-for="c in node.clients"
        :key="`c${c.id}`"
        class="client"
        :class="{
          self: c.isSelf,
          talking: ts.talking.has(c.id),
          whispering: isWhispering(c),
          selected: sel?.kind === 'client' && sel.id === String(c.id),
        }"
        :style="{ paddingLeft: `${CLIENT_INDENT + node.depth * 14}px` }"
        :title="clientTitle(c)"
        v-bind="channelDrag.otherRowEvents()"
        :draggable="drag.canDrag(c)"
        @dragstart="drag.onDragStart($event, c)"
        @dragend="drag.onDragEnd()"
        @click="ts.select('client', String(c.id))"
        @dblclick="!c.isSelf && ts.openConversation(`client:${c.id}`)"
        @contextmenu="clientMenu($event, c)"
        v-on="longPress((e) => clientMenu(e, c))"
      >
        <span class="status">{{ clientIcon(c) }}</span>
        <ClientAvatar v-if="clientPrefs.showTreeAvatars" :avatar="c.avatar" :size="16" />
        <img
          v-if="profiles.iconUrl(c.uid)"
          :src="profiles.iconUrl(c.uid)!"
          class="me-icon"
          alt=""
        />
        <span v-if="countryFlag(c.country)" class="country" :title="countryName(c.country)">{{
          countryFlag(c.country)
        }}</span>
        <span class="nick" :class="{ localmuted: voice.gainFor(c.uid) === 0 }">{{
          c.nickname
        }}</span>
        <template v-for="g in clientGroups(c)" :key="`g${g.id}`">
          <img
            v-if="iconUrl(g.iconId)"
            :src="iconUrl(g.iconId)!"
            class="grp-icon"
            :title="g.name"
            alt=""
          />
          <span v-else-if="builtinIcon(g.iconId)" class="grp-glyph" :title="g.name">{{
            builtinIcon(g.iconId)!.glyph
          }}</span>
        </template>
        <img
          v-if="iconUrl(c.iconId)"
          :src="iconUrl(c.iconId)!"
          class="cl-icon"
          alt=""
          :title="t('tree.clientIcon')"
        />
        <span
          v-if="c.talkRequest"
          class="flag talk-request"
          data-testid="talk-request-marker"
          :title="
            c.talkRequestMessage
              ? t('talk.pendingWith', { msg: c.talkRequestMessage })
              : t('talk.pending')
          "
          >✋</span
        >
        <span v-if="c.isChannelCommander" class="flag" :title="t('tree.commander')">★</span>
        <span v-if="c.isPrioritySpeaker" class="flag" :title="t('tree.prioritySpeaker')">⚡</span>
        <span v-if="c.isRecording" class="flag rec" :title="t('tree.recording')">●</span>
        <span
          v-if="ts.publishers.get(c.id)?.camera"
          class="flag video"
          :title="c.isSelf ? t('tree.cameraOn') : t('tree.cameraWatch')"
          @click.stop="c.isSelf || rtc.watch(c.id)"
          >📷</span
        >
        <span
          v-if="ts.publishers.get(c.id)?.screen"
          class="flag video"
          :title="c.isSelf ? t('tree.screenOn') : t('tree.screenWatch')"
          @click.stop="c.isSelf || rtc.watch(c.id)"
          >🖥️</span
        >
        <span v-if="ts.unread.get(`client:${c.id}`)" class="unread">{{
          ts.unread.get(`client:${c.id}`)
        }}</span>
      </div>
    </template>

    <TextPromptDialog
      v-if="passwordPrompt"
      :title="t('tree.channelPassword')"
      :subtitle="passwordPrompt.channel.name"
      :model-value="passwordPrompt.value"
      type="password"
      :submit-label="t('tree.join')"
      :cancel-label="t('tree.cancel')"
      @update:model-value="setPasswordValue"
      @submit="submitPassword"
      @cancel="passwordPrompt = null"
    />

    <TextPromptDialog
      v-if="pokePrompt"
      :title="t('tree.pokePrompt', { name: pokePrompt.client.nickname })"
      :model-value="pokePrompt.value"
      :submit-label="t('tree.poke')"
      :cancel-label="t('tree.cancel')"
      :maxlength="POKE_MAX_LENGTH"
      @update:model-value="setPokeValue"
      @submit="submitPoke"
      @cancel="pokePrompt = null"
    />
  </div>
</template>

<style scoped>
.tree {
  height: 100%;
  overflow: auto;
  padding: 6px 0;
  user-select: none;
  position: relative;
  display: flex;
  flex-direction: column;
}
.server-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-weight: 600;
  cursor: pointer;
}
.server-row:hover {
  background: var(--bg-elev-2);
}
.srv-icon {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  object-fit: contain;
}
.ch-icon {
  width: 16px;
  height: 16px;
  object-fit: contain;
  flex: none;
}
.me-icon {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  object-fit: cover;
  flex: none;
}
.cl-icon {
  width: 14px;
  height: 14px;
  object-fit: contain;
  flex: none;
}
.country {
  font-size: 12px;
  flex: none;
}
.grp-icon {
  width: 14px;
  height: 14px;
  object-fit: contain;
  flex: none;
}
.grp-glyph {
  font-size: 11px;
  flex: none;
  line-height: 1;
}
.mini {
  padding: 2px 6px;
  border-radius: 6px;
  background: transparent;
  border-color: transparent;
}
.mini:hover {
  background: var(--bg-elev-2);
}
.channel,
.client {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding-right: 8px;
  border-radius: 6px;
  margin: 0 6px;
  cursor: pointer;
  white-space: nowrap;
}
.channel:hover,
.client:hover {
  background: var(--bg-elev-2);
}
.channel.current {
  background: rgba(79, 140, 255, 0.12);
}
/* A dragged client would land here. */
.channel.drop-target {
  outline: 1px dashed var(--accent);
  background: rgba(79, 140, 255, 0.2);
}
.channel.selected,
.client.selected {
  outline: 1px solid var(--accent);
  background: rgba(79, 140, 255, 0.16);
}
.channel.spacer {
  color: var(--text-dim);
  font-size: 12px;
  justify-content: center;
  pointer-events: none;
}
/* The name span fills the row, so the spacer's alignment is its text's. */
.channel.spacer-left .channel-name {
  text-align: left;
}
.channel.spacer-center .channel-name {
  text-align: center;
}
.channel.spacer-right .channel-name {
  text-align: right;
}
.channel.spacer-repeat .channel-name {
  text-overflow: clip;
  white-space: pre;
}
.channel.spacer .caret,
.channel.spacer .badge,
.channel.spacer .count {
  display: none;
}
.caret {
  width: 16px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-dim);
  text-align: center;
}
.caret.placeholder {
  display: inline-block;
}
.channel-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}
.badge {
  color: var(--text-dim);
  font-size: 12px;
}
.count {
  font-size: 11px;
  color: var(--text-dim);
  background: var(--bg-elev-2);
  padding: 0 6px;
  border-radius: 8px;
}
.unread {
  font-size: 11px;
  color: white;
  background: var(--accent);
  padding: 0 6px;
  border-radius: 8px;
}
.client {
  height: 24px;
}
.client.self .nick {
  color: var(--accent);
  font-weight: 600;
}
.client.talking .nick {
  color: var(--ok);
}
.client.whispering .nick {
  color: var(--accent);
  font-style: italic;
}
.status {
  width: 16px;
  font-size: 11px;
  text-align: center;
}
.nick {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nick.localmuted {
  text-decoration: line-through;
  color: var(--text-dim);
}
.flag {
  font-size: 11px;
  color: var(--warn);
}
.flag.rec {
  color: var(--danger);
}
.flag.video {
  font-size: 10px;
}
.flag.talk-request {
  color: var(--accent);
}
/* We do not see who is in there (see isChannelVisible), so it reads as greyed out. */
.channel.unsubscribed .channel-name,
.channel.unsubscribed .ch-icon {
  opacity: 0.5;
}
.channel.unsubscribed .channel-name {
  font-style: italic;
}
/* Channel drag-and-drop (useChannelDrag): where the dragged channel would land. */
.channel.ch-dragging {
  opacity: 0.5;
}
.channel.ch-drop-before {
  box-shadow: inset 0 2px 0 var(--accent);
}
.channel.ch-drop-after {
  box-shadow: inset 0 -2px 0 var(--accent);
}
.channel.ch-drop-inside,
.server-row.ch-drop-inside {
  outline: 1px dashed var(--accent);
  background: rgba(79, 140, 255, 0.16);
}
</style>
