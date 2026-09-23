/**
 * Domain types shared by hub and browser.
 * All TeamSpeak uint64 identifiers (channel ids, database ids) are carried as
 * decimal strings so they survive JSON without precision loss.
 */

export interface TsChannel {
  id: string;
  parentId: string;
  /** Sort key: id of the channel this one is placed below (0 = first). */
  order: string;
  name: string;
  /** How text-to-speech should say the name ("" = as written). */
  namePhonetic: string;
  topic: string;
  codec: number;
  codecQuality: number;
  maxClients: number;
  maxFamilyClients: number;
  neededTalkPower: number;
  iconId: number;
  /** Seconds a temporary channel lives on once empty (0 for the other kinds). */
  deleteDelay: number;
  flags: {
    permanent: boolean;
    semiPermanent: boolean;
    default: boolean;
    password: boolean;
    maxClientsUnlimited: boolean;
    maxFamilyClientsUnlimited: boolean;
    maxFamilyClientsInherited: boolean;
  };
  /** Only filled after channelinfo (description is not in channellist). */
  description?: string;
  subscribed: boolean;
}

export interface TsClient {
  id: number;
  uid: string;
  databaseId: string;
  nickname: string;
  channelId: string;
  /** 0 = normal client, 1 = ServerQuery. */
  type: number;
  inputMuted: boolean;
  outputMuted: boolean;
  inputHardware: boolean;
  outputHardware: boolean;
  away: boolean;
  awayMessage: string;
  talkPower: number;
  isTalker: boolean;
  isPrioritySpeaker: boolean;
  isRecording: boolean;
  isChannelCommander: boolean;
  serverGroups: string[];
  channelGroupId: string;
  country: string;
  iconId: number;
  badges: string;
  /** Set by the hub for the browser's own client. */
  isSelf: boolean;
  /**
   * `client_flag_avatar`: MD5 of the avatar file, "" when none. The file
   * itself is named after the UID; the hash only says which version is current.
   */
  avatar: string;
  /** Free text set by the client or an admin (`client_description`, ≤200). */
  description: string;
  /** A talk power request is pending (the server sends its timestamp, 0 = none). */
  talkRequest: boolean;
  talkRequestMessage: string;
}

export interface TsServerInfo {
  name: string;
  namePhonetic: string;
  welcomeMessage: string;
  platform: string;
  version: string;
  maxClients: number;
  clientsOnline: number;
  channelsOnline: number;
  /** Unix seconds the virtual server was created; 0 if unknown. */
  created: number;
  /** Seconds the server has been running; 0 if unknown (needs serverinfo). */
  uptime: number;
  hostMessage: string;
  /** 0 none, 1 log, 2 modal, 3 modal+disconnect. */
  hostMessageMode: number;
  /** Icon id of the whole virtual server (0 = none). */
  iconId: number;
  /** Host banner: an image shown under the channel tree, optionally clickable. */
  hostbannerUrl: string;
  hostbannerGfxUrl: string;
  hostbannerGfxInterval: number;
  hostbannerMode: number;
  /** Host button: a small clickable image, e.g. a link to the community. */
  hostbuttonTooltip: string;
  hostbuttonUrl: string;
  hostbuttonGfxUrl: string;
  /** "ts3" | "ts6" | "unknown" as detected by the hub. */
  flavor: "ts3" | "ts6" | "unknown";
}

/** A server group or channel group as listed by the server. */
export interface TsGroup {
  id: string;
  name: string;
  /** 0 template, 1 regular, 2 server-query. Only regular groups are assigned to clients. */
  type: number;
  /** Icon id; ids below 1000 are the client's built-in sprites, not downloadable. */
  iconId: number;
  /** Display order among a client's groups (lower first). */
  sortId: number;
  /** 0 hidden, 1 before nickname, 2 after nickname. */
  nameMode: number;
}

/** TeamSpeak text message target modes. */
export const TextTarget = {
  Client: 1,
  Channel: 2,
  Server: 3,
} as const;
export type TextTargetMode = (typeof TextTarget)[keyof typeof TextTarget];

/** TeamSpeak voice codecs. Only Opus (4/5) can be sent by the web client. */
export const Codec = {
  SpeexNarrowband: 0,
  SpeexWideband: 1,
  SpeexUltraWideband: 2,
  CeltMono: 3,
  OpusVoice: 4,
  OpusMusic: 5,
} as const;

export function isOpusCodec(codec: number): boolean {
  return codec === Codec.OpusVoice || codec === Codec.OpusMusic;
}
