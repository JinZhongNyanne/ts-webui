/**
 * Which sound-pack events a hub message (or a change of our own flags) stands
 * for. Pure: the notify store feeds it a snapshot of the server model and acts
 * on what comes back.
 *
 * The snapshot has to be the model as it was *before* the message: the ts store
 * applies each message first (its listener is registered first), and by then a
 * departed client is gone and a moved one already sits in its new channel. So
 * the notify store keeps its own copy, refreshed after every message.
 */
import { decodeTextCode, type ServerMessage } from "@jinz/protocol";
import type { CueEvent } from "./events";

export interface ClientLite {
  channelId: string;
  nickname: string;
  uid: string;
  isSelf: boolean;
}

export interface CueContext {
  selfId: number;
  /** Our channel, or null while not in one. */
  selfChannelId: string | null;
  /** Fully connected (snapshot received), as opposed to idle or still handshaking. */
  connected: boolean;
  clients: ReadonlyMap<number, ClientLite>;
}

export interface Cue {
  event: CueEvent;
  /** Who caused it, for the notification text. */
  name?: string;
  /** Their TeamSpeak UID; the join cue checks it for a custom entry sound. */
  uid?: string;
  /** Message or poke text. */
  text?: string;
  /** The chat a message belongs to, so a notification click can open it. */
  conversation?: string;
}

export const EMPTY_CONTEXT: CueContext = {
  selfId: 0,
  selfChannelId: null,
  connected: false,
  clients: new Map(),
};

/** TeamSpeak `reasonid` values (see the ts3 client-query docs). */
export const REASON = {
  selfMove: 0,
  movedByOther: 1,
  timeout: 3,
  channelKick: 4,
  serverKick: 5,
  ban: 6,
  leftServer: 8,
} as const;

/**
 * Reasons that mean the client is gone from the server. Anything else (0, a
 * move into a channel we don't see or an unsubscribe) only drops them from view.
 */
const SERVER_DEPARTURES: ReadonlySet<number> = new Set([
  REASON.timeout,
  REASON.serverKick,
  REASON.ban,
  REASON.leftServer,
]);

/** Hub error code for "the server kicked us". */
const KICKED_CODE = "kicked";
/** Hub error code for "the server banned us" (the hub's ban-notice.ts). */
const BANNED_CODE = "banned";

export function cuesForMessage(msg: ServerMessage, before: CueContext): Cue[] {
  switch (msg.type) {
    case "connected":
      return [{ event: "connected" }];
    case "disconnected":
      // Only a session that was up can be lost; a failed attempt has its own error.
      if (!before.connected) return [];
      return [{ event: msg.byUser ? "disconnected" : "connectionLost" }];
    case "error":
      if (!before.connected) return [];
      if (msg.code === KICKED_CODE) return [{ event: "kickedFromServer", text: msg.message }];
      if (msg.code === BANNED_CODE) return [bannedCue(msg.message)];
      return [];
    case "poked":
      return [{ event: "poked", name: msg.invokerName, text: msg.message }];
    case "text":
      return textCue(msg, before);
    case "client.entered": {
      const c = msg.client;
      if (c.isSelf || c.id === before.selfId) return [];
      if (before.selfChannelId !== null && c.channelId === before.selfChannelId) {
        return [{ event: "channelUserJoined", name: c.nickname, uid: c.uid }];
      }
      // Subscribing to a channel brings its users into view all at once.
      if (msg.joinedServer === false) return [];
      return [{ event: "serverUserJoined", name: c.nickname, uid: c.uid }];
    }
    case "client.left": {
      const c = before.clients.get(msg.clientId);
      if (!c || c.isSelf || msg.clientId === before.selfId) return [];
      if (before.selfChannelId !== null && c.channelId === before.selfChannelId) {
        return [{ event: "channelUserLeft", name: c.nickname, uid: c.uid }];
      }
      // Unsubscribing drops a whole channel from view; that is not a goodbye.
      if (!SERVER_DEPARTURES.has(msg.reasonId)) return [];
      return [{ event: "serverUserLeft", name: c.nickname, uid: c.uid }];
    }
    case "client.moved":
      return movedCue(msg, before);
    default:
      return [];
  }
}

/**
 * The ban notice is a text code (who, reason, seconds) that the ts store words;
 * the notification only needs who and why, so it takes them straight out.
 */
function bannedCue(code: string): Cue {
  const params = decodeTextCode(code).params ?? {};
  const name = params["name"]?.trim();
  const text = params["reason"]?.trim();
  return { event: "banned", ...(name ? { name } : {}), ...(text ? { text } : {}) };
}

function textCue(msg: Extract<ServerMessage, { type: "text" }>, before: CueContext): Cue[] {
  if (msg.invokerId === before.selfId) return [];
  const base = { name: msg.invokerName, uid: msg.invokerUid, text: msg.message };
  if (msg.targetMode === 1) {
    return [{ event: "privateMessage", conversation: `client:${msg.invokerId}`, ...base }];
  }
  if (msg.targetMode === 2) {
    const conversation = `channel:${before.selfChannelId ?? msg.targetId}`;
    return [{ event: "channelMessage", conversation, ...base }];
  }
  return [{ event: "serverMessage", conversation: "server", ...base }];
}

function movedCue(
  msg: Extract<ServerMessage, { type: "client.moved" }>,
  before: CueContext,
): Cue[] {
  if (msg.clientId === before.selfId) {
    // Moving ourselves is not news; being moved or kicked by someone is.
    const name = msg.invokerName;
    if (msg.reasonId === REASON.channelKick) return [{ event: "kickedFromChannel", name }];
    if (msg.reasonId === REASON.movedByOther) return [{ event: "movedByOther", name }];
    return [];
  }
  const c = before.clients.get(msg.clientId);
  const mine = before.selfChannelId;
  if (!c || c.isSelf || mine === null) return [];
  if (msg.channelId === mine && c.channelId !== mine) {
    return [{ event: "channelUserJoined", name: c.nickname, uid: c.uid }];
  }
  if (c.channelId === mine && msg.channelId !== mine) {
    return [{ event: "channelUserLeft", name: c.nickname, uid: c.uid }];
  }
  return [];
}

/** Our own client's flags, as the self-toggle cues see them. */
export interface SelfFlags {
  clientId: number;
  channelId: string;
  inputMuted: boolean;
  outputMuted: boolean;
  away: boolean;
  /** Allowed to speak in the current channel (talk power or granted talker). */
  canTalk: boolean;
}

/** TS3 rule: a talker flag or enough talk power for the channel. */
export function canTalk(talkPower: number, isTalker: boolean, neededTalkPower: number): boolean {
  return isTalker || talkPower >= neededTalkPower;
}

/**
 * Cues for a change of our own flags. Nothing fires across a (re)connect or a
 * fresh session — a snapshot arriving with the mic already muted is not the
 * user pressing mute — and talk power only counts within the same channel,
 * since walking into a moderated channel is not having talk power revoked.
 */
export function selfFlagCues(prev: SelfFlags | null, next: SelfFlags | null): Cue[] {
  if (!prev || !next || prev.clientId !== next.clientId) return [];
  const out: Cue[] = [];
  if (prev.inputMuted !== next.inputMuted) {
    out.push({ event: next.inputMuted ? "micMuted" : "micUnmuted" });
  }
  if (prev.outputMuted !== next.outputMuted) {
    out.push({ event: next.outputMuted ? "speakersMuted" : "speakersUnmuted" });
  }
  if (prev.away !== next.away) out.push({ event: next.away ? "awayOn" : "awayOff" });
  if (prev.channelId === next.channelId && prev.canTalk !== next.canTalk) {
    out.push({ event: next.canTalk ? "talkPowerGranted" : "talkPowerRevoked" });
  }
  return out;
}
