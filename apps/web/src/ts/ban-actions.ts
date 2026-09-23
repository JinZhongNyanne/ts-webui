/**
 * The M2 ban commands, each one allow-listed `ts.cmd` (see commands.ts).
 * Every function rejects with a TsCommandError whose message is ready to
 * display (a refusal names the permission the server wanted).
 *
 * Checked on a live TS3 3.13 server: `banclient` on a connected client adds
 * two bans (its UID and its IP) and drops it; `banadd uid=` drops a matching
 * client that is online too; `banlist` answers with `notifybanlist`; there is
 * no `banedit` in the client protocol ("command not found"), so an edit is a
 * new ban followed by deleting the old one.
 */
import { tsCommand } from "./commands";
import { parseBan, type BanEntry } from "./bans";

/** What a `banadd` matches on; at least one field must be non-blank. */
export interface BanRule {
  readonly ip?: string;
  readonly name?: string;
  readonly uid?: string;
}

/** Only the fields that say something: the schema refuses blank ones. */
function ruleArgs(rule: BanRule): BanRule {
  const pick = (v?: string) => (v?.trim() ? v.trim() : undefined);
  return { ip: pick(rule.ip), name: pick(rule.name), uid: pick(rule.uid) };
}

const dropUndefined = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

export async function banClient(clientId: number, seconds: number, reason: string): Promise<void> {
  await tsCommand("banclient", { clid: clientId, time: seconds, banreason: reason.trim() });
}

export async function addBan(rule: BanRule, seconds: number, reason: string): Promise<void> {
  await tsCommand(
    "banadd",
    dropUndefined({ ...ruleArgs(rule), time: seconds, banreason: reason.trim() }),
  );
}

/** Newest first, as people look for the ban they just made. */
export async function listBans(): Promise<BanEntry[]> {
  const rows = await tsCommand("banlist", {});
  return rows.map(parseBan).sort((a, b) => b.created - a.created);
}

export async function deleteBan(banId: string): Promise<void> {
  await tsCommand("bandel", { banid: banId });
}

export async function deleteAllBans(): Promise<void> {
  await tsCommand("bandelall", {});
}

/**
 * An edit that went half way: the new ban is in, the old one could not be
 * deleted, so both stand. Retrying would add a third; the message is the
 * `bandel` refusal.
 */
export class BanEditPartialError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "BanEditPartialError";
  }
}

/**
 * Replaces `old` with a ban built from the new values. The new one goes in
 * first, so a refusal leaves the old ban standing rather than no ban at all;
 * a failed delete after that rejects with BanEditPartialError.
 */
export async function editBan(
  old: BanEntry,
  rule: BanRule,
  seconds: number,
  reason: string,
): Promise<void> {
  await addBan(rule, seconds, reason);
  try {
    await deleteBan(old.id);
  } catch (err) {
    throw new BanEditPartialError(err);
  }
}
