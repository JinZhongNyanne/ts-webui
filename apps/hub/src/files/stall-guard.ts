/**
 * The watchdog on a transfer's progress.
 *
 * Backpressure is idle time, not a dead connection (see routes.ts), so the
 * sockets have no timeout of their own: a browser that announces 100 MB and
 * then sends a byte a minute, or asks for a file and never reads it, would
 * otherwise hold a slot, a socket on the file port and a transfer on the
 * TeamSpeak server for as long as it liked. So a transfer must keep moving:
 * `minBytes` in every `windowMs`, or what is left of it when that is less.
 */
import { Transform, type TransformCallback } from "node:stream";

/** A transfer that stopped moving (see StallGuard). */
export class StalledTransfer extends Error {
  constructor() {
    super("transfer stalled");
    this.name = "StalledTransfer";
  }
}

export interface StallLimits {
  /** How long a transfer may move less than `minBytes` before it is cut off. */
  windowMs: number;
  minBytes: number;
}

/** HUB_FT_STALL_SECONDS / HUB_FT_STALL_MIN_BYTES, for callers that pass none. */
export const DEFAULT_STALL: StallLimits = { windowMs: 60_000, minBytes: 64 * 1024 };

export class StallGuard extends Transform {
  private total = 0;
  private inWindow = 0;
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly expected: number,
    private readonly limits: StallLimits = DEFAULT_STALL,
  ) {
    super();
    this.timer = setInterval(() => this.check(), limits.windowMs);
    this.timer.unref?.();
  }

  /** Bytes that went through so far. */
  get moved(): number {
    return this.total;
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, done: TransformCallback): void {
    this.total += chunk.length;
    this.inWindow += chunk.length;
    done(null, chunk);
  }

  override _flush(done: TransformCallback): void {
    clearInterval(this.timer);
    done();
  }

  override _destroy(err: Error | null, done: (err: Error | null) => void): void {
    clearInterval(this.timer);
    done(err);
  }

  private check(): void {
    const left = Math.max(0, this.expected - this.total);
    const needed = Math.min(this.limits.minBytes, left);
    if (needed > 0 && this.inWindow < needed) {
      this.destroy(new StalledTransfer());
      return;
    }
    this.inWindow = 0;
  }
}
