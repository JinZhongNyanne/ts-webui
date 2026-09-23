/**
 * The whisper list as it is kept in `jinz.voice.settings`, and the one
 * server's view of it that everything else works with (whisper-targets.ts).
 *
 * ## Hand-picked channels belong to one server
 *
 * A preset ("my channel's family") and a person (a UID) mean the same thing on
 * every server, so they are kept once. A hand-picked channel is only an id,
 * and ids are numbered per server: channel 5 is "Admins" on one and somebody
 * else's private room on the next. Kept once, a pick made on server A would
 * whisper to whoever sits in channel 5 of server B the moment the key went
 * down there — and the hub, rightly, accepts any channel its tree can see. So
 * the picks are filed under the server they were made on, keyed exactly as
 * the chat history files its conversations (chat/history.ts's
 * historyServerKey), and only the current server's are ever read back.
 *
 * ## Older saved lists
 *
 * A build before this one kept a single `channels` array with no server
 * attached. There is no telling which server those ids were picked on, and
 * guessing "the next one we connect to" is precisely the leak above, so they
 * are dropped: the field is read under a new name (`channelsByServer`) and the
 * old one is never looked at. Presets and people carry over untouched.
 */
import { historyServerKey, type DialTarget, type ServerIdentity } from "../../chat/history";
import { WHISPER_PRESETS, type WhisperList, type WhisperPreset } from "./whisper-targets";

export interface SavedWhisperList {
  presets: WhisperPreset[];
  /** Hand-picked channel ids, per server (historyServerKey); a server with none has no entry. */
  channelsByServer: Readonly<Record<string, readonly string[]>>;
  /** Client UIDs, so a pick survives the client reconnecting under a new id. */
  clients: string[];
}

export const EMPTY_SAVED_WHISPER_LIST: SavedWhisperList = Object.freeze({
  presets: [],
  channelsByServer: {},
  clients: [],
}) as SavedWhisperList;

/** Which server hand-picked channels are filed under; null while not on one. */
export function whisperServerKey(server: ServerIdentity | null, target: DialTarget): string | null {
  return server ? historyServerKey(server, target) : null;
}

/**
 * `server`'s picks. An own property only: a key such as "constructor" must not
 * find Object.prototype's, whatever a saved file or a server name contains.
 */
function picksOf(saved: SavedWhisperList, server: string | null): readonly string[] {
  if (server === null || !Object.hasOwn(saved.channelsByServer, server)) return [];
  const picks = saved.channelsByServer[server];
  return Array.isArray(picks) ? picks : [];
}

/** The list as it stands on `server`: every preset and person, and that server's channels only. */
export function whisperListFor(saved: SavedWhisperList, server: string | null): WhisperList {
  return {
    presets: [...saved.presets],
    channels: [...picksOf(saved, server)],
    clients: [...saved.clients],
  };
}

/**
 * `saved` with `next` — an edit made on `server` — written back: presets and
 * people as they are, channels under `server` alone, the other servers' picks
 * untouched. Off a server, no channel can have been picked, so channels are
 * left as they were.
 */
export function saveWhisperList(
  saved: SavedWhisperList,
  server: string | null,
  next: WhisperList,
): SavedWhisperList {
  const presets = [...next.presets];
  const clients = [...next.clients];
  if (server === null) return { presets, channelsByServer: saved.channelsByServer, clients };
  const others = Object.entries(saved.channelsByServer).filter(([key]) => key !== server);
  const mine: [string, readonly string[]][] =
    next.channels.length > 0 ? [[server, [...next.channels]]] : [];
  return { presets, channelsByServer: Object.fromEntries([...others, ...mine]), clients };
}

function isPreset(value: unknown): value is WhisperPreset {
  return typeof value === "string" && (WHISPER_PRESETS as readonly string[]).includes(value);
}

function uniqueStrings(value: unknown, keep: (s: string) => boolean): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) if (typeof v === "string" && keep(v) && !out.includes(v)) out.push(v);
  return out;
}

const isChannelId = (v: string): boolean => /^\d+$/.test(v);

function sanitiseChannelsByServer(value: unknown): Record<string, readonly string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([server]) => server.length > 0)
    .map(([server, ids]) => [server, uniqueStrings(ids, isChannelId)] as const)
    .filter(([, ids]) => ids.length > 0);
  return Object.fromEntries(entries);
}

/**
 * Saved data may come from an older build or be garbage; keep only what is
 * well formed. An older build's server-less `channels` is dropped on purpose
 * (see the top of this file).
 */
export function sanitiseSavedWhisperList(saved: unknown): SavedWhisperList {
  if (!saved || typeof saved !== "object") return { ...EMPTY_SAVED_WHISPER_LIST };
  const s = saved as Record<string, unknown>;
  const presets: WhisperPreset[] = [];
  if (Array.isArray(s.presets)) {
    for (const p of s.presets) if (isPreset(p) && !presets.includes(p)) presets.push(p);
  }
  return {
    presets,
    channelsByServer: sanitiseChannelsByServer(s.channelsByServer),
    clients: uniqueStrings(s.clients, (v) => v.length > 0),
  };
}
