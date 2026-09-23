/**
 * Hub-wide traffic control, one per TeamSpeak server.
 *
 * Every browser session reaches the server from the hub's single address, and
 * TeamSpeak's anti-flood counts points per client *and per IP*. What one
 * session sends is harmless; the same thing from every session at once is
 * not. After a hub restart every open tab reconnects within seconds with an
 * empty icon/avatar cache, and each session used to pace and dedupe its own
 * downloads only: N sessions fetched the same files in parallel, the server
 * banned the hub's IP for "flood prevention" (error 3329), and with it every
 * web user.
 *
 * So the things that must add up across sessions live here, keyed by server:
 *  - one pace queue for optional commands (file transfer inits, permission
 *    lookups), so the hub as a whole sends at most one every SPACING_MS, and
 *    refuses icons and avatars rather than queue them without end;
 *  - one in-flight map, so a file is downloaded once however many ask;
 *  - one flood backoff: a 3331 warning to any session quiets all of them;
 *  - connect spacing, so a reconnect storm arrives one handshake at a time;
 *  - a cool-down after a flood ban, so sessions do not keep dialling (and
 *    prolonging the ban) while it lasts;
 *  - one budget for the commands pages ask for (`ts.cmd`), so twenty admins
 *    opening a dialog at once queue up instead of adding up;
 *  - what the hub itself is on the server: its sessions' client ids and the
 *    address the server sees, which ban rules must never hit (commands.ts).
 */
import { canonicalIp } from "@jinz/protocol";

/** Gap between optional commands, hub-wide per server. */
export const SPACING_MS = 400;
/**
 * Optional paced work (icon and avatar downloads) that may wait at once;
 * past it more is refused rather than queued. At SPACING_MS apart that is
 * about 25 s of backlog, enough for a fresh hub's first render of a big server.
 */
export const PACE_QUEUE_MAX = 64;
/** How long optional traffic stays off after a flood warning (3331). */
export const FLOOD_BACKOFF_MS = 30_000;
/** Gap between connection handshakes to one server. */
export const CONNECT_SPACING_MS = 1_500;
/** How long no session dials a server that banned the hub for flooding. */
export const FLOOD_BAN_COOLDOWN_MS = 120_000;
/** How long a refused `permissionlist` is not asked again. */
export const CATALOG_RETRY_MS = 10 * 60_000;

/*
 * The `ts.cmd` budget, a token bucket shared by every session on a server.
 * TeamSpeak's anti-flood (defaults: 5 points forgiven per second, a client
 * blocked at 150 points, an address at 250) is what it must stay under. The
 * steady rate matches the forgiveness at the usual few points per command; a
 * burst of ten stays far below either block even on top of the optional
 * traffic above. One user rarely needs more: the admin search is two commands
 * (clientdbinfo takes a page of ids at once), a dialog one to three. Commands
 * answer in milliseconds, so the gap inside a burst is what one user notices:
 * ten in under a second.
 */
/** Commands that may go out back to back once the hub has been quiet. */
export const TS_CMD_BURST = 10;
/** Steady rate past the burst: one command per this many ms, hub-wide per server. */
export const TS_CMD_REFILL_MS = 1_000;
/** Gap between two commands even within a burst. */
export const TS_CMD_SPACING_MS = 100;
/**
 * The longest a command may wait for its turn. Past that it is refused (busy)
 * rather than queued: the page gives up after 10 s, and the command would
 * still run after it had been reported as failed.
 */
export const TS_CMD_MAX_WAIT_MS = 4_000;

/** Thrown by tsCmdSlot when the queue is already longer than TS_CMD_MAX_WAIT_MS. */
export class GuardBusyError extends Error {
  constructor(message = "hub-wide command budget exhausted") {
    super(message);
    this.name = "GuardBusyError";
  }
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export class ServerGuard {
  private paceQueue: Promise<void> = Promise.resolve();
  private lastPaced = Number.NEGATIVE_INFINITY;
  private paceDepth = 0;
  private connectQueue: Promise<void> = Promise.resolve();
  private lastConnect = Number.NEGATIVE_INFINITY;
  private floodedUntil = 0;
  private bannedUntil = 0;
  private catalogRefusedUntil = 0;
  /** The ts.cmd bucket as a "theoretical arrival time" (GCRA): full again at cmdTat - BURST refills. */
  private cmdTat = Number.NEGATIVE_INFINITY;
  private lastCmd = Number.NEGATIVE_INFINITY;
  private cmdQueue: Promise<unknown> = Promise.resolve();
  /** Our sessions' client ids, each with how many sessions hold it. */
  private readonly hubClients = new Map<number, number>();
  private address: string | null = null;
  /** Downloads in progress, keyed like the asset cache. */
  readonly inflight = new Map<string, Promise<Buffer | null>>();

  constructor(private readonly clock: Clock = realClock) {}

  /**
   * Runs `fn` after every earlier paced command, at least SPACING_MS after the
   * last one. `optional` work (an icon or avatar a page asked for) is refused
   * with GuardBusyError once PACE_QUEUE_MAX are queued: pages ask for those
   * on every render, and each queued one is a command the server gets later.
   */
  paced<T>(fn: () => Promise<T>, opts: { optional?: boolean } = {}): Promise<T> {
    if (opts.optional && this.paceDepth >= PACE_QUEUE_MAX) {
      return Promise.reject(new GuardBusyError("hub-wide pace queue full"));
    }
    this.paceDepth += 1;
    const run = this.paceQueue.then(async () => {
      const wait = this.lastPaced + SPACING_MS - this.clock.now();
      if (wait > 0) await this.clock.sleep(wait);
      this.lastPaced = this.clock.now();
      return fn();
    });
    this.paceQueue = run.then(
      () => void (this.paceDepth -= 1),
      () => void (this.paceDepth -= 1),
    );
    return run;
  }

  /** Paced commands queued or running. */
  get pacedDepth(): number {
    return this.paceDepth;
  }

  /** Waits for this session's turn to start a handshake. */
  connectSlot(): Promise<void> {
    const run = this.connectQueue.then(async () => {
      const wait = this.lastConnect + CONNECT_SPACING_MS - this.clock.now();
      if (wait > 0) await this.clock.sleep(wait);
      this.lastConnect = this.clock.now();
    });
    this.connectQueue = run;
    return run;
  }

  /**
   * Waits for a page command's turn in the hub-wide budget and resolves with
   * how long that took. The slot is booked at once, so a refusal
   * (GuardBusyError) is immediate and costs nothing.
   */
  tsCmdSlot(): Promise<number> {
    const now = this.clock.now();
    const tat = Math.max(this.cmdTat, now);
    const start = Math.max(
      now,
      tat - (TS_CMD_BURST - 1) * TS_CMD_REFILL_MS,
      this.lastCmd + TS_CMD_SPACING_MS,
    );
    const waited = start - now;
    if (waited > TS_CMD_MAX_WAIT_MS) return Promise.reject(new GuardBusyError());
    this.cmdTat = Math.max(tat, start) + TS_CMD_REFILL_MS;
    this.lastCmd = start;
    // Waiters sleep one after another, each only for what is left of its wait.
    const run = this.cmdQueue.then(async () => {
      const left = start - this.clock.now();
      if (left > 0) await this.clock.sleep(left);
      return waited;
    });
    this.cmdQueue = run;
    return run;
  }

  /**
   * Counted, because sessions release their id late (see TsSession): the
   * server keeps a dropped client around for a while, and may meanwhile hand
   * the same id to another of our sessions.
   */
  addHubClient(clientId: number): void {
    this.hubClients.set(clientId, (this.hubClients.get(clientId) ?? 0) + 1);
  }

  removeHubClient(clientId: number): void {
    const left = (this.hubClients.get(clientId) ?? 0) - 1;
    if (left > 0) this.hubClients.set(clientId, left);
    else this.hubClients.delete(clientId);
  }

  /** Whether `clientId` is one of this hub's own sessions (and so shares its address). */
  isHubClient(clientId: number): boolean {
    return this.hubClients.has(clientId);
  }

  /** Records the address the server reports for one of our sessions; anything else is ignored. */
  noteHubAddress(ip: string): void {
    const canonical = canonicalIp(ip);
    if (canonical) this.address = canonical;
  }

  /** The hub's address as this server sees it, once a session has learned it. */
  get hubAddress(): string | null {
    return this.address;
  }

  noteFlood(): void {
    this.floodedUntil = this.clock.now() + FLOOD_BACKOFF_MS;
  }

  get flooded(): boolean {
    return this.floodedUntil > this.clock.now();
  }

  noteFloodBan(): void {
    this.bannedUntil = this.clock.now() + FLOOD_BAN_COOLDOWN_MS;
    this.noteFlood();
  }

  /** Milliseconds left in the flood-ban cool-down; 0 when dialling is fine. */
  get banCooldownMs(): number {
    return Math.max(0, this.bannedUntil - this.clock.now());
  }

  noteCatalogRefused(): void {
    this.catalogRefusedUntil = this.clock.now() + CATALOG_RETRY_MS;
  }

  get catalogRefused(): boolean {
    return this.catalogRefusedUntil > this.clock.now();
  }
}

const guards = new Map<string, ServerGuard>();

/** The guard shared by every session on `serverKey` (`host:port`). */
export function guardFor(serverKey: string): ServerGuard {
  let guard = guards.get(serverKey);
  if (!guard) {
    guard = new ServerGuard();
    guards.set(serverKey, guard);
  }
  return guard;
}

/** Test helper. */
export function clearServerGuards(): void {
  guards.clear();
}

/** TeamSpeak's anti-flood ban: error 3329 whose extra message says why. */
export function isFloodBan(id: string, extraMessage: string | undefined): boolean {
  return id === "3329" && /flood/i.test(extraMessage ?? "");
}
