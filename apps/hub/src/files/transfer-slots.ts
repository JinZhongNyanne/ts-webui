/**
 * The transfers running at once: `perSession` for one browser session, and
 * `hubWide` for the whole hub (HUB_FT_MAX_TRANSFERS). Each one holds a
 * browser request, a socket on the TeamSpeak file port and a transfer on the
 * server, so the sessions must add up to something the hub can carry.
 */
import { ConcurrencyLimiter } from "../security/limits.js";

export class TransferSlots {
  private readonly perSession: ConcurrencyLimiter;
  private live = 0;

  constructor(
    perSession: number,
    private readonly hubWide: number,
  ) {
    this.perSession = new ConcurrencyLimiter(perSession);
  }

  /** Reserves a slot for `key`; false means the session or the hub is full. */
  acquire(key: string): boolean {
    if (this.live >= this.hubWide) return false;
    if (!this.perSession.acquire(key)) return false;
    this.live += 1;
    return true;
  }

  release(key: string): void {
    if (this.perSession.count(key) === 0) return;
    this.perSession.release(key);
    this.live -= 1;
  }

  count(key: string): number {
    return this.perSession.count(key);
  }

  /** Transfers running hub-wide. */
  get inUse(): number {
    return this.live;
  }
}
