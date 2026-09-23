/**
 * Wires the local chat history (`chat/history.ts`) to the live session.
 *
 * It listens to the hub itself rather than hooking into the ts store: it only
 * needs `connected` (to learn which server this is) and `text` (to file the
 * message), and staying out of the store keeps that file untouched. The store
 * registers its listener first, so the ids and tree it reads are current.
 *
 * What a chat panel shows is the stored history of its conversation followed
 * by the live messages of this session. Messages stored during this session
 * are left out of the history part (by record id) so they do not show twice.
 */
import { reactive, ref, shallowRef, watch } from "vue";
import { defineStore } from "pinia";
import type { ServerMessage } from "@jinz/protocol";
import { hub } from "../ts/hub";
import { t } from "../i18n";
import { useTsStore, type ConversationKey } from "./ts";
import { useHubAccessStore } from "./hubAccess";
import { useChatSettingsStore } from "./chatSettings";
import {
  ChatHistory,
  MemoryHistoryBackend,
  historyConversation,
  historyServerKey,
  type HistoryBackend,
  type StoredMessage,
} from "../chat/history";
import { IdbHistoryBackend } from "../chat/history-idb";

function defaultBackend(): HistoryBackend {
  return typeof indexedDB === "undefined" ? new MemoryHistoryBackend() : new IdbHistoryBackend();
}

export const useChatHistoryStore = defineStore("chatHistory", () => {
  const ts = useTsStore();
  const access = useHubAccessStore();
  const prefs = useChatSettingsStore();
  const history = new ChatHistory(defaultBackend());

  /** Which server the history is filed under; empty while not connected. */
  const serverKey = ref("");
  /** Stored messages per live conversation key, oldest first. */
  const loaded = reactive(new Map<ConversationKey, StoredMessage[]>());
  /** Records written in this session; they are on screen as live messages already. */
  const sessionIds = reactive(new Set<number>());
  /** Live messages up to this id were cleared from view by "clear history". */
  const clearedThrough = reactive(new Map<ConversationKey, number>());
  /** Private chats stay filed under their partner after the partner leaves. */
  const uidByClient = new Map<number, string>();
  const failed = shallowRef(false);

  function reportFailure(err: unknown): void {
    console.warn("chat history:", err);
    if (failed.value) return;
    failed.value = true;
    ts.pushEvent(t("chat.historyUnavailable"), "warn");
  }

  function uidOf(clid: number): string | undefined {
    const uid = ts.clients.get(clid)?.uid || uidByClient.get(clid);
    if (uid) uidByClient.set(clid, uid);
    return uid;
  }

  function onConnected(msg: Extract<ServerMessage, { type: "connected" }>): void {
    serverKey.value = historyServerKey(msg.server, {
      host: ts.profile.host,
      port: ts.profile.port,
      fixed: access.fixedServer,
    });
    loaded.clear();
    sessionIds.clear();
    clearedThrough.clear();
    uidByClient.clear();
    if (prefs.settings.historyEnabled) {
      history.prune(prefs.settings.retentionDays).catch(reportFailure);
    }
  }

  /** Mirrors how the ts store files the message. */
  function onText(msg: Extract<ServerMessage, { type: "text" }>): void {
    if (!serverKey.value || !prefs.settings.historyEnabled) return;
    const self = msg.invokerId === ts.selfId;
    let conversation: string | null;
    if (msg.targetMode === 3) conversation = "server";
    else if (msg.targetMode === 2) conversation = `channel:${ts.selfChannel?.id ?? msg.targetId}`;
    else if (!self) {
      if (msg.invokerUid) uidByClient.set(msg.invokerId, msg.invokerUid);
      conversation = msg.invokerUid ? `uid:${msg.invokerUid}` : null;
    } else conversation = historyConversation(`client:${msg.targetId}`, uidOf);
    if (!conversation) return;
    const server = serverKey.value;
    history
      .append({
        server,
        conversation,
        at: msg.at,
        fromName: msg.invokerName,
        fromUid: msg.invokerUid,
        text: msg.message,
        self,
      })
      .then((id) => {
        if (server === serverKey.value) sessionIds.add(id);
      })
      .catch(reportFailure);
  }

  hub.onMessage((msg) => {
    if (msg.type === "connected") onConnected(msg);
    else if (msg.type === "text") onText(msg);
  });

  /** Loads a conversation's history once per session (again after a clear or reconnect). */
  async function ensureLoaded(liveKey: ConversationKey): Promise<void> {
    if (!serverKey.value || !prefs.settings.historyEnabled || loaded.has(liveKey)) return;
    const conversation = historyConversation(liveKey, uidOf);
    if (!conversation) return;
    const server = serverKey.value;
    // Claim the slot now so concurrent callers do not load twice.
    loaded.set(liveKey, []);
    try {
      const rows = await history.load(server, conversation, prefs.settings.retentionDays);
      if (server === serverKey.value) loaded.set(liveKey, rows);
    } catch (err) {
      loaded.delete(liveKey);
      reportFailure(err);
    }
  }

  /** Stored messages for a panel, minus the ones this session shows live. */
  function historyFor(liveKey: ConversationKey): StoredMessage[] {
    const rows = loaded.get(liveKey) ?? [];
    return rows.filter((m) => m.id === undefined || !sessionIds.has(m.id));
  }

  async function clearConversation(liveKey: ConversationKey): Promise<void> {
    const live = ts.messages.filter((m) => m.conversation === liveKey);
    clearedThrough.set(liveKey, live.length ? live[live.length - 1]!.id : 0);
    loaded.set(liveKey, []);
    const conversation = historyConversation(liveKey, uidOf);
    if (!serverKey.value || !conversation) return;
    await history.clearConversation(serverKey.value, conversation).catch(reportFailure);
  }

  async function clearAll(): Promise<void> {
    for (const key of loaded.keys()) loaded.set(key, []);
    await history.clearAll().catch(reportFailure);
  }

  // Turning history off hides it at once; turning it back on reloads on demand.
  watch(
    () => prefs.settings.historyEnabled,
    (on) => {
      if (!on) loaded.clear();
    },
  );

  return {
    serverKey,
    clearedThrough,
    ensureLoaded,
    historyFor,
    clearConversation,
    clearAll,
  };
});
