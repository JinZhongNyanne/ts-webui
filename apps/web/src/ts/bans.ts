/**
 * Plain helpers behind the ban dialog and the ban list: durations and the
 * `i_client_ban_max_bantime` cap, `notifybanlist` rows, search. No Vue, no
 * hub, so they are easy to test.
 *
 * TeamSpeak ban lengths are seconds, and 0 means permanent.
 */
import {
  banIpProblem,
  banNameProblem,
  decodeTextCode,
  type BanRuleProblem,
  type TsCmdRow,
} from "@jinz/protocol";
import { permValue, type PermValues } from "./perms";

/** A non-negative whole number from TeamSpeak text; 0 for anything else. */
const int = (v: string | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
};

/** The dialog's quick choices: 10 min, 1 h, 1 day, 7 days, permanent. */
export const BAN_PRESETS: readonly number[] = [600, 3600, 86_400, 604_800, 0];

export const BAN_UNITS = { s: 1, min: 60, h: 3600, d: 86_400 } as const;
export type BanUnit = keyof typeof BAN_UNITS;

export function toSeconds(amount: number, unit: BanUnit): number {
  return Math.round(amount * BAN_UNITS[unit]);
}

/** The largest unit that divides `seconds` evenly, for showing a custom length. */
export function durationParts(seconds: number): { amount: number; unit: BanUnit } {
  const units: BanUnit[] = ["d", "h", "min"];
  const unit = units.find((u) => seconds > 0 && seconds % BAN_UNITS[u] === 0) ?? "s";
  return { amount: seconds / BAN_UNITS[unit], unit };
}

/** The dialog's duration select: a preset's seconds as text, or "custom". */
export const CUSTOM_DURATION = "custom";

/** Seconds for the dialog's choice, or null when a custom amount is not a positive number. */
export function chosenSeconds(choice: string, amount: number, unit: BanUnit): number | null {
  if (choice !== CUSTOM_DURATION) return Number(choice);
  return Number.isFinite(amount) && amount > 0 ? toSeconds(amount, unit) : null;
}

export type BanDurationKey = "ban.permanent" | `ban.dur.${BanUnit}`;

/** "10 min", "7 days", "permanent", worded by `t` (the i18n one, or a fake in tests). */
export function formatBanDuration(
  seconds: number,
  t: (key: BanDurationKey, params: { n: number }) => string,
): string {
  if (seconds === 0) return t("ban.permanent", { n: 0 });
  const { amount, unit } = durationParts(seconds);
  return t(`ban.dur.${unit}`, { n: amount });
}

/** Hub error code for "the server banned us" (the hub's ban-notice.ts). */
export const BANNED_CODE = "banned";

type BanNoticeKey = "hub.bannedBy" | "hub.bannedByNoReason" | BanDurationKey;

/**
 * The hub's "you were banned" text code (see the hub's ban-notice.ts), worded:
 * who, how long (sent as seconds so it can be worded here) and why.
 */
export function describeBanNotice(
  code: string,
  t: (key: BanNoticeKey, params: Record<string, string | number>) => string,
): string {
  const params = decodeTextCode(code).params ?? {};
  const time = formatBanDuration(int(params["seconds"]), t);
  const reason = params["reason"]?.trim() ?? "";
  const name = params["name"] ?? "";
  return reason
    ? t("hub.bannedBy", { name, time, reason })
    : t("hub.bannedByNoReason", { name, time });
}

export const PERM_BAN_MAX_TIME = "i_client_ban_max_bantime";

/**
 * The longest ban we may give, or null for no known limit. Like the other
 * powers it only arrives with b_client_permissionoverview_own; -1 is
 * unlimited, and 0 or absent is treated as "unknown" (the server decides).
 */
export function maxBanTime(values: PermValues, loaded: boolean): number | null {
  if (!loaded) return null;
  const v = permValue(values, PERM_BAN_MAX_TIME);
  return v > 0 ? v : null;
}

/** Fits under the cap? A permanent ban (0) never does. */
export function allowsBanTime(seconds: number, cap: number | null): boolean {
  if (cap === null) return true;
  return seconds !== 0 && seconds <= cap;
}

export function clampBanTime(seconds: number, cap: number | null): number {
  return allowsBanTime(seconds, cap) ? seconds : (cap as number);
}

/** One `notifybanlist` row, typed. Times are epoch milliseconds; `duration` stays seconds. */
export interface BanEntry {
  readonly id: string;
  readonly ip: string;
  /** A regular expression on nicknames. */
  readonly name: string;
  readonly uid: string;
  /** The nickname of the client a banclient ban was made from. */
  readonly lastNickname: string;
  readonly reason: string;
  readonly invokerName: string;
  readonly invokerUid: string;
  readonly created: number;
  readonly duration: number;
  /** Null for a permanent ban. */
  readonly expires: number | null;
  /** How many connection attempts the ban has refused. */
  readonly enforcements: number;
}

export function parseBan(row: TsCmdRow): BanEntry {
  const created = int(row["created"]) * 1000;
  const duration = int(row["duration"]);
  return {
    id: row["banid"] ?? "",
    ip: row["ip"] ?? "",
    name: row["name"] ?? "",
    uid: row["uid"] ?? "",
    lastNickname: row["lastnickname"] ?? "",
    reason: row["reason"] ?? "",
    invokerName: row["invokername"] ?? "",
    invokerUid: row["invokeruid"] ?? "",
    created,
    duration,
    expires: duration === 0 ? null : created + duration * 1000,
    enforcements: int(row["enforcements"]),
  };
}

const SEARCHED: readonly (keyof BanEntry)[] = [
  "ip",
  "name",
  "uid",
  "lastNickname",
  "reason",
  "invokerName",
];

/** Bans with `query` in any text column, ignoring case; all of them for a blank query. */
export function filterBans(bans: readonly BanEntry[], query: string): BanEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...bans];
  return bans.filter((b) => SEARCHED.some((k) => String(b[k]).toLowerCase().includes(q)));
}

/** A short name for a ban (screen-reader labels, confirmations): who or what it matches. */
export function banLabel(ban: BanEntry): string {
  return ban.lastNickname || ban.name || ban.ip || ban.uid || `#${ban.id}`;
}

/** A `banadd name=` pattern matching exactly this nickname. */
export function nicknamePattern(nickname: string): string {
  return `^${nickname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
}

/**
 * What is wrong with a rule field, as the hub will judge it (see
 * packages/protocol/src/ban-rules.ts): a message key, or null. Blank is fine,
 * it is just not part of the rule.
 */
export function ruleProblem(field: "ip" | "name", value: string): BanRuleProblem | null {
  const v = value.trim();
  if (!v) return null;
  return field === "ip" ? banIpProblem(v) : banNameProblem(v);
}
