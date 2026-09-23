/**
 * Converts raw TeamSpeak parameter maps into the shared domain types.
 */
import type { TsChannel, TsClient, TsGroup, TsServerInfo } from "@jinz/protocol";

type Params = Record<string, string>;

const flag = (p: Params, key: string): boolean => p[key] === "1";
const num = (p: Params, key: string, def = 0): number => {
  const v = p[key];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const str = (p: Params, key: string, def = ""): string => p[key] ?? def;
/**
 * An icon id as its unsigned 32 bits. Permissions hold icons as int32, and a
 * live TS3 3.13 server wrote one set as -873187034 as "-873187034" (group
 * lists) or sign-extended to 64 bits, "18446744072836364582"
 * (notifychanneledited): too big for a Number to hold exactly.
 */
const iconId = (p: Params, key: string): number => {
  const v = p[key];
  if (!v || !/^-?\d{1,20}$/.test(v)) return 0;
  return Number(BigInt.asUintN(32, BigInt(v)));
};
const idStr = (p: Params, key: string, def = "0"): string => {
  const v = p[key];
  return v && /^\d+$/.test(v) ? v : def;
};
const splitGroups = (s: string): string[] =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * `channellist` rows carry every property, but `notifychannelcreated` leaves
 * out whatever has the server's default value, so the defaults below are the
 * ones a live TS3 3.13 server reports (channelinfo) for such a channel.
 */
export function channelFromParams(p: Params): TsChannel {
  const flagOr = (key: string, def: boolean) => (key in p ? flag(p, key) : def);
  return {
    id: idStr(p, "cid"),
    parentId: idStr(p, "cpid", idStr(p, "pid")),
    order: idStr(p, "channel_order"),
    name: str(p, "channel_name"),
    namePhonetic: str(p, "channel_name_phonetic"),
    topic: str(p, "channel_topic"),
    codec: num(p, "channel_codec", 4),
    codecQuality: num(p, "channel_codec_quality", 5),
    maxClients: num(p, "channel_maxclients", -1),
    maxFamilyClients: num(p, "channel_maxfamilyclients", -1),
    neededTalkPower: num(p, "channel_needed_talk_power"),
    iconId: iconId(p, "channel_icon_id"),
    deleteDelay: num(p, "channel_delete_delay"),
    flags: {
      permanent: flag(p, "channel_flag_permanent"),
      semiPermanent: flag(p, "channel_flag_semi_permanent"),
      default: flag(p, "channel_flag_default"),
      password: flag(p, "channel_flag_password"),
      maxClientsUnlimited: flagOr("channel_flag_maxclients_unlimited", true),
      maxFamilyClientsUnlimited: flagOr("channel_flag_maxfamilyclients_unlimited", true),
      maxFamilyClientsInherited: flag(p, "channel_flag_maxfamilyclients_inherited"),
    },
    subscribed: false,
  };
}

/**
 * Partial update from notifychanneledited / notifychannelmoved; only present
 * keys are patched. A move names the new place `order`, an edit `channel_order`.
 */
export function channelPatchFromParams(p: Params): Partial<TsChannel> {
  const patch: Partial<TsChannel> = {};
  const flags: Partial<TsChannel["flags"]> = {};
  if ("cpid" in p) patch.parentId = idStr(p, "cpid");
  if ("channel_order" in p) patch.order = idStr(p, "channel_order");
  else if ("order" in p) patch.order = idStr(p, "order");
  if ("channel_name" in p) patch.name = str(p, "channel_name");
  if ("channel_name_phonetic" in p) patch.namePhonetic = str(p, "channel_name_phonetic");
  if ("channel_topic" in p) patch.topic = str(p, "channel_topic");
  if ("channel_description" in p) patch.description = str(p, "channel_description");
  if ("channel_codec" in p) patch.codec = num(p, "channel_codec");
  if ("channel_codec_quality" in p) patch.codecQuality = num(p, "channel_codec_quality");
  if ("channel_maxclients" in p) patch.maxClients = num(p, "channel_maxclients");
  if ("channel_maxfamilyclients" in p) patch.maxFamilyClients = num(p, "channel_maxfamilyclients");
  if ("channel_needed_talk_power" in p) patch.neededTalkPower = num(p, "channel_needed_talk_power");
  if ("channel_icon_id" in p) patch.iconId = iconId(p, "channel_icon_id");
  if ("channel_delete_delay" in p) patch.deleteDelay = num(p, "channel_delete_delay");
  if ("channel_flag_permanent" in p) flags.permanent = flag(p, "channel_flag_permanent");
  if ("channel_flag_semi_permanent" in p)
    flags.semiPermanent = flag(p, "channel_flag_semi_permanent");
  if ("channel_flag_default" in p) flags.default = flag(p, "channel_flag_default");
  if ("channel_flag_password" in p) flags.password = flag(p, "channel_flag_password");
  if ("channel_flag_maxclients_unlimited" in p)
    flags.maxClientsUnlimited = flag(p, "channel_flag_maxclients_unlimited");
  if ("channel_flag_maxfamilyclients_unlimited" in p)
    flags.maxFamilyClientsUnlimited = flag(p, "channel_flag_maxfamilyclients_unlimited");
  if ("channel_flag_maxfamilyclients_inherited" in p)
    flags.maxFamilyClientsInherited = flag(p, "channel_flag_maxfamilyclients_inherited");
  if (Object.keys(flags).length > 0) patch.flags = flags as TsChannel["flags"];
  return patch;
}

export function clientFromParams(p: Params, selfId: number): TsClient {
  const id = num(p, "clid");
  return {
    id,
    uid: str(p, "client_unique_identifier"),
    databaseId: idStr(p, "client_database_id"),
    nickname: str(p, "client_nickname"),
    // notifycliententerview uses ctid (target channel); clientlist uses cid.
    channelId: idStr(p, "ctid", idStr(p, "cid")),
    type: num(p, "client_type"),
    inputMuted: flag(p, "client_input_muted"),
    outputMuted: flag(p, "client_output_muted"),
    inputHardware:
      p["client_input_hardware"] === undefined ? true : flag(p, "client_input_hardware"),
    outputHardware:
      p["client_output_hardware"] === undefined ? true : flag(p, "client_output_hardware"),
    away: flag(p, "client_away"),
    awayMessage: str(p, "client_away_message"),
    talkPower: num(p, "client_talk_power"),
    isTalker: flag(p, "client_is_talker"),
    isPrioritySpeaker: flag(p, "client_is_priority_speaker"),
    isRecording: flag(p, "client_is_recorder"),
    isChannelCommander: flag(p, "client_is_channel_commander"),
    serverGroups: splitGroups(str(p, "client_servergroups")),
    channelGroupId: idStr(p, "client_channel_group_id"),
    country: str(p, "client_country"),
    iconId: iconId(p, "client_icon_id"),
    badges: str(p, "client_badges"),
    isSelf: id === selfId,
    avatar: avatarHash(p),
    description: str(p, "client_description"),
    talkRequest: talkRequested(p),
    talkRequestMessage: str(p, "client_talk_request_msg"),
  };
}

/** Only a hex digest may name an avatar version; it ends up in a URL path. */
function avatarHash(p: Params): string {
  const v = str(p, "client_flag_avatar");
  return /^[0-9a-f]{1,64}$/i.test(v) ? v.toLowerCase() : "";
}

/** The server sends the request's unix time, not a flag: anything but 0 is pending. */
function talkRequested(p: Params): boolean {
  const v = p["client_talk_request"];
  return v !== undefined && v !== "" && v !== "0";
}

/** Partial update from notifyclientupdated (only keys that were sent). */
export function clientPatchFromParams(p: Params): Partial<TsClient> {
  const patch: Partial<TsClient> = {};
  if ("client_nickname" in p) patch.nickname = str(p, "client_nickname");
  if ("client_input_muted" in p) patch.inputMuted = flag(p, "client_input_muted");
  if ("client_output_muted" in p) patch.outputMuted = flag(p, "client_output_muted");
  if ("client_input_hardware" in p) patch.inputHardware = flag(p, "client_input_hardware");
  if ("client_output_hardware" in p) patch.outputHardware = flag(p, "client_output_hardware");
  if ("client_away" in p) patch.away = flag(p, "client_away");
  if ("client_away_message" in p) patch.awayMessage = str(p, "client_away_message");
  if ("client_talk_power" in p) patch.talkPower = num(p, "client_talk_power");
  if ("client_is_talker" in p) patch.isTalker = flag(p, "client_is_talker");
  if ("client_is_priority_speaker" in p)
    patch.isPrioritySpeaker = flag(p, "client_is_priority_speaker");
  if ("client_is_recorder" in p) patch.isRecording = flag(p, "client_is_recorder");
  if ("client_is_channel_commander" in p)
    patch.isChannelCommander = flag(p, "client_is_channel_commander");
  if ("client_servergroups" in p) patch.serverGroups = splitGroups(str(p, "client_servergroups"));
  if ("client_channel_group_id" in p) patch.channelGroupId = idStr(p, "client_channel_group_id");
  if ("client_country" in p) patch.country = str(p, "client_country");
  if ("client_icon_id" in p) patch.iconId = iconId(p, "client_icon_id");
  if ("client_badges" in p) patch.badges = str(p, "client_badges");
  if ("client_flag_avatar" in p) patch.avatar = avatarHash(p);
  if ("client_description" in p) patch.description = str(p, "client_description");
  if ("client_talk_request" in p) patch.talkRequest = talkRequested(p);
  if ("client_talk_request_msg" in p) patch.talkRequestMessage = str(p, "client_talk_request_msg");
  return patch;
}

export function serverInfoFromParams(p: Params, flavor: TsServerInfo["flavor"]): TsServerInfo {
  return {
    name: str(p, "virtualserver_name"),
    namePhonetic: str(p, "virtualserver_name_phonetic"),
    welcomeMessage: str(p, "virtualserver_welcomemessage"),
    platform: str(p, "virtualserver_platform"),
    version: str(p, "virtualserver_version"),
    maxClients: num(p, "virtualserver_maxclients"),
    clientsOnline: num(p, "virtualserver_clientsonline"),
    channelsOnline: num(p, "virtualserver_channelsonline"),
    created: num(p, "virtualserver_created"),
    uptime: num(p, "virtualserver_uptime"),
    hostMessage: str(p, "virtualserver_hostmessage"),
    hostMessageMode: num(p, "virtualserver_hostmessage_mode"),
    iconId: iconId(p, "virtualserver_icon_id"),
    hostbannerUrl: str(p, "virtualserver_hostbanner_url"),
    hostbannerGfxUrl: str(p, "virtualserver_hostbanner_gfx_url"),
    hostbannerGfxInterval: num(p, "virtualserver_hostbanner_gfx_interval"),
    hostbannerMode: num(p, "virtualserver_hostbanner_mode"),
    hostbuttonTooltip: str(p, "virtualserver_hostbutton_tooltip"),
    hostbuttonUrl: str(p, "virtualserver_hostbutton_url"),
    hostbuttonGfxUrl: str(p, "virtualserver_hostbutton_gfx_url"),
    flavor,
  };
}

export function serverPatchFromParams(p: Params): Partial<TsServerInfo> {
  const patch: Partial<TsServerInfo> = {};
  if ("virtualserver_name" in p) patch.name = str(p, "virtualserver_name");
  if ("virtualserver_welcomemessage" in p)
    patch.welcomeMessage = str(p, "virtualserver_welcomemessage");
  if ("virtualserver_maxclients" in p) patch.maxClients = num(p, "virtualserver_maxclients");
  if ("virtualserver_hostmessage" in p) patch.hostMessage = str(p, "virtualserver_hostmessage");
  if ("virtualserver_hostmessage_mode" in p)
    patch.hostMessageMode = num(p, "virtualserver_hostmessage_mode");
  if ("virtualserver_icon_id" in p) patch.iconId = iconId(p, "virtualserver_icon_id");
  if ("virtualserver_name_phonetic" in p)
    patch.namePhonetic = str(p, "virtualserver_name_phonetic");
  if ("virtualserver_hostbanner_url" in p)
    patch.hostbannerUrl = str(p, "virtualserver_hostbanner_url");
  if ("virtualserver_hostbanner_gfx_url" in p)
    patch.hostbannerGfxUrl = str(p, "virtualserver_hostbanner_gfx_url");
  if ("virtualserver_hostbanner_gfx_interval" in p)
    patch.hostbannerGfxInterval = num(p, "virtualserver_hostbanner_gfx_interval");
  if ("virtualserver_hostbanner_mode" in p)
    patch.hostbannerMode = num(p, "virtualserver_hostbanner_mode");
  if ("virtualserver_hostbutton_tooltip" in p)
    patch.hostbuttonTooltip = str(p, "virtualserver_hostbutton_tooltip");
  if ("virtualserver_hostbutton_url" in p)
    patch.hostbuttonUrl = str(p, "virtualserver_hostbutton_url");
  if ("virtualserver_hostbutton_gfx_url" in p)
    patch.hostbuttonGfxUrl = str(p, "virtualserver_hostbutton_gfx_url");
  return patch;
}

/** A row of notifyservergrouplist (sgid) or notifychannelgrouplist (cgid). */
export function groupFromParams(p: Params): TsGroup | null {
  const id = p["sgid"] ?? p["cgid"];
  if (!id || !/^\d+$/.test(id)) return null;
  return {
    id,
    name: str(p, "name"),
    type: num(p, "type"),
    iconId: iconId(p, "iconid"),
    sortId: num(p, "sortid"),
    nameMode: num(p, "namemode"),
  };
}

/** Detects TS6 by its version string ("6.x" / "TeamSpeak 6"). */
export function detectFlavor(version: string, platform: string): TsServerInfo["flavor"] {
  const v = version.toLowerCase();
  if (/^6\./.test(v) || v.includes("teamspeak 6") || platform.toLowerCase().includes("ts6")) {
    return "ts6";
  }
  if (/^3\./.test(v)) return "ts3";
  return "unknown";
}

/**
 * The address the server sees for client `clid`, from the rows of
 * `getconnectioninfo` (`notifyconnectioninfo`). A live TS3 3.13 server gives a
 * guest its own; `clientinfo` on oneself leaves it out.
 */
export function connectionIpOf(rows: readonly Params[], clid: number): string | null {
  const row = rows.find((r) => r["clid"] === String(clid));
  return row?.["connection_client_ip"] || null;
}
