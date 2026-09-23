/**
 * The transfer list as plain data: every change returns a new queue, and an
 * event that does not fit the transfer's state (a late answer after a
 * cancel, progress before the start) returns the queue unchanged. The store
 * (stores/transfers.ts) owns the side effects.
 *
 *   queued ─start─> running ─finish─> done
 *     │  ^            ├──────fail───> failed
 *     │  └───defer────┤
 *     └─────cancel────┴─────cancel──> cancelled
 *
 * A queued transfer can also fail straight away (a check before it starts).
 * A deferred one (the hub was busy) waits in line until `waitUntil`.
 *
 * `origin` says who asked: the file browser's own transfers are the ones
 * its list shows; chat's and the internal ones (avatar, icons) show where
 * they were started. Internal transfers are small and a dialog waits on
 * them, so they start ahead of the line and outside the parallel limit.
 */
export type TransferKind = "upload" | "download";
export type TransferState = "queued" | "running" | "done" | "failed" | "cancelled";
export type TransferOrigin = "browser" | "chat" | "internal";

/** Finished transfers kept for the list; older ones are dropped. */
export const MAX_FINISHED = 50;

export interface Transfer {
  readonly id: string;
  readonly kind: TransferKind;
  readonly cid: string;
  /** The file's TeamSpeak path. */
  readonly path: string;
  readonly name: string;
  /** Bytes; for a download 0 until the hub says. */
  readonly size: number;
  /** Bytes moved so far (uploads only: the browser runs downloads itself). */
  readonly loaded: number;
  readonly state: TransferState;
  readonly origin: TransferOrigin;
  /** Why it failed, already translated. */
  readonly error?: string;
  /** The failure's code (a TeamSpeak error id or the hub's), to act on. */
  readonly code?: string;
  /** Queued again after a busy hub: not started before this time (ms). */
  readonly waitUntil?: number;
  readonly startedAt?: number;
  readonly finishedAt?: number;
}

export type NewTransfer = Pick<Transfer, "id" | "kind" | "cid" | "path" | "name" | "size"> & {
  /** Defaults to "browser". */
  readonly origin?: TransferOrigin;
};

export interface TransferQueue {
  readonly items: readonly Transfer[];
}

export const EMPTY_QUEUE: TransferQueue = { items: [] };

export function isFinished(t: Transfer): boolean {
  return t.state === "done" || t.state === "failed" || t.state === "cancelled";
}

const isInternal = (t: Transfer) => t.origin === "internal";

/** Running transfers that count against the parallel limit (internal ones do not). */
export function runningCount(q: TransferQueue): number {
  return q.items.filter((t) => t.state === "running" && !isInternal(t)).length;
}

/** Adds `t` at the end of the line, dropping the oldest finished beyond MAX_FINISHED. */
export function enqueue(q: TransferQueue, t: NewTransfer): TransferQueue {
  const item: Transfer = { ...t, origin: t.origin ?? "browser", loaded: 0, state: "queued" };
  const finished = q.items.filter(isFinished);
  const drop = new Set(finished.slice(0, Math.max(0, finished.length - MAX_FINISHED)));
  return { items: [...q.items.filter((x) => !drop.has(x)), item] };
}

/**
 * The queued transfers that may start at `now`: every internal one, then
 * the others, oldest first, with at most `max` of those running.
 */
export function nextToStart(q: TransferQueue, max: number, now: number): Transfer[] {
  const ready = q.items.filter(
    (t) => t.state === "queued" && (t.waitUntil === undefined || t.waitUntil <= now),
  );
  const free = Math.max(0, max - runningCount(q));
  return [...ready.filter(isInternal), ...ready.filter((t) => !isInternal(t)).slice(0, free)];
}

/** Applies `change` to transfer `id` when its state is one of `from`; otherwise no change. */
function update(
  q: TransferQueue,
  id: string,
  from: readonly TransferState[],
  change: (t: Transfer) => Transfer,
): TransferQueue {
  const current = q.items.find((t) => t.id === id);
  if (!current || !from.includes(current.state)) return q;
  return { items: q.items.map((t) => (t.id === id ? change(t) : t)) };
}

export function startTransfer(q: TransferQueue, id: string, now: number): TransferQueue {
  return update(q, id, ["queued"], ({ waitUntil: _, ...t }) => ({
    ...t,
    state: "running",
    startedAt: now,
  }));
}

/** Back in line from running (the hub was busy), not to start before `until`. */
export function deferTransfer(q: TransferQueue, id: string, until: number): TransferQueue {
  return update(q, id, ["running"], (t) => ({
    ...t,
    state: "queued",
    loaded: 0,
    waitUntil: until,
  }));
}

/** Sets the size once it is known (a download learns it from the hub). */
export function sizeTransfer(q: TransferQueue, id: string, size: number): TransferQueue {
  return update(q, id, ["queued", "running"], (t) => ({ ...t, size }));
}

export function progressTransfer(q: TransferQueue, id: string, loaded: number): TransferQueue {
  return update(q, id, ["running"], (t) => ({ ...t, loaded: Math.min(t.size, loaded) }));
}

export function finishTransfer(q: TransferQueue, id: string, now: number): TransferQueue {
  return update(q, id, ["running"], (t) => ({
    ...t,
    state: "done",
    loaded: t.size,
    finishedAt: now,
  }));
}

export function failTransfer(
  q: TransferQueue,
  id: string,
  error: string,
  now: number,
  code?: string,
): TransferQueue {
  return update(q, id, ["queued", "running"], (t) => ({
    ...t,
    state: "failed",
    error,
    ...(code === undefined ? {} : { code }),
    finishedAt: now,
  }));
}

export function cancelTransfer(q: TransferQueue, id: string, now: number): TransferQueue {
  return update(q, id, ["queued", "running"], (t) => ({
    ...t,
    state: "cancelled",
    finishedAt: now,
  }));
}

export function clearFinished(q: TransferQueue): TransferQueue {
  return { items: q.items.filter((t) => !isFinished(t)) };
}
