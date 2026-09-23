/**
 * Row parsing and small rules for the M2 admin tools, free of Vue and the hub
 * so they are easy to test. Field names are what a live TeamSpeak 3 server
 * sent in its notifies (notifycomplainlist, notifymessagelist,
 * notifymessage, notifyclientdblist, notifyservertemppasswordlist...).
 * TeamSpeak timestamps are Unix seconds; everything here is in ms.
 */
import type { TsCmdRow } from "@jinz/protocol";

const ms = (seconds: string | undefined): number => (Number(seconds) || 0) * 1000;
const int = (v: string | undefined): number => Number(v) || 0;

/* ---------------------------------------------------------- complaints */

export interface Complaint {
  readonly targetDbId: string;
  readonly targetName: string;
  readonly fromDbId: string;
  readonly fromName: string;
  readonly message: string;
  readonly at: number;
}

export interface ComplaintGroup {
  readonly targetDbId: string;
  readonly targetName: string;
  /** Newest first. */
  readonly complaints: readonly Complaint[];
}

export function parseComplaints(rows: readonly TsCmdRow[]): Complaint[] {
  return rows
    .filter((r) => r["tcldbid"] && r["fcldbid"])
    .map((r) => ({
      targetDbId: r["tcldbid"]!,
      targetName: r["tname"] ?? "",
      fromDbId: r["fcldbid"]!,
      fromName: r["fname"] ?? "",
      message: r["message"] ?? "",
      at: ms(r["timestamp"]),
    }));
}

/** One group per target, the most complained-about first. */
export function groupComplaints(list: readonly Complaint[]): ComplaintGroup[] {
  const byTarget = new Map<string, Complaint[]>();
  for (const c of list) byTarget.set(c.targetDbId, [...(byTarget.get(c.targetDbId) ?? []), c]);
  return [...byTarget.entries()]
    .map(([targetDbId, complaints]) => ({
      targetDbId,
      targetName: complaints[0]!.targetName,
      complaints: [...complaints].sort((a, b) => b.at - a.at),
    }))
    .sort(
      (a, b) =>
        b.complaints.length - a.complaints.length || a.targetName.localeCompare(b.targetName),
    );
}

/* ---------------------------------------------------- offline messages */

export interface OfflineMessageHead {
  readonly id: string;
  readonly fromUid: string;
  readonly subject: string;
  readonly at: number;
  readonly read: boolean;
}

export interface OfflineMessage {
  readonly id: string;
  readonly fromUid: string;
  readonly subject: string;
  readonly body: string;
  readonly at: number;
}

/** Newest first; equal times by id, also newest first. */
export function parseMessageList(rows: readonly TsCmdRow[]): OfflineMessageHead[] {
  return rows
    .filter((r) => r["msgid"])
    .map((r) => ({
      id: r["msgid"]!,
      fromUid: r["cluid"] ?? "",
      subject: r["subject"] ?? "",
      at: ms(r["timestamp"]),
      read: r["flag_read"] === "1",
    }))
    .sort((a, b) => b.at - a.at || int(b.id) - int(a.id));
}

export function unreadCount(list: readonly OfflineMessageHead[]): number {
  return list.filter((m) => !m.read).length;
}

export function parseMessage(rows: readonly TsCmdRow[]): OfflineMessage | null {
  const r = rows.find((row) => row["msgid"]);
  if (!r) return null;
  return {
    id: r["msgid"]!,
    fromUid: r["cluid"] ?? "",
    subject: r["subject"] ?? "",
    body: r["message"] ?? "",
    at: ms(r["timestamp"]),
  };
}

/** `clientgetnamefromuid` answers with the last nickname the server saw for each UID, keyed by `cluid`. */
export function parseNamesFromUid(rows: readonly TsCmdRow[]): Record<string, string> {
  return Object.fromEntries(
    rows.filter((r) => r["cluid"] && r["name"]).map((r) => [r["cluid"]!, r["name"]!]),
  );
}

/* ----------------------------------------------------- client database */

export interface DbEntry {
  readonly dbId: string;
  readonly uid: string;
  readonly nickname: string;
  readonly created: number;
  readonly lastConnected: number;
  readonly totalConnections: number;
  readonly description: string;
  readonly lastIp: string;
}

function dbEntry(r: TsCmdRow, dbId: string): DbEntry {
  return {
    dbId,
    uid: r["client_unique_identifier"] ?? "",
    nickname: r["client_nickname"] ?? "",
    created: ms(r["client_created"]),
    lastConnected: ms(r["client_lastconnected"]),
    totalConnections: int(r["client_totalconnections"]),
    description: r["client_description"] ?? "",
    lastIp: r["client_lastip"] ?? "",
  };
}

/** A `clientdblist` page; with `-count` the first row carries the total. */
export function parseDbEntries(rows: readonly TsCmdRow[]): {
  entries: DbEntry[];
  total: number | null;
} {
  const count = rows[0]?.["count"];
  return {
    entries: rows.filter((r) => r["cldbid"]).map((r) => dbEntry(r, r["cldbid"]!)),
    total: count !== undefined && count !== "" ? int(count) : null,
  };
}

/** `clientdbinfo` answers with one row per id, naming it `client_database_id`. */
export function parseDbInfos(rows: readonly TsCmdRow[]): DbEntry[] {
  return rows
    .filter((row) => row["client_database_id"])
    .map((r) => dbEntry(r, r["client_database_id"]!));
}

/** `clientdbfind` only returns ids; the details come from `clientdbinfo`. */
export function parseDbFind(rows: readonly TsCmdRow[]): string[] {
  return [...new Set(rows.map((r) => r["cldbid"]).filter((id): id is string => !!id))];
}

/**
 * The server matches nicknames with SQL LIKE and no implicit wildcards, so a
 * plain word would only find that exact name. Someone who typed a `%` meant it.
 */
export function nicknamePattern(query: string): string {
  const q = query.trim();
  if (!q) return "";
  return q.includes("%") ? q : `%${q}%`;
}

/** A TS3 identity's UID: 20 bytes of SHA-1 in base64. */
export function looksLikeUid(text: string): boolean {
  return /^[A-Za-z0-9+/]{27}=$/.test(text.trim());
}

export interface PageInfo {
  readonly page: number;
  /** Null while the total is unknown (no `-count`). */
  readonly pages: number | null;
  readonly hasPrev: boolean;
  readonly hasNext: boolean;
}

/** `lastPageSize` stands in for the total when there is none: a full page may have more after it. */
export function pageInfo(
  start: number,
  size: number,
  total: number | null,
  lastPageSize = 0,
): PageInfo {
  const page = Math.floor(start / size) + 1;
  if (total === null) {
    return { page, pages: null, hasPrev: start > 0, hasNext: lastPageSize >= size };
  }
  const pages = Math.max(1, Math.ceil(total / size));
  return { page, pages, hasPrev: start > 0, hasNext: start + size < total };
}

/* ------------------------------------------------ temporary passwords */

export interface TempPassword {
  readonly password: string;
  readonly description: string;
  readonly creator: string;
  readonly creatorUid: string;
  readonly start: number;
  readonly end: number;
  /** Where users of this password land; null for the default channel. */
  readonly channelId: string | null;
  readonly channelPassword: string;
}

export function parseTempPasswords(rows: readonly TsCmdRow[]): TempPassword[] {
  return rows
    .filter((r) => r["pw_clear"])
    .map((r) => ({
      password: r["pw_clear"]!,
      description: r["desc"] ?? "",
      creator: r["nickname"] ?? "",
      creatorUid: r["uid"] ?? "",
      start: ms(r["start"]),
      end: ms(r["end"]),
      channelId: r["tcid"] && r["tcid"] !== "0" ? r["tcid"] : null,
      channelPassword: r["tcpw"] ?? "",
    }));
}

export interface DurationPreset {
  /** i18n suffix: `admin.tp.dur.<key>`. */
  readonly key: string;
  readonly seconds: number;
}

const HOUR = 3600;
const DAY = 24 * HOUR;

export const DURATION_PRESETS: readonly DurationPreset[] = [
  { key: "1h", seconds: HOUR },
  { key: "3h", seconds: 3 * HOUR },
  { key: "12h", seconds: 12 * HOUR },
  { key: "1d", seconds: DAY },
  { key: "7d", seconds: 7 * DAY },
  { key: "30d", seconds: 30 * DAY },
];

/** No 0/O or 1/l/I: these get read out or typed from a screenshot. */
const PASSWORD_CHARS = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A random password to hand out (crypto randomness unless a source is given). */
export function generatePassword(
  length = 10,
  fill: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b),
): string {
  const bytes = fill(new Uint8Array(length));
  return [...bytes].map((b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join("");
}

/** Channels as "Parent / Child" paths, sorted, for a target-channel picker. */
export function channelOptions(
  channels: Iterable<{ readonly id: string; readonly parentId: string; readonly name: string }>,
): { id: string; path: string }[] {
  const byId = new Map([...channels].map((c) => [c.id, c]));
  const path = (id: string, depth = 0): string => {
    const c = byId.get(id);
    if (!c) return "";
    const parent = depth < 32 && c.parentId !== "0" ? path(c.parentId, depth + 1) : "";
    return parent ? `${parent} / ${c.name}` : c.name;
  };
  return [...byId.keys()]
    .map((id) => ({ id, path: path(id) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}
