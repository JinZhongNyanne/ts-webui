/**
 * Commands a session sends on its own in answer to what others do: the
 * subscribe that follows a new channel, the description fetch after an edit.
 *
 * Those arrive at every session at once. One admin creating five channels in
 * a row used to make each of N sessions send five commands straight away, all
 * from the hub's one address, which is how TeamSpeak's anti-flood bans every
 * web user together (see server-guard.ts). So they go through the guard's
 * pace queue like the other optional traffic, are skipped while the server is
 * flooding, and coalesce while they wait: a key asked for again before its
 * command has gone out rides along with it, and with `batch` everything that
 * piled up goes out as one multi-row command (`channelsubscribe cid=1|cid=2`).
 */
import type { ServerGuard } from "./server-guard.js";

export interface PacedRequestOptions {
  /** The guard to go through, looked up when needed. */
  guard: () => Pick<ServerGuard, "paced" | "flooded">;
  /** Sends one command for `keys` (just one key unless `batch`). */
  send: (keys: string[]) => Promise<void>;
  /** All keys waiting go out as one command, rather than one command each. */
  batch: boolean;
  onError?: (err: unknown, keys: readonly string[]) => void;
}

export class PacedRequests {
  /** Keys asked for whose command has not gone out yet, and the promise it settles. */
  private readonly waiting = new Map<string, Promise<void>>();
  private batchRun: Promise<void> | null = null;
  /** Bumped by clear(): what was queued before it is dropped. */
  private generation = 0;

  constructor(private readonly opts: PacedRequestOptions) {}

  /** Resolves once the command for `key` went out (or was skipped); never rejects. */
  request(key: string): Promise<void> {
    const queued = this.waiting.get(key);
    if (queued) return queued;
    const run = this.opts.batch ? (this.batchRun ??= this.schedule(null)) : this.schedule(key);
    this.waiting.set(key, run);
    return run;
  }

  /** Forgets everything still waiting (the session is going away). */
  clear(): void {
    this.generation++;
    this.waiting.clear();
    this.batchRun = null;
  }

  private schedule(key: string | null): Promise<void> {
    const gen = this.generation;
    return this.opts.guard().paced(async () => {
      if (gen !== this.generation) return;
      const keys = key === null ? [...this.waiting.keys()] : [key];
      if (key === null) {
        this.waiting.clear();
        this.batchRun = null;
      } else {
        this.waiting.delete(key);
      }
      // Not an error: the page asks again when it needs to.
      if (this.opts.guard().flooded || keys.length === 0) return;
      try {
        await this.opts.send(keys);
      } catch (err) {
        this.opts.onError?.(err, keys);
      }
    });
  }
}
