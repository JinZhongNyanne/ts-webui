/**
 * What the music bot lets *this* session do.
 *
 * The hub holds one session with the bot, so every browser user acts as that
 * identity. The bot gates each route by a capability and, for guests, by an
 * optional per-flag switch; two routes (`prev` and `play-at`) have no guest
 * flag at all, so a guest can never reach them however the bot is configured.
 * Mirroring that rule here lets the UI hide what would only ever answer 403.
 *
 * Pure module: no Vue, no fetch, so it can be unit-tested on its own.
 */

/** Shape of the bot's `GET /api/session/me`. */
export interface BotSession {
  id: string;
  username: string;
  role: "admin" | "member" | "guest";
  capabilities: string[];
  bots: "all" | string[];
  guest: Record<string, boolean> | null;
}

/** Every control the panel offers, named after the thing the user does. */
export type MusicAction =
  | "add"
  | "playNext"
  | "playNow"
  | "transport"
  | "skip"
  | "playMode"
  | "removeClear"
  | "prev"
  | "playAt"
  | "fm"
  | "playCollection"
  | "queueCollection";

interface Rule {
  /** Capability that unconditionally grants the action. */
  readonly capability: string;
  /** Guest flag that grants it too, or null when the bot exposes none. */
  readonly guestFlag: string | null;
}

/** Taken from the bot's own `src/web/api/player.ts` route guards. */
const RULES: Readonly<Record<MusicAction, Rule>> = {
  add: { capability: "player.queue", guestFlag: "addToQueue" },
  playNext: { capability: "player.control", guestFlag: "playNext" },
  playNow: { capability: "player.control", guestFlag: "playNow" },
  transport: { capability: "player.control", guestFlag: "transport" },
  skip: { capability: "player.control", guestFlag: "skip" },
  playMode: { capability: "player.control", guestFlag: "playMode" },
  removeClear: { capability: "player.queue", guestFlag: "removeClear" },
  prev: { capability: "player.control", guestFlag: null },
  playAt: { capability: "player.control", guestFlag: null },
  // Starting a personal-FM stream is guarded by the *playMode* flag, not one
  // of its own; playing a whole playlist or album has `playCollection`.
  fm: { capability: "player.control", guestFlag: "playMode" },
  playCollection: { capability: "player.control", guestFlag: "playCollection" },
  // Appending a whole playlist to the queue is capability-only, so no guest
  // may do it however the bot is configured.
  queueCollection: { capability: "player.queue", guestFlag: null },
};

/**
 * The bot's own `useSession.ts` rule: admins can everything, members need the
 * capability, guests fall back to their flag.
 *
 * A null session means we could not ask (older bot, failed probe). Then every
 * action is allowed: showing a control that may 403 is far better than hiding
 * one the user is entitled to, and the 403 notice stays as the fallback.
 */
export function allowsAction(session: BotSession | null, action: MusicAction): boolean {
  if (!session) return true;
  const rule = RULES[action];
  if (session.role === "admin" || session.capabilities.includes(rule.capability)) return true;
  if (session.role === "guest" && rule.guestFlag !== null) {
    return session.guest?.[rule.guestFlag] === true;
  }
  return false;
}

/**
 * Validates the bot's answer at the boundary. Anything unrecognisable becomes
 * null, which the caller reads as "allow everything" rather than as a guess.
 */
export function parseBotSession(data: unknown): BotSession | null {
  if (typeof data !== "object" || data === null) return null;
  const raw = data as Record<string, unknown>;
  const role = raw.role;
  if (role !== "admin" && role !== "member" && role !== "guest") return null;
  const capabilities = Array.isArray(raw.capabilities)
    ? raw.capabilities.filter((c): c is string => typeof c === "string")
    : [];
  const guest =
    typeof raw.guest === "object" && raw.guest !== null
      ? Object.fromEntries(
          Object.entries(raw.guest as Record<string, unknown>).map(([k, v]) => [k, v === true]),
        )
      : null;
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    username: typeof raw.username === "string" ? raw.username : "",
    role,
    capabilities,
    bots: Array.isArray(raw.bots)
      ? raw.bots.filter((b): b is string => typeof b === "string")
      : "all",
    guest,
  };
}
