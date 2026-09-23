/**
 * The security level counter search, as a pure chunked loop so the worker
 * can report progress between chunks and tests can run it synchronously.
 *
 * Every extra level doubles the expected work (2^level hashes on average), so
 * the UI must show progress and let the user give up.
 */
import { securityLevel } from "./keys";

export interface SearchChunk {
  /** Counter that reaches the target, or null when this chunk found none. */
  found: bigint | null;
  /** Where the next chunk should start. */
  next: bigint;
}

export function searchChunk(
  publicKey: string,
  start: bigint,
  target: number,
  count: number,
): SearchChunk {
  let offset = start;
  for (let i = 0; i < count; i++, offset++) {
    if (securityLevel(publicKey, offset) >= target) return { found: offset, next: offset };
  }
  return { found: null, next: offset };
}

/** Rough expected number of hashes still needed, for an ETA display. */
export function expectedTries(target: number): number {
  return 2 ** target;
}

/** Highest level we offer: beyond this the search takes days in a browser. */
export const MAX_TARGET_LEVEL = 40;

export type WorkerRequest = { publicKey: string; start: string; target: number };
export type WorkerReply =
  | { type: "progress"; tried: number; next: string }
  | { type: "done"; offset: string; tried: number };
