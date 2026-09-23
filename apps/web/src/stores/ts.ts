import { computed, reactive, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import type {
  ConnectRequest,
  HubFeatures,
  LogLevel,
  RoomState,
  RoomVideoPublisher,
  ServerMessage,
  TsChannel,
  TsClient,
  TsGroup,
  TsServerInfo,
  UserProfile,
} from "@jinz/protocol";
import { HUB_UNAUTHORIZED, type HubState } from "../ts/connection";
import { useHubAccessStore } from "./hubAccess";
import { useIdentitiesStore } from "./identities";
import { useBookmarksStore } from "./bookmarks";
import { useClientPrefsStore } from "./clientPrefs";
import { hub } from "../ts/hub";
import { assetExpiresAt, clearAssetToken, setAssetToken } from "../ts/asset-token";
import { buildTree } from "../ts/tree";
import { moderationEvent } from "../ts/moderation-events";
import { PAGE_BUILD, pageBuildIsStale } from "../ts/build";
import {
  buildReplayRequest,
  channelPath,
  RETRY_ATTEMPTS,
  RetryScheduler,
  type LiveChannel,
} from "../ts/reconnect";
import { t, translateCode } from "../i18n";
import { BANNED_CODE, describeBanNotice } from "../ts/bans";
import { DescriptionRefresh } from "../ts/description-refresh";
import { createChannelPasswords } from "../ts/channel-passwords";

export type ConnState = "idle" | "connecting" | "connected";

/** Conversation keys: "server", "channel:<cid>", "client:<clid>". */
export type ConversationKey = string;

export interface ChatMessage {
  id: number;
  conversation: ConversationKey;
  at: number;
  fromId: number;
  fromName: string;
  fromUid: string;
  text: string;
  self: boolean;
  /** Our own message, shown greyed out until the server echoes it back. */
  pending?: boolean;
}

export interface SystemEvent {
  id: number;
  at: number;
  text: string;
  kind: "info" | "warn" | "error";
}

export interface LogLine {
  id: number;
  at: number;
  level: LogLevel;
  scope: string;
  message: string;
}

/** The gateway always streams verbose lines; we keep only the newest ones. */
const LOG_LIMIT = 1000;

const PROFILE_KEY = "jinz.ts.profile";

export interface ConnectProfile {
  host: string;
  port: number;
  nickname: string;
  serverPassword: string;
  defaultChannel: string;
  /** Music bot web UI (host, host:port or URL); blank = TeamSpeak host on the default port. */
  musicBot: string;
  /** From a bookmark; never written to the saved profile. */
  defaultChannelPassword?: string;
}

let seq = 1;
/** The document listener is installed once per page, not once per store instance. */
let visibilityBound = false;
const ASSET_REFRESH_MARGIN_MS = 60_000;

export const useTsStore = defineStore("ts", () => {
  const identities = useIdentitiesStore();
  const hubState = ref<HubState>("closed");
  const sessionId = ref("");
  const features = ref<HubFeatures>({ video: false, music: false, rtc: "none", iceServers: [] });
  /** The hub's build as of its latest `hello`; a mismatch means this page is stale. */
  const hubBuild = ref("");
  const pageIsStale = computed(() => pageBuildIsStale(PAGE_BUILD, hubBuild.value));
  const connState = ref<ConnState>("idle");
  const server = shallowRef<TsServerInfo | null>(null);
  const selfId = ref(0);
  const uid = ref("");
  const channels = reactive(new Map<string, TsChannel>());
  const clients = reactive(new Map<number, TsClient>());
  const serverGroups = reactive(new Map<string, TsGroup>());
  const channelGroups = reactive(new Map<string, TsGroup>());
  const messages = ref<ChatMessage[]>([]);
  const events = ref<SystemEvent[]>([]);
  const logs = ref<LogLine[]>([]);
  const showLog = ref(false);
  const logVerbose = ref(localStorage.getItem("jinz.log.verbose") === "1");
  const unread = reactive(new Map<ConversationKey, number>());
  const activeConversation = ref<ConversationKey>("server");
  const talking = reactive(new Set<number>());
  /** Last person who walked into our channel; drives their entry sound. */
  const lastEntry = ref<{ uid: string; nickname: string; at: number } | null>(null);
  const lastError = ref<string | null>(null);
  /** Round-trip to the hub, from the keepalive ping. */
  const latencyMs = ref<number | null>(null);
  /**
   * The connect request to replay when the gateway link comes back, and whether
   * we still want to be connected at all (cleared when the user disconnects or
   * the server rejects us). Together they drive the reconnect banner.
   */
  const lastRequest = shallowRef<ConnectRequest | null>(null);
  const wantConnected = ref(false);
  const reconnecting = computed(() => wantConnected.value && connState.value !== "connected");
  /**
   * Where we actually were when the link dropped. Snapshotted *before* the tree
   * is cleared, because the replayed connect wants a channel path and
   * `resetServerState()` throws the names away.
   */
  const liveChannel = shallowRef<LiveChannel | null>(null);
  /** Channel passwords the server accepted (ts/channel-passwords.ts). */
  const channelPasswords = createChannelPasswords();
  /** Auto-retry progress, for the banner. */
  const retryAttempt = ref(0);
  const retryPending = ref(false);
  const retryMax = RETRY_ATTEMPTS;
  const retry = new RetryScheduler({
    onRetry: () => {
      retryPending.value = false;
      attemptReconnect();
    },
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (id) => window.clearTimeout(id),
  });
  /** Latest profile (icon / entry sound) change; the profiles store folds it in. */
  const profileUpdates = shallowRef<UserProfile | null>(null);
  const descriptions = reactive(new Map<string, string>());
  const clientInfoRaw = reactive(new Map<number, Record<string, string>>());
  const selection = ref<{ kind: "server" | "channel" | "client"; id: string } | null>({
    kind: "server",
    id: "0",
  });
  /** Re-fetches a changed description only while the info panel shows it (description-refresh.ts). */
  const descriptionRefresh = new DescriptionRefresh({
    isShown: (id) => selection.value?.kind === "channel" && selection.value.id === id,
    request: (id) => requestDescription(id),
  });
  const profile = ref<ConnectProfile>(loadProfile());
  const roomState = shallowRef<RoomState | null>(null);
  const publishers = computed(() => {
    const map = new Map<number, RoomVideoPublisher>();
    for (const p of roomState.value?.video.publishers ?? []) map.set(p.clientId, p);
    return map;
  });

  const selfClient = computed(() => clients.get(selfId.value) ?? null);
  const selfChannel = computed(() =>
    selfClient.value ? (channels.get(selfClient.value.channelId) ?? null) : null,
  );
  const tree = computed(() => buildTree(channels.values(), clients.values()));

  hub.onState((state, reason) => {
    hubState.value = state;
    if (state === "connecting") pushLog("info", "gateway", t("event.gatewayConnecting"));
    if (state === "open") {
      pushLog("info", "gateway", t("event.gatewayConnected"));
      // The hub keeps no state for a dropped socket, so a fresh link means a
      // fresh TeamSpeak session. The identity is persisted, so we come back
      // with the same UID.
      if (wantConnected.value && lastRequest.value) {
        pushEvent(t("event.reconnecting"));
        // The "gateway lost" error is history now; let the retry speak for
        // itself instead of leaving a red banner over a working link.
        lastError.value = null;
        connState.value = "connecting";
        hub.send(replayRequest(lastRequest.value));
      }
    }
    if (state === "closed" && reason === HUB_UNAUTHORIZED) {
      // Not a network blip: the hub wants its password again. Go back to the
      // login page instead of redialling.
      wantConnected.value = false;
      clearRetry();
      resetServerState();
      clearAssetToken();
      useHubAccessStore().markLocked();
      return;
    }
    if (state === "closed") {
      const lost = t("event.gatewayLost", { reason: reason ? ` (${reason})` : "" });
      pushLog("warn", "gateway", lost);
      if (connState.value !== "idle") {
        pushEvent(lost, "warn");
        lastError.value = lost;
      }
      // The connection layer redials on its own, so a TeamSpeak-side retry
      // waiting on a dead socket would only burn its budget.
      clearRetry();
      snapshotLiveChannel();
      resetServerState();
      // Tokens are minted per hub session; a new socket brings a new one.
      clearAssetToken();
    }
  });
  hub.onMessage(apply);
  // A laptop that slept past a rotation wakes with a stale token; the hub's
  // next rotation may be minutes away, so ask for one right away.
  if (typeof document !== "undefined" && !visibilityBound) {
    visibilityBound = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      if (hubState.value !== "open") return;
      // Refresh a little early so images requested right now do not 401.
      if (Date.now() < assetExpiresAt() - ASSET_REFRESH_MARGIN_MS) return;
      hub.send({ type: "assetToken.refresh" });
    });
  }
  hub.onLatency((ms) => {
    latencyMs.value = ms;
  });

  function pushEvent(text: string, kind: SystemEvent["kind"] = "info"): void {
    events.value.push({ id: seq++, at: Date.now(), text, kind });
    if (events.value.length > 500) events.value.splice(0, events.value.length - 500);
  }

  function pushLog(level: LogLevel, scope: string, message: string, at = Date.now()): void {
    logs.value.push({ id: seq++, at, level, scope, message });
    if (logs.value.length > LOG_LIMIT) logs.value.splice(0, logs.value.length - LOG_LIMIT);
  }

  function clearLogs(): void {
    logs.value = [];
  }

  /** Verbose only controls what the log console shows; capture is always on. */
  function setLogVerbose(on: boolean): void {
    logVerbose.value = on;
    localStorage.setItem("jinz.log.verbose", on ? "1" : "0");
  }

  function pushMessage(m: Omit<ChatMessage, "id">): number {
    const id = seq++;
    messages.value.push({ id, ...m });
    if (messages.value.length > 2000) messages.value.splice(0, messages.value.length - 2000);
    if (m.conversation !== activeConversation.value && !m.self) {
      unread.set(m.conversation, (unread.get(m.conversation) ?? 0) + 1);
    }
    return id;
  }

  /**
   * Our own messages are shown right away as pending and dropped again once the
   * server echoes them back, so the echo is the one copy that survives. Servers
   * that never echo would leave the grey copy hanging, so it settles by itself
   * after a while instead.
   */
  const PENDING_SETTLE_MS = 10_000;
  const pendingTimers = new Map<number, ReturnType<typeof setTimeout>>();

  function clearPendingTimer(id: number): void {
    const timer = pendingTimers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    pendingTimers.delete(id);
  }

  /** Give up waiting for the echo and keep the local copy as a normal message. */
  function settlePending(id: number): void {
    clearPendingTimer(id);
    const i = messages.value.findIndex((m) => m.id === id);
    const m = i < 0 ? undefined : messages.value[i];
    if (m?.pending) messages.value.splice(i, 1, { ...m, pending: false });
  }

  /** Drop the local copy of `text` once the server's own echo arrives. */
  function dropPending(conversation: ConversationKey, text: string): void {
    const i = messages.value.findIndex(
      (m) => m.pending && m.conversation === conversation && m.text === text,
    );
    const m = i < 0 ? undefined : messages.value[i];
    if (!m) return;
    clearPendingTimer(m.id);
    messages.value.splice(i, 1);
  }

  /**
   * Remember the channel we are in, for the connect we will replay. Must run
   * before `resetServerState()`, which clears the tree this reads.
   */
  function snapshotLiveChannel(): void {
    const id = selfClient.value?.channelId;
    if (!id) return;
    liveChannel.value = {
      path: channelPath(channels, id),
      password: channelPasswords.get(id),
    };
  }

  /** Bounded auto-retry after a TeamSpeak-side drop. */
  function scheduleRetry(): void {
    // Out of budget: stop here and let the banner's Reconnect button take over.
    if (!retry.schedule()) {
      retryPending.value = false;
      return;
    }
    retryAttempt.value = retry.attempt;
    retryPending.value = true;
  }

  /** Drops a pending retry and hands back the full budget. */
  function clearRetry(): void {
    retry.reset();
    retryAttempt.value = 0;
    retryPending.value = false;
  }

  /**
   * The request a reconnect sends: the original, aimed at the channel we were
   * in, with the identity as it is *now*. The user may have raised its level,
   * picked another one or deleted it while the retry was pending; replaying
   * the old key would bring back a weaker (or deleted) identity.
   */
  function replayRequest(req: ConnectRequest): ConnectRequest {
    const replay = buildReplayRequest(req, liveChannel.value);
    channelPasswords.expectJoin(replay.defaultChannelPassword);
    return { ...replay, identity: identities.ensureActive().key };
  }

  /** One replayed connect, aimed at the channel we were in. */
  function attemptReconnect(): void {
    const req = lastRequest.value;
    if (!req || !wantConnected.value) return;
    lastError.value = null;
    connState.value = "connecting";
    pushEvent(t("event.reconnecting"));
    if (hub.state === "open") hub.send(replayRequest(req));
    // A dead link is the connection layer's problem; its "open" handler replays.
    else void hub.open().catch(() => undefined);
  }

  function resetServerState(): void {
    connState.value = "idle";
    server.value = null;
    selfId.value = 0;
    channels.clear();
    clients.clear();
    serverGroups.clear();
    channelGroups.clear();
    talking.clear();
    descriptions.clear();
    descriptionRefresh.cancelAll();
    clientInfoRaw.clear();
    selection.value = { kind: "server", id: "0" };
    roomState.value = null;
    // Client ids are reused per session, so keeping `client:<id>` conversations
    // around would surface an old chat under whoever inherits that id next.
    for (const timer of pendingTimers.values()) clearTimeout(timer);
    pendingTimers.clear();
    messages.value.length = 0;
    unread.clear();
    activeConversation.value = "server";
  }

  function apply(msg: ServerMessage): void {
    switch (msg.type) {
      case "hello":
        features.value = msg.features;
        sessionId.value = msg.sessionId;
        hubBuild.value = msg.build ?? "";
        setAssetToken(msg.assetToken);
        break;
      case "assetToken":
        setAssetToken({ token: msg.token, expiresAt: msg.expiresAt });
        break;
      case "connecting":
        connState.value = "connecting";
        break;
      case "connected":
        selfId.value = msg.selfClientId;
        uid.value = msg.uid;
        server.value = msg.server;
        noteConnected(msg.identity);
        pushEvent(t("event.connectedTo", { server: msg.server.name || profile.value.host }));
        if (msg.server.welcomeMessage) pushEvent(msg.server.welcomeMessage);
        break;
      case "snapshot":
        channels.clear();
        clients.clear();
        serverGroups.clear();
        channelGroups.clear();
        for (const ch of msg.channels) channels.set(ch.id, ch);
        for (const c of msg.clients) clients.set(c.id, c);
        for (const g of msg.serverGroups) serverGroups.set(g.id, g);
        for (const g of msg.channelGroups) channelGroups.set(g.id, g);
        connState.value = "connected";
        clearRetry();
        if (selfChannel.value) {
          channelPasswords.landed(selfChannel.value.id, selfChannel.value.flags.password);
        }
        break;
      case "groups":
        serverGroups.clear();
        channelGroups.clear();
        for (const g of msg.serverGroups) serverGroups.set(g.id, g);
        for (const g of msg.channelGroups) channelGroups.set(g.id, g);
        break;
      case "channel.added":
        channels.set(msg.channel.id, msg.channel);
        break;
      case "channel.updated": {
        const ch = channels.get(msg.channelId);
        if (ch) {
          const { flags, ...rest } = msg.patch;
          Object.assign(ch, rest);
          if (flags) ch.flags = { ...ch.flags, ...flags };
        }
        break;
      }
      case "channel.removed":
        channels.delete(msg.channelId);
        break;
      case "channel.description":
        descriptions.set(msg.channelId, msg.description);
        break;
      case "channel.descriptionChanged":
        // Forgotten, so the next look asks for it; asked again now if it is on screen.
        descriptions.delete(msg.channelId);
        descriptionRefresh.changed(msg.channelId);
        break;
      case "client.entered":
        clients.set(msg.client.id, msg.client);
        if (msg.client.channelId === selfChannel.value?.id && !msg.client.isSelf) {
          pushEvent(t("event.clientEntered", { name: msg.client.nickname }));
          lastEntry.value = {
            uid: msg.client.uid,
            nickname: msg.client.nickname,
            at: Date.now(),
          };
        }
        break;
      case "client.left": {
        const c = clients.get(msg.clientId);
        clients.delete(msg.clientId);
        talking.delete(msg.clientId);
        const kicked = moderationEvent(msg, c, t);
        if (kicked) pushEvent(kicked.text, kicked.kind);
        else if (c && !c.isSelf) {
          if (msg.reasonId === 8) pushEvent(t("event.clientLeftServer", { name: c.nickname }));
          else if (c.channelId === selfChannel.value?.id)
            pushEvent(t("event.clientLeft", { name: c.nickname }));
        }
        break;
      }
      case "client.moved": {
        const c = clients.get(msg.clientId);
        if (!c) break;
        const moderated = moderationEvent(msg, c, t);
        if (moderated) pushEvent(moderated.text, moderated.kind);
        const cameToUs = msg.channelId === selfChannel.value?.id && c.channelId !== msg.channelId;
        c.channelId = msg.channelId;
        if (c.isSelf) channelPasswords.arrived(msg.channelId);
        if (cameToUs && !c.isSelf) {
          lastEntry.value = { uid: c.uid, nickname: c.nickname, at: Date.now() };
        }
        break;
      }
      case "client.updated": {
        const c = clients.get(msg.clientId);
        if (c) Object.assign(c, msg.patch);
        break;
      }
      case "client.info":
        clientInfoRaw.set(msg.clientId, msg.raw);
        break;
      case "text": {
        // TeamSpeak sends no target for channel messages (the hub fills in
        // "0"); they can only be for the channel we are in.
        const conversation =
          msg.targetMode === 3
            ? "server"
            : msg.targetMode === 2
              ? `channel:${selfChannel.value?.id ?? msg.targetId}`
              : `client:${msg.invokerId === selfId.value ? msg.targetId : msg.invokerId}`;
        const self = msg.invokerId === selfId.value;
        if (self) dropPending(conversation, msg.message);
        pushMessage({
          conversation,
          at: msg.at,
          fromId: msg.invokerId,
          fromName: msg.invokerName,
          fromUid: msg.invokerUid,
          text: msg.message,
          self,
        });
        break;
      }
      case "poked":
        pushEvent(t("event.poked", { name: msg.invokerName, message: msg.message }), "warn");
        break;
      case "server.updated":
        if (server.value) server.value = { ...server.value, ...msg.patch };
        break;
      case "log":
        pushLog(msg.level, msg.scope, msg.message, msg.at);
        break;
      case "error": {
        const text =
          msg.code === BANNED_CODE ? describeBanNotice(msg.message, t) : translateCode(msg.message);
        lastError.value = text;
        pushLog("error", msg.code, text);
        pushEvent(`${msg.code}: ${text}`, "error");
        if (msg.fatal) {
          wantConnected.value = false;
          clearRetry();
          snapshotLiveChannel();
          resetServerState();
        }
        break;
      }
      case "disconnected": {
        const why = t("event.disconnected", { reason: translateCode(msg.reason) });
        pushLog("warn", "connect", why);
        pushEvent(why, "warn");
        // A drop we did not ask for leaves `wantConnected` set, so the banner
        // offers a reconnect (and the gateway listener replays the request if
        // the link itself went down).
        if (msg.byUser) {
          wantConnected.value = false;
          clearRetry();
        } else if (wantConnected.value) {
          lastError.value = why;
        }
        // Otherwise a fatal error (kicked, banned) just ended the session:
        // its message says more than "connection lost", so it stays up.
        snapshotLiveChannel();
        resetServerState();
        if (!msg.byUser && wantConnected.value) scheduleRetry();
        break;
      }
      case "room.state":
        roomState.value = msg.state;
        break;
      case "profile.updated":
        profileUpdates.value = msg.profile;
        break;
      default:
        break;
    }
  }

  async function connect(p: ConnectProfile): Promise<void> {
    lastError.value = null;
    profile.value = p;
    // Passwords stay out of the plain-text profile: a bookmark keeps them
    // encrypted, and writing them here would undo that.
    const saved: ConnectProfile = { ...p, serverPassword: "", defaultChannelPassword: undefined };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(saved));
    if (hub.state !== "open") await hub.open();
    connState.value = "connecting";
    const fixed = useHubAccessStore().fixedServer;
    const req: ConnectRequest = {
      type: "connect",
      // A hub with a fixed server picks the address, password and bot itself.
      host: fixed ? undefined : p.host,
      port: fixed ? undefined : p.port,
      nickname: p.nickname,
      identity: identities.ensureActive().key,
      serverPassword: fixed ? undefined : p.serverPassword || undefined,
      defaultChannel: p.defaultChannel || undefined,
      defaultChannelPassword: p.defaultChannelPassword || undefined,
      musicBot: fixed ? undefined : p.musicBot.trim() || undefined,
      subscribeAll: useClientPrefsStore().subscribeAllOnConnect,
    };
    lastRequest.value = req;
    wantConnected.value = true;
    // A new connection is not a reconnection: forget where we used to be.
    liveChannel.value = null;
    channelPasswords.clear();
    channelPasswords.expectJoin(req.defaultChannelPassword);
    clearRetry();
    hub.send(req);
  }

  /** Replays the last connect request; used by the "reconnect" banner action. */
  function reconnect(): void {
    if (!lastRequest.value) return;
    // The user asked for this one, so the auto-retry starts fresh next time.
    clearRetry();
    wantConnected.value = true;
    attemptReconnect();
  }

  function disconnect(): void {
    wantConnected.value = false;
    clearRetry();
    hub.send({ type: "disconnect" });
  }

  function moveTo(channelId: string, password?: string): void {
    channelPasswords.expectMove(channelId, password);
    hub.send({ type: "moveTo", channelId, password });
  }

  /** The known-good password of a channel ("" if none): file commands need it too. */
  function channelPasswordFor(channelId: string): string {
    return channelPasswords.get(channelId);
  }

  function sendText(conversation: ConversationKey, text: string): void {
    const message = text.trim();
    if (!message) return;
    let targetMode: 1 | 2 | 3 = 3;
    let targetId = "0";
    if (conversation.startsWith("channel:")) {
      targetMode = 2;
      targetId = conversation.slice("channel:".length);
    } else if (conversation.startsWith("client:")) {
      targetMode = 1;
      targetId = conversation.slice("client:".length);
    }
    hub.send({ type: "sendText", targetMode, targetId, message });
    // Shown greyed out right away; the server's echo replaces it.
    const id = pushMessage({
      conversation,
      at: Date.now(),
      fromId: selfId.value,
      fromName: selfClient.value?.nickname ?? profile.value.nickname,
      fromUid: uid.value,
      text: message,
      self: true,
      pending: true,
    });
    pendingTimers.set(
      id,
      setTimeout(() => settlePending(id), PENDING_SETTLE_MS),
    );
  }

  function poke(clientId: number, message: string): void {
    hub.send({ type: "poke", clientId, message });
  }

  /**
   * Own mute/away flags are applied locally right away and only confirmed by the
   * server's `client.updated`; waiting for the round trip made muting feel laggy.
   */
  function patchSelf(patch: Partial<TsClient>): void {
    const me = clients.get(selfId.value);
    if (me) Object.assign(me, patch);
  }

  function setInputMuted(muted: boolean): void {
    patchSelf({ inputMuted: muted });
    hub.send({ type: "setInputMuted", muted });
  }

  function setOutputMuted(muted: boolean): void {
    patchSelf({ outputMuted: muted });
    hub.send({ type: "setOutputMuted", muted });
  }

  function setAway(away: boolean, message?: string): void {
    patchSelf({ away });
    hub.send({ type: "setAway", away, message });
  }

  function requestDescription(channelId: string): void {
    hub.send({ type: "getChannelDescription", channelId });
  }

  function requestClientInfo(clientId: number): void {
    hub.send({ type: "getClientInfo", clientId });
  }

  function select(kind: "server" | "channel" | "client", id: string): void {
    selection.value = { kind, id };
    if (kind === "channel" && !descriptions.has(id)) requestDescription(id);
    if (kind === "client") requestClientInfo(Number(id));
  }

  function openConversation(key: ConversationKey): void {
    activeConversation.value = key;
    unread.delete(key);
  }

  /**
   * Keeps the identity the hub used (it may have raised its counter) and, when
   * the user picks servers themselves, remembers this one as a recent connection.
   */
  function noteConnected(hubIdentity: string): void {
    identities.adoptFromHub(hubIdentity);
    if (useHubAccessStore().fixedServer) return;
    const p = profile.value;
    useBookmarksStore().noteConnected({
      host: p.host,
      port: p.port,
      nickname: p.nickname,
      identityId: identities.active?.id ?? null,
      defaultChannel: p.defaultChannel,
      musicBot: p.musicBot,
    });
  }

  if (import.meta.env.DEV) {
    // Console inspection of the live model (dev builds only).
    (window as unknown as { __jinzTs: unknown }).__jinzTs = {
      self: () => selfClient.value,
      clients: () =>
        [...clients.values()].map((c) => ({ id: c.id, nick: c.nickname, ch: c.channelId })),
      channels: () =>
        [...channels.values()].map((ch) => ({ id: ch.id, name: ch.name, parent: ch.parentId })),
      events: () => events.value.slice(-30),
      logs: () => logs.value.slice(-60).map((l) => `${l.scope}: ${l.message}`),
      roomState: () => roomState.value,
      groups: () => ({
        server: [...serverGroups.values()].map((g) => g.name),
        channel: [...channelGroups.values()].map((g) => g.name),
      }),
    };
  }

  return {
    hubState,
    sessionId,
    features,
    pageIsStale,
    connState,
    server,
    selfId,
    uid,
    channels,
    clients,
    serverGroups,
    channelGroups,
    messages,
    events,
    lastEntry,
    profileUpdates,
    logs,
    showLog,
    logVerbose,
    unread,
    activeConversation,
    talking,
    lastError,
    latencyMs,
    reconnecting,
    retryAttempt,
    retryPending,
    retryMax,
    descriptions,
    clientInfoRaw,
    selection,
    profile,
    roomState,
    publishers,
    selfClient,
    selfChannel,
    tree,
    connect,
    reconnect,
    disconnect,
    moveTo,
    channelPasswordFor,
    /** Keeps a password the server just accepted for a file listing or transfer. */
    rememberChannelPassword: channelPasswords.remember,
    /** Drops a known password the server refused (it was changed). */
    forgetChannelPassword: channelPasswords.forget,
    sendText,
    poke,
    setInputMuted,
    setOutputMuted,
    setAway,
    requestDescription,
    requestClientInfo,
    select,
    openConversation,
    clearLogs,
    setLogVerbose,
    pushEvent,
  };
});

function loadProfile(): ConnectProfile {
  const fallback: ConnectProfile = {
    host: "localhost",
    port: 9987,
    nickname: `Web${Math.floor(Math.random() * 900 + 100)}`,
    serverPassword: "",
    defaultChannel: "",
    musicBot: "",
  };
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<ConnectProfile>) };
  } catch {
    return fallback;
  }
}
