/**
 * Row parsing and small rules for the M4 server windows, free of Vue and the
 * hub so they are easy to test. Field names are what a live TS3 3.13 server
 * sent in its notifies (notifytokenlist, notifyserverconnectioninfo,
 * notifyserverupdated, notifyservergrouplist...). Timestamps come as Unix
 * seconds; everything here is in ms.
 */
import { GROUP_NAME_MAX, PRIVILEGE_KEY_MAX, type TsCmdArgs, type TsCmdRow } from "@jinz/protocol";

const int = (v: string | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};
const num = (v: string | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/* -------------------------------------------------------- privilege keys */

export interface PrivilegeKey {
  readonly token: string;
  /** 0 a server group, 1 a channel group (in `channelId`). */
  readonly type: number;
  readonly groupId: string;
  readonly channelId: string | null;
  readonly created: number;
  readonly description: string;
}

export function parsePrivilegeKeys(rows: readonly TsCmdRow[]): PrivilegeKey[] {
  return rows
    .filter((r) => r["token"])
    .map((r) => {
      const type = int(r["token_type"]);
      return {
        token: r["token"]!,
        type,
        groupId: r["token_id1"] ?? "",
        channelId: type === 1 ? (r["token_id2"] ?? null) : null,
        created: int(r["token_created"]) * 1000,
        description: r["token_description"] ?? "",
      };
    });
}

const KEY_RE = /^[A-Za-z0-9+/=]+$/;

/**
 * A key as pasted: line breaks and spaces (a key copied out of a chat wraps)
 * are dropped; anything else that is not base64 means it is not a key.
 */
export function cleanPrivilegeKey(text: string): string | null {
  const key = text.replace(/\s+/g, "");
  return key && key.length <= PRIVILEGE_KEY_MAX && KEY_RE.test(key) ? key : null;
}

/* ------------------------------------------------------- connection info */

export interface ConnectionInfo {
  readonly packetsSent: number;
  readonly bytesSent: number;
  readonly packetsReceived: number;
  readonly bytesReceived: number;
  /** Bytes per second, averaged over the last second / minute. */
  readonly bandwidthSentSecond: number;
  readonly bandwidthSentMinute: number;
  readonly bandwidthReceivedSecond: number;
  readonly bandwidthReceivedMinute: number;
  readonly fileBandwidthSent: number;
  readonly fileBandwidthReceived: number;
  readonly connectedSeconds: number;
  /** 0–1. */
  readonly packetLoss: number;
  /** Milliseconds. */
  readonly ping: number;
}

export function parseConnectionInfo(rows: readonly TsCmdRow[]): ConnectionInfo | null {
  const r = rows[0];
  if (!r) return null;
  const c = (k: string) => num(r[`connection_${k}`]);
  return {
    packetsSent: c("packets_sent_total"),
    bytesSent: c("bytes_sent_total"),
    packetsReceived: c("packets_received_total"),
    bytesReceived: c("bytes_received_total"),
    bandwidthSentSecond: c("bandwidth_sent_last_second_total"),
    bandwidthSentMinute: c("bandwidth_sent_last_minute_total"),
    bandwidthReceivedSecond: c("bandwidth_received_last_second_total"),
    bandwidthReceivedMinute: c("bandwidth_received_last_minute_total"),
    fileBandwidthSent: c("filetransfer_bandwidth_sent"),
    fileBandwidthReceived: c("filetransfer_bandwidth_received"),
    connectedSeconds: c("connected_time"),
    packetLoss: c("packetloss_total"),
    ping: c("ping"),
  };
}

/* ------------------------------------------------------ server variables */

/**
 * The editable settings `servergetvariables` reports (as notifyserverupdated)
 * that the session's server info does not keep. The name, banner and host
 * message are not among them: those come from the server info.
 */
export interface ServerVariables {
  readonly welcomeMessage?: string;
  readonly maxClients?: number;
  readonly reservedSlots?: number;
  readonly securityLevel?: number;
  readonly forcedSilence?: number;
}

export function parseServerVariables(rows: readonly TsCmdRow[]): ServerVariables {
  const r = rows[0];
  if (!r) return {};
  const has = (k: string) => k in r;
  return {
    ...(has("virtualserver_welcomemessage")
      ? { welcomeMessage: r["virtualserver_welcomemessage"] }
      : {}),
    ...(has("virtualserver_maxclients") ? { maxClients: int(r["virtualserver_maxclients"]) } : {}),
    ...(has("virtualserver_reserved_slots")
      ? { reservedSlots: int(r["virtualserver_reserved_slots"]) }
      : {}),
    ...(has("virtualserver_needed_identity_security_level")
      ? { securityLevel: int(r["virtualserver_needed_identity_security_level"]) }
      : {}),
    ...(has("virtualserver_min_clients_in_channel_before_forced_silence")
      ? { forcedSilence: int(r["virtualserver_min_clients_in_channel_before_forced_silence"]) }
      : {}),
  };
}

/* ----------------------------------------------------------------- groups */

export interface GroupRow {
  readonly id: string;
  readonly name: string;
  readonly sortId: number;
  /** 0 hidden, 1 before the nickname, 2 after it. */
  readonly nameMode: number;
  /** The i_group_modify_power a change to this group needs. */
  readonly neededModifyPower: number;
}

/** Only regular groups (type 1): templates and query groups are not ours to manage. */
const REGULAR_GROUP = 1;

/** A group list, regular groups only, in TeamSpeak's order: sort id, then id. */
export function parseGroups(rows: readonly TsCmdRow[], idKey: "sgid" | "cgid"): GroupRow[] {
  return rows
    .filter((r) => r[idKey] && int(r["type"]) === REGULAR_GROUP)
    .map((r) => ({
      id: r[idKey]!,
      name: r["name"] ?? "",
      sortId: int(r["sortid"]),
      nameMode: int(r["namemode"]),
      neededModifyPower: int(r["n_modifyp"]),
    }))
    .sort((a, b) => a.sortId - b.sortId || Number(a.id) - Number(b.id));
}

export type GroupNameProblem = "empty" | "tooLong" | "taken";

/** Why a new group name would be refused, before the server has to say so (1541, 1282). */
export function groupNameProblem(name: string, taken: readonly string[]): GroupNameProblem | null {
  const n = name.trim();
  if (!n) return "empty";
  if (n.length > GROUP_NAME_MAX) return "tooLong";
  const lower = n.toLowerCase();
  return taken.some((t) => t.trim().toLowerCase() === lower) ? "taken" : null;
}

/* ------------------------------------------------------------ serveredit */

/** The edit dialog's form, one entry per field `serveredit` may change. */
export interface ServerEditValues {
  readonly name: string;
  readonly welcomeMessage: string;
  readonly hostMessage: string;
  readonly hostMessageMode: number;
  readonly hostbannerUrl: string;
  readonly hostbannerGfxUrl: string;
  readonly hostbuttonUrl: string;
  readonly hostbuttonGfxUrl: string;
  readonly maxClients: number;
  readonly reservedSlots: number;
  /** "" leaves it as it is: neither the server info nor the variables report it. */
  readonly defaultServerGroup: string;
  readonly defaultChannelGroup: string;
  readonly securityLevel: number;
  readonly forcedSilence: number;
}

/** What the page already knows about the server (a subset of TsServerInfo). */
export interface KnownServerInfo {
  readonly name: string;
  readonly welcomeMessage: string;
  readonly hostMessage: string;
  readonly hostMessageMode: number;
  readonly hostbannerUrl: string;
  readonly hostbannerGfxUrl: string;
  readonly hostbuttonUrl: string;
  readonly hostbuttonGfxUrl: string;
  readonly maxClients: number;
}

/** The form's starting values: the server info, with the fresher variables over it. */
export function editValuesOf(info: KnownServerInfo, vars: ServerVariables): ServerEditValues {
  return {
    name: info.name,
    welcomeMessage: vars.welcomeMessage ?? info.welcomeMessage,
    hostMessage: info.hostMessage,
    hostMessageMode: info.hostMessageMode,
    hostbannerUrl: info.hostbannerUrl,
    hostbannerGfxUrl: info.hostbannerGfxUrl,
    hostbuttonUrl: info.hostbuttonUrl,
    hostbuttonGfxUrl: info.hostbuttonGfxUrl,
    maxClients: vars.maxClients ?? info.maxClients,
    reservedSlots: vars.reservedSlots ?? 0,
    defaultServerGroup: "",
    defaultChannelGroup: "",
    securityLevel: vars.securityLevel ?? 0,
    forcedSilence: vars.forcedSilence ?? 0,
  };
}

type EditArgs = TsCmdArgs<"serveredit">;

/** Form field → TeamSpeak's name; the texts are compared trimmed, like they are sent. */
const TEXT_FIELDS = {
  name: "virtualserver_name",
  hostMessage: "virtualserver_hostmessage",
  hostbannerUrl: "virtualserver_hostbanner_url",
  hostbannerGfxUrl: "virtualserver_hostbanner_gfx_url",
  hostbuttonUrl: "virtualserver_hostbutton_url",
  hostbuttonGfxUrl: "virtualserver_hostbutton_gfx_url",
} as const satisfies Partial<Record<keyof ServerEditValues, keyof EditArgs>>;

const NUMBER_FIELDS = {
  hostMessageMode: "virtualserver_hostmessage_mode",
  maxClients: "virtualserver_maxclients",
  reservedSlots: "virtualserver_reserved_slots",
  securityLevel: "virtualserver_needed_identity_security_level",
  forcedSilence: "virtualserver_min_clients_in_channel_before_forced_silence",
} as const satisfies Partial<Record<keyof ServerEditValues, keyof EditArgs>>;

const GROUP_FIELDS = {
  defaultServerGroup: "virtualserver_default_server_group",
  defaultChannelGroup: "virtualserver_default_channel_group",
} as const satisfies Partial<Record<keyof ServerEditValues, keyof EditArgs>>;

/**
 * The `serveredit` arguments for what the form changed, or null when it
 * changed nothing. Only changed fields go out, so one admin's save never
 * reverts a field another changed meanwhile, and a field the user may not
 * modify is only refused when they actually touched it.
 */
export function serverEditPatch(
  current: ServerEditValues,
  form: ServerEditValues,
): EditArgs | null {
  const patch: Record<string, string | number> = {};
  for (const [field, key] of Object.entries(TEXT_FIELDS)) {
    const f = field as keyof typeof TEXT_FIELDS;
    const next = form[f].trim();
    if (next !== current[f].trim()) patch[key] = next;
  }
  // The welcome message keeps its own spacing: BBCode layout can depend on it.
  if (form.welcomeMessage !== current.welcomeMessage) {
    patch["virtualserver_welcomemessage"] = form.welcomeMessage;
  }
  for (const [field, key] of Object.entries(NUMBER_FIELDS)) {
    const f = field as keyof typeof NUMBER_FIELDS;
    if (form[f] !== current[f]) patch[key] = form[f];
  }
  for (const [field, key] of Object.entries(GROUP_FIELDS)) {
    const f = field as keyof typeof GROUP_FIELDS;
    if (form[f] && form[f] !== current[f]) patch[key] = form[f];
  }
  return Object.keys(patch).length ? (patch as EditArgs) : null;
}
