/**
 * The M2 admin tools as promise calls over the allow-listed `ts.cmd` channel
 * (see commands.ts): complaints, offline messages, the client database and
 * temporary server passwords. Every function rejects with a TsCommandError
 * whose message is translated and ready to show (a 2568 names the permission
 * the server wanted). An empty list comes back as `[]`, not as an error: the
 * hub turns TeamSpeak's "database empty result set" into no rows.
 */
import { CLIENT_DB_INFO_MAX, NAME_LOOKUP_MAX } from "@jinz/protocol";
import { tsCommand, TsCommandError } from "./commands";
import {
  looksLikeUid,
  nicknamePattern,
  parseComplaints,
  parseDbEntries,
  parseDbFind,
  parseDbInfos,
  parseMessage,
  parseMessageList,
  parseNamesFromUid,
  parseTempPasswords,
  type Complaint,
  type DbEntry,
  type OfflineMessage,
  type OfflineMessageHead,
  type TempPassword,
} from "./admin-rows";

/* ---------------------------------------------------------- complaints */

export async function fileComplaint(targetDbId: string, message: string): Promise<void> {
  await tsCommand("complainadd", { tcldbid: targetDbId, message: message.trim() });
}

export async function listComplaints(): Promise<Complaint[]> {
  return parseComplaints(await tsCommand("complainlist", {}));
}

export async function deleteComplaint(targetDbId: string, fromDbId: string): Promise<void> {
  await tsCommand("complaindel", { tcldbid: targetDbId, fcldbid: fromDbId });
}

export async function deleteAllComplaints(targetDbId: string): Promise<void> {
  await tsCommand("complaindelall", { tcldbid: targetDbId });
}

/* ---------------------------------------------------- offline messages */

export async function listOfflineMessages(): Promise<OfflineMessageHead[]> {
  return parseMessageList(await tsCommand("messagelist", {}));
}

/** Reading does not mark a message read on the server; `markOfflineMessageRead` does. */
export async function readOfflineMessage(id: string): Promise<OfflineMessage | null> {
  return parseMessage(await tsCommand("messageget", { msgid: id }));
}

export async function markOfflineMessageRead(id: string, read = true): Promise<void> {
  await tsCommand("messageupdateflag", { msgid: id, flag: read });
}

export async function deleteOfflineMessage(id: string): Promise<void> {
  await tsCommand("messagedel", { msgid: id });
}

export async function sendOfflineMessage(
  uid: string,
  subject: string,
  body: string,
): Promise<void> {
  await tsCommand("messageadd", { cluid: uid.trim(), subject: subject.trim(), message: body });
}

/** TeamSpeak's "invalid clientID": a UID or database id it does not know. */
const UNKNOWN_CLIENT = "512";
const isUnknownClient = (err: unknown) =>
  err instanceof TsCommandError && err.code === UNKNOWN_CLIENT;

/** Splits `items` into runs of at most `size`. */
function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The last nickname the server saw for each UID; null for one it never saw.
 * Up to NAME_LOOKUP_MAX go in one command. One unknown UID fails the whole
 * command with 512 (on a live server the known ones were answered before
 * the error, but a failed command brings no rows back), so only then are
 * they asked one by one.
 */
export async function namesFromUids(
  uids: readonly string[],
): Promise<Record<string, string | null>> {
  const unique = [...new Set(uids)];
  const found: Record<string, string> = {};
  for (const batch of chunks(unique, NAME_LOOKUP_MAX)) {
    Object.assign(found, await lookUpNames(batch));
  }
  return Object.fromEntries(unique.map((uid) => [uid, found[uid] ?? null]));
}

async function lookUpNames(batch: readonly string[]): Promise<Record<string, string>> {
  try {
    return parseNamesFromUid(await tsCommand("clientgetnamefromuid", { cluids: [...batch] }));
  } catch (err) {
    if (!isUnknownClient(err)) throw err;
    if (batch.length === 1) return {};
  }
  // One after another, not all at once: this is the rare path.
  const found: Record<string, string> = {};
  for (const uid of batch) Object.assign(found, await lookUpNames([uid]));
  return found;
}

/* ----------------------------------------------------- client database */

export async function listClientDb(
  start: number,
  size: number,
): Promise<{ entries: DbEntry[]; total: number | null }> {
  return parseDbEntries(await tsCommand("clientdblist", { start, duration: size, count: true }));
}

/**
 * Details of up to CLIENT_DB_INFO_MAX entries in one command, in the order
 * asked. An id deleted meanwhile fails the whole command with 512; only then
 * are they asked one by one, and the missing one is left out.
 */
export async function clientDbInfos(dbIds: readonly string[]): Promise<DbEntry[]> {
  if (dbIds.length === 0) return [];
  try {
    const rows = await tsCommand("clientdbinfo", { cldbids: [...dbIds] });
    const byId = new Map(parseDbInfos(rows).map((e) => [e.dbId, e]));
    return dbIds.flatMap((id) => byId.get(id) ?? []);
  } catch (err) {
    if (!isUnknownClient(err)) throw err;
    if (dbIds.length === 1) return [];
  }
  const entries: DbEntry[] = [];
  for (const id of dbIds) entries.push(...(await clientDbInfos([id])));
  return entries;
}

/** Search hits whose details are fetched at a time: one `clientdbinfo`. */
export const DB_SEARCH_PAGE = CLIENT_DB_INFO_MAX;

/**
 * Finds entries by nickname (substring unless the query has its own `%`) or,
 * when the query looks like one, by exact UID. `clientdbfind` only returns
 * ids; the details of the first DB_SEARCH_PAGE come with them, the rest when
 * the dialog asks (clientDbInfos), so a broad search is still two commands.
 */
export async function searchClientDb(
  query: string,
): Promise<{ ids: string[]; entries: DbEntry[]; more: boolean }> {
  const byUid = looksLikeUid(query);
  const pattern = byUid ? query.trim() : nicknamePattern(query);
  if (!pattern) return { ids: [], entries: [], more: false };
  const ids = parseDbFind(await tsCommand("clientdbfind", { pattern, uid: byUid || undefined }));
  const entries = await clientDbInfos(ids.slice(0, DB_SEARCH_PAGE));
  return { ids, entries, more: ids.length > DB_SEARCH_PAGE };
}

export async function setClientDbDescription(dbId: string, description: string): Promise<void> {
  await tsCommand("clientdbedit", { cldbid: dbId, client_description: description });
}

export async function deleteClientDbEntry(dbId: string): Promise<void> {
  await tsCommand("clientdbdelete", { cldbid: dbId });
}

/* ------------------------------------------------ temporary passwords */

export async function listTempPasswords(): Promise<TempPassword[]> {
  return parseTempPasswords(await tsCommand("servertemppasswordlist", {}));
}

export interface NewTempPassword {
  readonly password: string;
  readonly description: string;
  readonly seconds: number;
  /** Where its users land; the default channel when left out. */
  readonly channelId?: string;
  readonly channelPassword?: string;
}

export async function addTempPassword(p: NewTempPassword): Promise<void> {
  await tsCommand("servertemppasswordadd", {
    pw: p.password,
    desc: p.description.trim(),
    duration: p.seconds,
    ...(p.channelId ? { tcid: p.channelId, tcpw: p.channelPassword ?? "" } : {}),
  });
}

export async function deleteTempPassword(password: string): Promise<void> {
  await tsCommand("servertemppassworddel", { pw: password });
}
