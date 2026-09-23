/**
 * The whisper list, and what it names on the server we are on right now.
 *
 * A list is kept in the terms a person thinks in — "my channel's family",
 * "the commanders", "Alice" — not in ids, because channel and client ids
 * change between sessions. It is resolved against the live tree each time the
 * whisper key goes down, and the hub checks the result against its own tree
 * again before anything is sent.
 *
 * The presets are TeamSpeak 3's group-whisper targets. They are expanded here
 * into plain channel and client ids, because the hub sends the classic whisper
 * header (N channels, M clients), which every server accepts.
 */
import { WHISPER_MAX_TARGETS } from "@jinz/protocol";

export const WHISPER_PRESETS = [
  "channel",
  "parent",
  "parents",
  "subchannels",
  "family",
  "all",
  "commanders",
] as const;
export type WhisperPreset = (typeof WHISPER_PRESETS)[number];

/** The list on one server; whisper-saved.ts keeps it, with every server's channels. */
export interface WhisperList {
  presets: WhisperPreset[];
  /**
   * Channel ids picked by hand on the server this list is for. They are kept
   * per server (whisper-saved.ts), because an id means nothing on another.
   */
  channels: string[];
  /** Client UIDs, so a pick survives the client reconnecting under a new id. */
  clients: string[];
}

export const EMPTY_WHISPER_LIST: WhisperList = Object.freeze({
  presets: [],
  channels: [],
  clients: [],
}) as WhisperList;

/** The slice of the channel tree the resolver needs. */
export interface WhisperTree {
  channels: readonly { id: string; parentId: string }[];
  clients: readonly {
    id: number;
    uid: string;
    channelId: string;
    isChannelCommander: boolean;
    isSelf: boolean;
  }[];
  /** Our channel, or null while not in one. */
  selfChannelId: string | null;
}

export interface ResolvedWhisper {
  channels: string[];
  clients: number[];
  /** More was named than one whisper may carry; the rest was left out. */
  truncated: boolean;
}

export function isWhisperListEmpty(list: WhisperList): boolean {
  return list.presets.length === 0 && list.channels.length === 0 && list.clients.length === 0;
}

/** Channel ids a preset stands for, from our channel's point of view. */
function presetChannels(preset: WhisperPreset, tree: WhisperTree): string[] {
  const self = tree.selfChannelId;
  if (self === null) return [];
  const parentOf = new Map(tree.channels.map((c) => [c.id, c.parentId]));
  const childrenOf = (id: string) =>
    tree.channels.filter((c) => c.parentId === id).map((c) => c.id);
  switch (preset) {
    case "channel":
      return [self];
    case "parent": {
      const parent = parentOf.get(self);
      return parent && parentOf.has(parent) ? [parent] : [];
    }
    case "parents": {
      const out: string[] = [];
      let at = parentOf.get(self);
      // Bounded by the tree's size, so a malformed parent loop cannot spin.
      while (at && parentOf.has(at) && out.length < tree.channels.length) {
        out.push(at);
        at = parentOf.get(at);
      }
      return out;
    }
    case "subchannels":
      return childrenOf(self);
    case "family": {
      const out: string[] = [];
      const queue = [self];
      while (queue.length > 0 && out.length < tree.channels.length) {
        const id = queue.shift()!;
        out.push(id);
        queue.push(...childrenOf(id));
      }
      return out;
    }
    case "all":
      return tree.channels.map((c) => c.id);
    case "commanders":
      return [];
  }
}

/**
 * The channel and client ids `list` names in `tree`: presets first, in the
 * order they are listed, then hand-picked channels, then hand-picked
 * clients. Each target once, never ourselves, and at most
 * WHISPER_MAX_TARGETS in all.
 */
export function resolveWhisperTargets(list: WhisperList, tree: WhisperTree): ResolvedWhisper {
  const known = new Set(tree.channels.map((c) => c.id));
  const channels: string[] = [];
  const clients: number[] = [];
  let truncated = false;
  const room = () => channels.length + clients.length < WHISPER_MAX_TARGETS;
  const addChannel = (id: string) => {
    if (!known.has(id) || channels.includes(id)) return;
    if (room()) channels.push(id);
    else truncated = true;
  };
  const addClient = (id: number) => {
    if (clients.includes(id)) return;
    if (room()) clients.push(id);
    else truncated = true;
  };
  const others = tree.clients.filter((c) => !c.isSelf);

  for (const preset of list.presets) {
    for (const id of presetChannels(preset, tree)) addChannel(id);
    if (preset === "commanders") {
      for (const c of others) if (c.isChannelCommander) addClient(c.id);
    }
  }
  for (const id of list.channels) addChannel(id);
  for (const uid of list.clients) {
    for (const c of others) if (c.uid === uid) addClient(c.id);
  }
  return { channels, clients, truncated };
}
